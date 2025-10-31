from __future__ import annotations

import logging
import time
from typing import Any, Dict, Iterable, List, Optional, Tuple

import httpx


class OpenSkyClientError(Exception):
    def __init__(self, message: str, status: Optional[int] = None) -> None:
        super().__init__(message)
        self.status = status


class OpenSkyClient:
    """HTTP client for OpenSky state vector API."""

    BASE_URL = "https://opensky-network.org/api"

    def __init__(self, logger: Optional[logging.Logger] = None) -> None:
        self._logger = logger or logging.getLogger("pantalla.backend.opensky.client")
        timeout = httpx.Timeout(2.5, connect=2.5, read=2.5)
        self._client = httpx.Client(base_url=self.BASE_URL, timeout=timeout)

    def close(self) -> None:
        self._client.close()

    def fetch_states(
        self,
        bbox: Optional[Tuple[float, float, float, float]],
        extended: int,
        token: Optional[str],
    ) -> Tuple[Dict[str, Any], Dict[str, str]]:
        params = {}
        if bbox:
            lamin, lamax, lomin, lomax = bbox
            params.update({
                "lamin": lamin,
                "lamax": lamax,
                "lomin": lomin,
                "lomax": lomax,
            })
        if extended:
            params["extended"] = 1
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        response = self._client.get("/states/all", params=params, headers=headers)
        remaining_header = response.headers.get("X-Rate-Limit-Remaining")
        headers_out = {}
        if remaining_header is not None:
            headers_out["X-Rate-Limit-Remaining"] = remaining_header
        if response.status_code == 429:
            self._logger.warning("[opensky] rate limit reached (429)")
            raise OpenSkyClientError("rate_limit", status=429)
        if response.status_code in {401, 403}:
            raise OpenSkyClientError("unauthorized", status=response.status_code)
        if response.status_code >= 500:
            raise OpenSkyClientError("upstream_error", status=response.status_code)
        if response.status_code >= 400:
            raise OpenSkyClientError("client_error", status=response.status_code)
        payload = response.json()
        if not isinstance(payload, dict):
            raise OpenSkyClientError("invalid_payload")
        return payload, headers_out

    @staticmethod
    def sanitize_states(
        payload: Dict[str, Any],
        max_aircraft: int,
    ) -> Tuple[int, int, List[Dict[str, Any]]]:
        ts = int(payload.get("time", int(time.time())))
        states = payload.get("states")
        if not isinstance(states, Iterable):
            return ts, 0, []
        items: List[Dict[str, any]] = []
        for entry in states:
            if not isinstance(entry, list) or len(entry) < 17:
                continue
            icao24 = (entry[0] or "").strip().lower()
            callsign = (entry[1] or "").strip()
            origin_country = (entry[2] or "").strip()
            time_position = entry[3]
            last_contact = entry[4]
            longitude = entry[5]
            latitude = entry[6]
            baro_altitude = entry[7]
            on_ground = bool(entry[8]) if entry[8] is not None else False
            velocity = entry[9]
            true_track = entry[10]
            vertical_rate = entry[11]
            geo_altitude = entry[13] if len(entry) > 13 else None
            squawk = entry[14] if len(entry) > 14 else None
            category = entry[17] if len(entry) > 17 else None

            if latitude is None or longitude is None:
                continue
            if not (-90.0 <= latitude <= 90.0 and -180.0 <= longitude <= 180.0):
                continue

            altitude = geo_altitude if geo_altitude is not None else baro_altitude
            timestamp = int(last_contact or time_position or ts)
            item = {
                "id": icao24 or callsign or f"unknown-{len(items)}",
                "icao24": icao24 or None,
                "callsign": callsign or None,
                "origin_country": origin_country or None,
                "lon": float(longitude),
                "lat": float(latitude),
                "alt": float(altitude) if altitude is not None else None,
                "velocity": float(velocity) if velocity is not None else None,
                "vertical_rate": float(vertical_rate) if vertical_rate is not None else None,
                "track": float(true_track) if true_track is not None else None,
                "on_ground": on_ground,
                "squawk": squawk,
                "category": category,
                "last_contact": timestamp,
            }
            items.append(item)
        if max_aircraft > 0 and len(items) > max_aircraft:
            items = items[:max_aircraft]
        return ts, len(items), items


__all__ = ["OpenSkyClient", "OpenSkyClientError"]
