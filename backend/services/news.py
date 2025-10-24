from __future__ import annotations

import asyncio
import calendar
import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape
from pathlib import Path
from typing import Any, Iterable, Optional
from urllib.parse import urlparse

import feedparser
import httpx

from backend.services.config_store import read_config as read_store_config

logger = logging.getLogger(__name__)


DEFAULT_FEEDS = [
    "https://www.elperiodicomediterraneo.com/rss/section/1002",
    "https://www.xataka.com/index.xml",
    "https://www.xatakaciencia.com/index.xml",
]
DEFAULT_MAX_ITEMS_PER_FEED = 5
DEFAULT_CACHE_TTL_SECONDS = 900
MAX_TOTAL_ITEMS = 12
FETCH_TIMEOUT = 8.0
MAX_RETRIES = 1


@dataclass(slots=True)
class NewsSettings:
    enabled: bool
    feeds: list[str]
    max_items_per_feed: int
    cache_ttl_seconds: int

    @property
    def signature(self) -> tuple[Any, ...]:
        return (
            self.enabled,
            tuple(self.feeds),
            self.max_items_per_feed,
            self.cache_ttl_seconds,
        )


class NewsServiceError(RuntimeError):
    """Raised when fetching news headlines fails."""


class NewsService:
    def __init__(self, cache_path: Path | None = None) -> None:
        self._cache_path = cache_path or (
            Path(__file__).resolve().parent.parent / "storage" / "cache" / "news_headlines.json"
        )
        self._memory_cache: dict[str, Any] | None = None
        self._memory_expiry: float = 0.0
        self._memory_signature: tuple[Any, ...] | None = None
        self._lock = asyncio.Lock()
        self._redirect_cache: dict[str, str] = {}

    async def get_headlines(self) -> dict[str, Any]:
        settings = self._load_settings()
        now = datetime.now(tz=timezone.utc)
        timestamp = int(now.timestamp())

        if not settings.enabled or not settings.feeds:
            return {
                "items": [],
                "updated_at": timestamp,
                "note": "Noticias desactivadas",
            }

        async with self._lock:
            cached = self._read_memory_cache(settings, now)
            if cached is not None:
                return cached

            disk_cached = self._read_disk_cache(settings, now)
            if disk_cached is not None:
                self._store_memory_cache(disk_cached, settings, now)
                return disk_cached

            try:
                fetched, had_failures = await self._fetch_all(settings, now)
            except Exception as exc:  # pragma: no cover - defensive
                logger.warning("No se pudieron obtener titulares RSS: %s", exc)
                return {
                    "items": [],
                    "updated_at": timestamp,
                    "error": "fetch_failed",
                }

            payload: dict[str, Any] = {
                "items": fetched,
                "updated_at": int(datetime.now(tz=timezone.utc).timestamp()),
            }
            if had_failures and not fetched:
                payload["error"] = "fetch_failed"
            self._write_disk_cache(payload, settings)
            self._store_memory_cache(payload, settings, now)
            return payload

    def _load_settings(self) -> NewsSettings:
        config_data, _ = read_store_config()
        news_section = (
            config_data.get("news")
            if isinstance(config_data, dict) and isinstance(config_data.get("news"), dict)
            else {}
        )

        enabled = bool(news_section.get("enabled", True))

        feeds = [
            str(url).strip()
            for url in (news_section.get("feeds") or DEFAULT_FEEDS)
            if isinstance(url, str) and str(url).strip()
        ]
        if not feeds:
            feeds = list(DEFAULT_FEEDS)

        max_items = news_section.get("maxItemsPerFeed", DEFAULT_MAX_ITEMS_PER_FEED)
        if not isinstance(max_items, int) or max_items <= 0:
            max_items = DEFAULT_MAX_ITEMS_PER_FEED

        cache_ttl = news_section.get("cacheTtlSeconds", DEFAULT_CACHE_TTL_SECONDS)
        if not isinstance(cache_ttl, int) or cache_ttl <= 0:
            cache_ttl = DEFAULT_CACHE_TTL_SECONDS

        return NewsSettings(
            enabled=enabled,
            feeds=feeds,
            max_items_per_feed=max_items,
            cache_ttl_seconds=cache_ttl,
        )

    def _read_memory_cache(
        self, settings: NewsSettings, now: datetime
    ) -> dict[str, Any] | None:
        if (
            self._memory_cache is None
            or self._memory_signature != settings.signature
            or now.timestamp() >= self._memory_expiry
        ):
            return None
        return dict(self._memory_cache)

    def _store_memory_cache(
        self, payload: dict[str, Any], settings: NewsSettings, now: datetime
    ) -> None:
        ttl = max(settings.cache_ttl_seconds, 60)
        self._memory_cache = dict(payload)
        self._memory_signature = settings.signature
        self._memory_expiry = now.timestamp() + ttl

    def _read_disk_cache(
        self, settings: NewsSettings, now: datetime
    ) -> dict[str, Any] | None:
        try:
            with self._cache_path.open("r", encoding="utf-8") as handle:
                data = json.load(handle)
        except FileNotFoundError:
            return None
        except json.JSONDecodeError as exc:  # pragma: no cover - defensive
            logger.warning("Cache de noticias corrupta: %s", exc)
            return None
        except OSError as exc:  # pragma: no cover - defensive
            logger.warning("No se pudo leer cache de noticias: %s", exc)
            return None

        if not isinstance(data, dict):
            return None

        updated_at = data.get("updated_at")
        if not isinstance(updated_at, (int, float)):
            return None

        cache_age = now.timestamp() - float(updated_at)
        if cache_age > max(settings.cache_ttl_seconds, 60):
            return None

        signature = data.get("signature")
        if signature != list(settings.signature):
            return None

        redirects = data.get("redirects")
        if isinstance(redirects, dict):
            self._redirect_cache = {
                str(key): str(value)
                for key, value in redirects.items()
                if isinstance(key, str) and isinstance(value, str) and value.strip()
            }

        payload = {
            "items": data.get("items") or [],
            "updated_at": int(updated_at),
        }
        note = data.get("note")
        if isinstance(note, str) and note.strip():
            payload["note"] = note.strip()
        return payload

    def _write_disk_cache(self, payload: dict[str, Any], settings: NewsSettings) -> None:
        try:
            self._cache_path.parent.mkdir(parents=True, exist_ok=True)
        except OSError as exc:  # pragma: no cover - defensive
            logger.warning("No se pudo crear directorio de cache de noticias: %s", exc)
            return

        data = dict(payload)
        data["signature"] = list(settings.signature)
        if self._redirect_cache:
            data["redirects"] = self._redirect_cache
        tmp_path = self._cache_path.with_suffix(self._cache_path.suffix + ".tmp")
        try:
            with tmp_path.open("w", encoding="utf-8") as handle:
                json.dump(data, handle, ensure_ascii=False, indent=2, sort_keys=True)
                handle.write("\n")
            os.replace(tmp_path, self._cache_path)
        except OSError as exc:  # pragma: no cover - defensive
            logger.warning("No se pudo escribir cache de noticias: %s", exc)
            try:
                if tmp_path.exists():
                    tmp_path.unlink()
            except OSError:
                pass

    async def _fetch_all(
        self, settings: NewsSettings, now: datetime
    ) -> tuple[list[dict[str, Any]], bool]:
        feeds = settings.feeds[:]
        if not feeds:
            return [], False

        async with httpx.AsyncClient(timeout=FETCH_TIMEOUT, follow_redirects=True) as client:
            tasks = [
                self._fetch_feed(
                    client,
                    original_url=url,
                    request_url=self._redirect_cache.get(url, url),
                    max_items=settings.max_items_per_feed,
                    now=now,
                )
                for url in feeds
            ]
            results = await asyncio.gather(*tasks, return_exceptions=True)

        items: list[dict[str, Any]] = []
        had_failures = False
        for result in results:
            if isinstance(result, Exception):
                logger.warning("Error al obtener feed RSS: %s", result)
                had_failures = True
                continue
            items.extend(result)

        items.sort(key=lambda entry: entry.get("published_ts") or 0, reverse=True)
        if len(items) > MAX_TOTAL_ITEMS:
            items = items[:MAX_TOTAL_ITEMS]

        for item in items:
            item.pop("published_ts", None)

        return items, had_failures

    async def _fetch_feed(
        self,
        client: httpx.AsyncClient,
        original_url: str,
        request_url: str,
        max_items: int,
        now: datetime,
    ) -> list[dict[str, Any]]:
        last_error: Optional[Exception] = None
        for attempt in range(MAX_RETRIES + 1):
            try:
                response = await client.get(request_url)
                response.raise_for_status()
                content = response.text
                final_url = str(response.url)
                if final_url != original_url:
                    self._redirect_cache[original_url] = final_url
                break
            except (httpx.HTTPError, httpx.RequestError) as exc:
                last_error = exc
                if attempt >= MAX_RETRIES:
                    raise
                await asyncio.sleep(0.5)
        else:  # pragma: no cover - defensive
            if last_error:
                raise last_error
            raise NewsServiceError(f"No se pudo obtener {url}")

        parsed = feedparser.parse(content)
        feed_title = self._sanitize_text(parsed.feed.get("title")) if parsed.feed else None
        source = feed_title or self._infer_source_from_url(str(response.url))

        entries = parsed.entries if isinstance(parsed.entries, Iterable) else []

        headlines: list[dict[str, Any]] = []
        for entry in entries:
            if len(headlines) >= max_items:
                break
            title = self._sanitize_text(entry.get("title"))
            if not title:
                continue
            title = self._truncate(title, 160)
            link = self._sanitize_link(entry.get("link")) or str(response.url)
            published_dt = self._parse_entry_datetime(entry)
            published_iso: str | None
            age_minutes: int | None
            published_ts: float | None
            if published_dt is not None:
                published_dt = published_dt.astimezone(timezone.utc)
                published_iso = published_dt.isoformat()
                published_ts = published_dt.timestamp()
                delta = now - published_dt
                age_minutes = max(0, int(delta.total_seconds() // 60))
            else:
                published_iso = None
                # Algunos feeds (p.ej. Xataka) no incluyen fecha; asignamos una marca de tiempo
                # sintética para evitar que desaparezcan al ordenar por recencia.
                fallback_offset = len(headlines) * 60
                published_ts = now.timestamp() - fallback_offset
                age_minutes = None

            headline = {
                "title": title,
                "source": source,
                "link": link,
            }
            if published_iso:
                headline["published"] = published_iso
            if age_minutes is not None:
                headline["ageMinutes"] = age_minutes
            if published_ts is not None:
                headline["published_ts"] = published_ts

            headlines.append(headline)

        return headlines

    @staticmethod
    def _sanitize_text(value: Any) -> str:
        if not isinstance(value, str):
            return ""
        cleaned = unescape(value).strip()
        return " ".join(cleaned.split())

    @staticmethod
    def _sanitize_link(value: Any) -> Optional[str]:
        if not isinstance(value, str):
            return None
        cleaned = value.strip()
        if not cleaned:
            return None
        parsed = urlparse(cleaned)
        if not parsed.scheme or not parsed.netloc:
            return None
        return cleaned

    @staticmethod
    def _truncate(value: str, max_length: int) -> str:
        if len(value) <= max_length:
            return value
        truncated = value[: max_length - 1].rstrip()
        return truncated + "…"

    @staticmethod
    def _infer_source_from_url(url: str) -> str:
        parsed = urlparse(url)
        host = parsed.netloc or url
        return host.replace("www.", "", 1)

    @staticmethod
    def _parse_entry_datetime(entry: Any) -> Optional[datetime]:
        if isinstance(getattr(entry, "published_parsed", None), tuple):
            return datetime.fromtimestamp(
                calendar.timegm(entry.published_parsed), tz=timezone.utc
            )
        if isinstance(getattr(entry, "updated_parsed", None), tuple):
            return datetime.fromtimestamp(
                calendar.timegm(entry.updated_parsed), tz=timezone.utc
            )

        published = entry.get("published") if isinstance(entry, dict) else getattr(entry, "published", None)
        updated = entry.get("updated") if isinstance(entry, dict) else getattr(entry, "updated", None)

        for value in (published, updated):
            if not value:
                continue
            try:
                parsed = parsedate_to_datetime(value)
            except (TypeError, ValueError):
                continue
            if parsed is None:
                continue
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed
        return None


news_service = NewsService()


__all__ = ["news_service", "NewsService", "NewsServiceError"]
