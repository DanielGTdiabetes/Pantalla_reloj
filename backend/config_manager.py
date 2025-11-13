from __future__ import annotations

import grp
import hashlib
import json
import logging
import os
import pwd
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Literal, Optional, Tuple
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

from pydantic import ValidationError

from .models_v2 import AppConfigV2, MapConfig
from .config_migrator import migrate_v1_to_v2


class ConfigManager:
    """Utility class that handles persistent configuration for the dashboard."""

    def __init__(
        self,
        config_file: Path | None = None,
        default_config_file: Path | None = None,
    ) -> None:
        self.logger = logging.getLogger("pantalla.backend.config")
        
        # Resolución robusta de ruta de configuración
        # 1. ENV PANTALLA_CONFIG (prioridad absoluta)
        # 2. Ruta por defecto: /var/lib/pantalla-reloj/config.json
        # 3. Fallback embebido (se establece después)
        env_config = os.getenv("PANTALLA_CONFIG")
        if env_config:
            resolved_path = Path(env_config)
            self.logger.info("Using config path from PANTALLA_CONFIG env: %s", resolved_path)
        else:
            resolved_path = Path("/var/lib/pantalla-reloj/config.json")
            self.logger.info("Using default config path: %s", resolved_path)
        
        self.config_file = config_file or resolved_path
        self.default_config_file = default_config_file or Path(
            os.getenv(
                "PANTALLA_DEFAULT_CONFIG_FILE",
                Path(__file__).resolve().parent / "default_config_v2.json",
            )
        )
        
        # Trackear si se usó fallback
        self.config_source: Literal["file", "embedded_fallback"] = "file"
        self.config_path_used = str(self.config_file)
        self.config_source_env: Literal["env", "default"] = "env" if env_config else "default"
        self.config_loaded_at: Optional[str] = None
        
        # Detectar configs legacy y advertir
        self._detect_legacy_configs()
        
        # Resolver configuración con fallback
        self._resolve_config_with_fallback()
        
        # Directorios auxiliares
        state_path = Path(os.getenv("PANTALLA_STATE_DIR", "/var/lib/pantalla-reloj"))
        self.snapshot_dir = state_path / "config.snapshots"
        try:
            self.snapshot_dir.mkdir(parents=True, exist_ok=True)
        except (PermissionError, OSError) as exc:
            self.logger.warning("Could not create snapshot directory %s: %s", self.snapshot_dir, exc)
    
    def _detect_legacy_configs(self) -> None:
        """Detecta configs legacy y emite advertencias una única vez al arranque."""
        legacy_paths = [
            Path("/etc/pantalla-dash/config.json"),
            Path("/var/lib/pantalla/config.json"),
        ]
        
        for legacy_path in legacy_paths:
            if legacy_path.exists() and legacy_path != self.config_file:
                self.logger.warning(
                    "[config] Ignoring legacy config at %s; using %s",
                    legacy_path,
                    self.config_file,
                )
    
    def _resolve_config_with_fallback(self) -> None:
        """Resuelve el archivo de configuración con fallback claro y logs explícitos."""
        # Intentar usar el archivo configurado
        if self.config_file.exists():
            try:
                # Verificar permisos de lectura
                self.config_file.read_text(encoding="utf-8")
                self.config_source = "file"
                self.config_loaded_at = datetime.now(timezone.utc).isoformat()
                self.logger.info("[config] Loaded config from %s", self.config_file)
                return
            except (PermissionError, OSError) as exc:
                self.logger.warning(
                    "Cannot read config file %s (reason: %s), falling back to embedded default",
                    self.config_file,
                    exc,
                )
        else:
            self.logger.warning(
                "Config file %s does not exist, falling back to embedded default",
                self.config_file,
            )
        
        # Fallback: usar configuración embebida
        self.config_source = "embedded_fallback"
        self.logger.warning(
            "Using embedded default config (fallback). Reason: config file not accessible or missing"
        )
        
        # Intentar crear el archivo con defaults si es posible
        try:
            self.config_file.parent.mkdir(parents=True, exist_ok=True)
            if not self.config_file.exists():
                try:
                    defaults = self._default_config_model().model_dump(mode="json")
                    self._atomic_write_v2(defaults)
                    os.chmod(self.config_file, 0o644)
                    self.logger.info("Created config file at %s from default template", self.config_file)
                    self.config_source = "file"
                except (PermissionError, OSError, ValidationError) as exc:
                    self.logger.warning(
                        "Could not create config file at %s: %s", self.config_file, exc
                    )
        except (PermissionError, OSError) as exc:
            self.logger.warning(
                "Could not ensure config directory %s exists: %s",
                self.config_file.parent,
                exc,
            )
        
        # Actualizar path usado (puede ser el fallback embebido si no se pudo crear)
        self.config_path_used = str(self.config_file) if self.config_source == "file" else "embedded"
    
    def _get_config_hash(self, config_data: Dict[str, Any]) -> str:
        """Calcula hash corto (SHA256 8 chars) del config para diagnóstico."""
        config_str = json.dumps(config_data, sort_keys=True)
        hash_full = hashlib.sha256(config_str.encode("utf-8")).hexdigest()
        return hash_full[:8]
    
    def _ensure_file_exists(self) -> None:
        """Asegura que el archivo de configuración existe (ya se maneja en _resolve_config_with_fallback)."""
        # La lógica de creación ya está en _resolve_config_with_fallback
        # Solo ajustar permisos si el archivo existe
        if self.config_file.exists():
            try:
                os.chmod(self.config_file, 0o644)
            except (PermissionError, OSError) as exc:
                self.logger.warning("Could not adjust permissions for %s: %s", self.config_file, exc)

    def read(self) -> AppConfigV2:
        """Lee y valida la configuración (solo esquema v2)."""
        config_data: Dict[str, Any]

        if self.config_source == "embedded_fallback":
            self.logger.debug("[config] Using embedded default config (fallback mode)")
            config = self._default_config_model()
            config_data = config.model_dump(mode="json")
            config_hash = self._get_config_hash(config_data)
            self.logger.debug("[config] Embedded config hash (8 chars): %s", config_hash)
            if not self.config_loaded_at:
                self.config_loaded_at = datetime.now(timezone.utc).isoformat()
            return config

        try:
            raw_text = self.config_file.read_text(encoding="utf-8")
            config_data = json.loads(raw_text)
            config_hash = self._get_config_hash(config_data)
            self.config_loaded_at = datetime.now(timezone.utc).isoformat()
            self.config_source = "file"
            self.logger.debug("[config] Config hash (8 chars): %s", config_hash)
        except (json.JSONDecodeError, OSError, PermissionError) as exc:
            self.logger.error(
                "[config] Failed to read/parse config from %s: %s, using defaults",
                self.config_file,
                exc,
            )
            self.config_source = "embedded_fallback"
            config = self._default_config_model()
            if not self.config_loaded_at:
                self.config_loaded_at = datetime.now(timezone.utc).isoformat()
            return config

        migrated_v1 = False
        if not isinstance(config_data, dict) or config_data.get("version") != 2:
            backup_path = self.config_file.with_name("config_v1_backup.json")
            try:
                backup_path.write_text(json.dumps(config_data, indent=2, ensure_ascii=False), encoding="utf-8")
                self.logger.info("[config] Legacy configuration backed up at %s", backup_path)
            except OSError as exc:
                self.logger.warning("[config] Could not write legacy backup at %s: %s", backup_path, exc)
            config_data, _ = migrate_v1_to_v2(config_data if isinstance(config_data, dict) else {})
            migrated_v1 = True
            self.logger.info("[config] Migrated legacy config v1 -> v2")

        config_data, migrated_defaults = self._migrate_missing_keys(config_data)

        try:
            config = AppConfigV2.model_validate(config_data)
        except ValidationError as exc:
            self.logger.error(
                "[config] Invalid configuration in %s: %s; restoring defaults",
                self.config_file,
                exc,
            )
            config = self._default_config_model()
            try:
                self._atomic_write_v2(config.model_dump(mode="json", exclude_none=True))
            except (PermissionError, OSError) as write_exc:
                self.logger.warning("[config] Could not persist default config: %s", write_exc)
            return config

        if migrated_v1 or migrated_defaults:
            try:
                self._atomic_write_v2(config.model_dump(mode="json", exclude_none=True))
                self._write_snapshot(config)
            except (PermissionError, OSError) as write_exc:
                self.logger.warning("[config] Could not persist migrated config: %s", write_exc)

        return config
    
    def reload(self) -> Tuple[AppConfigV2, bool]:
        """Recarga configuración desde disco."""
        previous_loaded_at = self.config_loaded_at
        config = self.read()
        was_reloaded = self.config_loaded_at != previous_loaded_at and self.config_source == "file"
        return config, was_reloaded
    
    def _mask_maptiler_url(self, url: Optional[str]) -> Optional[str]:
        if not isinstance(url, str) or not url:
            return None
        try:
            parsed = urlparse(url)
        except Exception:
            return url
        query = parse_qs(parsed.query, keep_blank_values=True)
        if "key" in query:
            query["key"] = ["***"]
            masked_query = urlencode(query, doseq=True)
            return urlunparse(
                (
                    parsed.scheme,
                    parsed.netloc,
                    parsed.path,
                    parsed.params,
                    masked_query,
                    parsed.fragment,
                )
            )
        return url

    def get_config_metadata(self) -> Dict[str, Any]:
        """Retorna metadatos sobre la configuración cargada."""
        has_timezone = False
        map_provider = None
        map_style = None
        map_style_url = None
        satellite_enabled = None
        satellite_opacity = None
        satellite_overlay_enabled = None
        satellite_overlay_style_url = None
        try:
            config = self.read()
            if config.display and getattr(config.display, "timezone", None):
                tz = config.display.timezone
                has_timezone = bool(tz and str(tz).strip())
            ui_map = config.ui_map
            map_provider = ui_map.provider
            if ui_map.maptiler:
                map_style = ui_map.maptiler.style
                map_style_url = self._mask_maptiler_url(ui_map.maptiler.styleUrl)
            if ui_map.satellite:
                satellite_enabled = ui_map.satellite.enabled
                satellite_opacity = ui_map.satellite.opacity
                if ui_map.satellite.labels_overlay:
                    overlay = ui_map.satellite.labels_overlay
                    satellite_overlay_enabled = overlay.enabled
                    satellite_overlay_style_url = self._mask_maptiler_url(overlay.style_url)
        except Exception as exc:  # noqa: BLE001
            self.logger.debug("Could not determine timezone from config: %s", exc)
        
        return {
            "config_path": self.config_path_used,
            "config_source": self.config_source_env,
            "has_timezone": has_timezone,
            "config_loaded_at": self.config_loaded_at,
            "map_provider": map_provider,
            "map_style": map_style,
            "map_style_url": map_style_url,
            "satellite_enabled": satellite_enabled,
            "satellite_opacity": satellite_opacity,
            "satellite_overlay_enabled": satellite_overlay_enabled,
            "satellite_overlay_style_url": satellite_overlay_style_url,
        }

    def write(self, payload: Dict[str, Any]) -> AppConfigV2:
        config = AppConfigV2.model_validate(payload)
        self._atomic_write_v2(config.model_dump(mode="json", exclude_none=True))
        self._write_snapshot(config)
        return config
    
    def _atomic_write_v2(self, config_dict: Dict[str, Any]) -> None:
        """Escribe configuración de forma atómica usando tmp + mv.
        
        Args:
            config_dict: Diccionario con la configuración a persistir
        """
        self.config_file.parent.mkdir(parents=True, exist_ok=True)
        tmp_fd, tmp_path = tempfile.mkstemp(
            dir=str(self.config_file.parent),
            prefix=self.config_file.name + ".",
            suffix=".tmp",
        )
        try:
            os.fchmod(tmp_fd, 0o644)
            with os.fdopen(tmp_fd, "w", encoding="utf-8") as handle:
                json.dump(config_dict, handle, indent=2, ensure_ascii=False)
                handle.flush()
                os.fsync(handle.fileno())
            # Persistencia atómica: rename después de fsync
            os.replace(tmp_path, self.config_file)
            # Fsync del directorio para asegurar que el rename se persiste
            try:
                dir_fd = os.open(str(self.config_file.parent), os.O_RDONLY)
                try:
                    os.fsync(dir_fd)
                finally:
                    os.close(dir_fd)
            except OSError as exc:
                self.logger.debug("[config] Could not fsync directory after atomic write: %s", exc)
            try:
                user = pwd.getpwnam("dani")
                uid = user.pw_uid
            except KeyError:
                uid = -1
            try:
                gid = grp.getgrnam("dani").gr_gid
            except KeyError:
                gid = user.pw_gid if "user" in locals() else -1

            if uid >= 0 or gid >= 0:
                try:
                    os.chown(
                        self.config_file,
                        uid if uid >= 0 else -1,
                        gid if gid >= 0 else -1,
                    )
                except (PermissionError, OSError) as exc:
                    self.logger.debug(
                        "[config] Could not chown %s to dani:dani: %s",
                        self.config_file,
                        exc,
                    )
            try:
                os.chmod(self.config_file, 0o644)
            except (PermissionError, OSError) as exc:
                self.logger.debug(
                    "[config] Could not chmod %s to 0644: %s",
                    self.config_file,
                    exc,
                )
        finally:
            try:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
            except OSError:
                pass

    def _write_snapshot(self, config: AppConfigV2) -> None:
        today = datetime.now().strftime("%Y-%m-%d")
        snapshot_file = self.snapshot_dir / f"{today}.json"
        if snapshot_file.exists():
            return
        try:
            snapshot_file.write_text(
                json.dumps(config.model_dump(mode="json", exclude_none=True), indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
        except OSError as exc:
            self.logger.warning("Failed to write configuration snapshot %s: %s", snapshot_file, exc)

    def _default_config_model(self) -> AppConfigV2:
        try:
            raw = self.default_config_file.read_text(encoding="utf-8")
            data = json.loads(raw)
            return AppConfigV2.model_validate(data)
        except Exception as exc:  # noqa: BLE001
            self.logger.warning(
                "Falling back to minimal AppConfigV2 defaults (reason: %s)", exc
            )
            return AppConfigV2(ui_map=MapConfig())

    def _load_default_template(self) -> Dict[str, Any]:
        return self._default_config_model().model_dump(mode="json")

    def _merge_missing_dict_keys(
        self, source: Any, defaults: Any
    ) -> Tuple[Any, bool]:
        if not isinstance(source, dict) or not isinstance(defaults, dict):
            return source, False
        changed = False
        merged: Dict[str, Any] = dict(source)
        for key, default_value in defaults.items():
            if key not in merged:
                merged[key] = default_value
                changed = True
                continue
            existing_value = merged[key]
            if isinstance(existing_value, dict) and isinstance(default_value, dict):
                merged_child, child_changed = self._merge_missing_dict_keys(
                    existing_value, default_value
                )
                if child_changed:
                    merged[key] = merged_child
                    changed = True
        return merged, changed

    def _purge_cinema_keys(self, data: Dict[str, Any]) -> Tuple[Dict[str, Any], bool]:
        """Elimina todas las claves relacionadas con Cinema del diccionario de configuración.
        
        Args:
            data: Diccionario de configuración
            
        Returns:
            Tuple de (data_sin_cinema, was_changed)
        """
        changed = False
        purged = dict(data)
        
        # Eliminar claves top-level relacionadas con cinema
        cinema_keys_to_remove = []
        for key in purged.keys():
            key_lower = str(key).lower()
            if "cinema" in key_lower or "cinemode" in key_lower:
                cinema_keys_to_remove.append(key)
        
        for key in cinema_keys_to_remove:
            del purged[key]
            changed = True
            self.logger.info("[config] Removed cinema-related key: %s", key)
        
        # Recursivamente purgar dentro de estructuras anidadas
        if "ui" in purged and isinstance(purged["ui"], dict):
            if "map" in purged["ui"] and isinstance(purged["ui"]["map"], dict):
                # Eliminar ui.map.cinema
                if "cinema" in purged["ui"]["map"]:
                    del purged["ui"]["map"]["cinema"]
                    changed = True
                    self.logger.info("[config] Removed ui.map.cinema")
                # Eliminar ui.map.idlePan si depende de cinema (por ahora lo mantenemos)
        
        # Migrar rotation raíz a ui.rotation
        if "rotation" in purged and isinstance(purged["rotation"], dict):
            ui_block = purged.get("ui")
            if not isinstance(ui_block, dict):
                ui_block = {}
                purged["ui"] = ui_block

            existing_rotation = ui_block.get("rotation")
            if not isinstance(existing_rotation, dict) or not existing_rotation:
                ui_block["rotation"] = purged["rotation"]
                self.logger.info("[config] Migrated root.rotation to ui.rotation")
            # Eliminar siempre la clave legacy raíz
            del purged["rotation"]
            changed = True

        # Eliminar cine_focus de layers si existe
        if "layers" in purged and isinstance(purged["layers"], dict):
            for layer_type in ["flights", "ships"]:
                if layer_type in purged["layers"] and isinstance(purged["layers"][layer_type], dict):
                    if "cine_focus" in purged["layers"][layer_type]:
                        del purged["layers"][layer_type]["cine_focus"]
                        changed = True
                        self.logger.info("[config] Removed layers.%s.cine_focus", layer_type)
        
        return purged, changed
    
    def _migrate_maptiler_config(self, maptiler: Dict[str, Any]) -> Tuple[Dict[str, Any], bool]:
        """Migra y normaliza configuración de MapTiler.
        
        Aplica las siguientes reglas:
        1. Inyectar apiKey desde MAPTILER_API_KEY si está vacío
        2. Normalizar estilos obsoletos (dark, streets, bright) → streets-v2
        3. Si styleUrl no incluye ?key= y existe apiKey, añadir ?key=<apiKey>
        4. Si apiKey está presente y styleUrl vacío, set al streets-v2
        
        Args:
            maptiler: Diccionario de configuración MapTiler
            
        Returns:
            Tuple de (maptiler_migrado, was_changed)
        """
        changed = False
        migrated = dict(maptiler)
        api_key = migrated.get("apiKey") or migrated.get("api_key") or migrated.get("key")
        style_url = migrated.get("styleUrl")
        
        # Regla 1: Inyectar apiKey desde variable de entorno si está vacío
        if not api_key:
            env_api_key = os.getenv("MAPTILER_API_KEY")
            if env_api_key and env_api_key.strip():
                migrated["apiKey"] = env_api_key.strip()
                api_key = migrated["apiKey"]
                changed = True
                self.logger.info("[config] Injected MapTiler API key from MAPTILER_API_KEY env")
        
        # Normalizar apiKey a "apiKey"
        if "apiKey" not in migrated:
            if "api_key" in migrated:
                migrated["apiKey"] = migrated.pop("api_key")
                changed = True
            elif "key" in migrated:
                migrated["apiKey"] = migrated.pop("key")
                changed = True
        
        # Si aún no hay apiKey, no podemos hacer nada más
        if not api_key:
            return migrated, changed
        
        # Regla 2: Normalizar estilos obsoletos (dark, streets, bright) → streets-v2
        if style_url:
            style_url = str(style_url).strip()
            
            # Detectar estilos obsoletos: /maps/(dark|streets|bright)/style.json (con o sin ?key=)
            legacy_pattern = re.compile(r'/maps/(dark|streets|bright)(?:-v2)?/style\.json', re.IGNORECASE)
            if legacy_pattern.search(style_url):
                # Reescribir a streets-v2
                base_url = "https://api.maptiler.com/maps/streets-v2/style.json"
                
                # Extraer query params existentes
                parsed = urlparse(style_url)
                query_params = parse_qs(parsed.query, keep_blank_values=True)
                
                # Añadir o reemplazar key=
                query_params["key"] = [api_key]
                
                # Reconstruir URL
                new_query = urlencode(query_params, doseq=True)
                new_style_url = f"{base_url}?{new_query}" if new_query else f"{base_url}?key={api_key}"
                
                migrated["styleUrl"] = new_style_url
                changed = True
                self.logger.info("[config] Normalized legacy MapTiler style to streets-v2")
                return migrated, changed
            
            # Si ya es un estilo *-v2 válido, solo añadir key si falta
            is_v2_style = "-v2" in style_url or "streets-v2" in style_url or "dark-v2" in style_url or "bright-v2" in style_url
            has_key_param = "?key=" in style_url or "&key=" in style_url
            
            if is_v2_style:
                # Si es v2 y ya tiene key, no hacer nada más
                if has_key_param:
                    return migrated, changed
                # Si es v2 pero no tiene key, añadirlo
                separator = "&" if "?" in style_url else "?"
                migrated["styleUrl"] = f"{style_url}{separator}key={api_key}"
                changed = True
                self.logger.info("[config] Added ?key= parameter to MapTiler styleUrl")
                return migrated, changed
            
            # Si no es v2 ni legacy, añadir key si falta
            if not has_key_param:
                separator = "&" if "?" in style_url else "?"
                migrated["styleUrl"] = f"{style_url}{separator}key={api_key}"
                changed = True
                self.logger.info("[config] Added ?key= parameter to MapTiler styleUrl")
                return migrated, changed
        else:
            # Regla 4: Si apiKey está presente y styleUrl vacío, set streets-v2
            new_style_url = f"https://api.maptiler.com/maps/streets-v2/style.json?key={api_key}"
            migrated["styleUrl"] = new_style_url
            changed = True
            self.logger.info("[config] Set default MapTiler style to streets-v2")
            return migrated, changed
        
        return migrated, changed
    
    def _migrate_map_provider_keys(self, data: Dict[str, Any]) -> Tuple[Dict[str, Any], bool]:
        """Migra claves legacy de proveedores de mapa a la nueva estructura.
        
        Args:
            data: Diccionario de configuración
            
        Returns:
            Tuple de (data_migrado, was_changed)
        """
        changed = False
        migrated = dict(data)
        
        # Para v2, migrar ui_map
        if "ui_map" in migrated and isinstance(migrated["ui_map"], dict):
            ui_map = migrated["ui_map"]
            
            # Detectar provider actual (sin default agresivo)
            provider_old = str(ui_map.get("provider", "")).strip() or ""
            
            # Detectar MapTiler válido (apiKey + styleUrl presentes)
            maptiler_config = ui_map.get("maptiler")
            maptiler_api_key = None
            maptiler_style_url = None

            if isinstance(maptiler_config, dict):
                maptiler_api_key = maptiler_config.get("apiKey") or maptiler_config.get("api_key") or maptiler_config.get("key")
                maptiler_style_url = maptiler_config.get("styleUrl") or maptiler_config.get("styleUrlDark") or maptiler_config.get("styleUrlLight") or maptiler_config.get("styleUrlBright")

            has_valid_maptiler = bool(
                maptiler_api_key and str(maptiler_api_key).strip() and
                maptiler_style_url and str(maptiler_style_url).strip()
            )
            
            # 1) Si MapTiler está válidamente configurado (apiKey + styleUrl), preservar o migrar a maptiler_vector
            if has_valid_maptiler:
                if provider_old in {"maptiler", "maptiler_vector"}:
                    # Si es "maptiler", migrar a "maptiler_vector"
                    if provider_old == "maptiler":
                        ui_map["provider"] = "maptiler_vector"
                        changed = True
                        self.logger.info("[config] Migrated ui_map.provider from 'maptiler' to 'maptiler_vector' (preserving MapTiler config)")
                    # Si ya es "maptiler_vector", no cambiar
                else:
                    # Si provider no es maptiler pero hay config válida, cambiar a maptiler_vector
                    ui_map["provider"] = "maptiler_vector"
                    changed = True
                    self.logger.info("[config] Set ui_map.provider to 'maptiler_vector' (valid MapTiler config found)")
            # 2) Si NO hay MapTiler válido pero hay provider válido, respetarlo (no tocar)
            elif provider_old:
                # Migrar nombre legacy "maptiler" → "maptiler_vector" incluso sin config válida
                if provider_old == "maptiler":
                    ui_map["provider"] = "maptiler_vector"
                    changed = True
                    self.logger.info("[config] Migrated ui_map.provider from 'maptiler' to 'maptiler_vector'")
                # Otros providers válidos se respetan sin cambios
            # 3) Si no hay nada, fallback a local_raster_xyz
            else:
                if ui_map.get("provider") != "local_raster_xyz":
                    ui_map["provider"] = "local_raster_xyz"
                    changed = True
                    self.logger.info("[config] Defaulting ui_map.provider to local_raster_xyz (no provider/key found)")
            
            # Migrar estructura según provider (sin forzar cambio de provider aquí)
            provider = str(ui_map.get("provider") or "").strip()
            
            # Si tiene xyz/xyz legacy, migrar a local o customXyz según el caso
            # Solo cambia provider si está vacío
            if "xyz" in ui_map and isinstance(ui_map["xyz"], dict):
                xyz_old = ui_map["xyz"]
                tile_url = (xyz_old.get("urlTemplate") or "").strip()
                provider_cur = str(ui_map.get("provider") or "").strip()
                
                if tile_url:
                    # Si es OSM, usar local_raster_xyz (solo si provider está vacío)
                    if "openstreetmap" in tile_url.lower():
                        if not provider_cur:
                            ui_map["provider"] = "local_raster_xyz"
                            changed = True
                            self.logger.info("[config] Set provider to local_raster_xyz due to OSM XYZ")
                        if "local" not in ui_map:
                            ui_map["local"] = {
                                "tileUrl": tile_url,
                                "minzoom": xyz_old.get("minzoom", 0),
                                "maxzoom": xyz_old.get("maxzoom", 19)
                            }
                            changed = True
                            self.logger.info("[config] Migrated ui_map.xyz to ui_map.local")
                    # Si es otro proveedor, usar customXyz (solo si provider está vacío)
                    else:
                        if not provider_cur:
                            ui_map["provider"] = "custom_xyz"
                            changed = True
                            self.logger.info("[config] Set provider to custom_xyz due to non-OSM XYZ")
                        if "customXyz" not in ui_map:
                            ui_map["customXyz"] = {
                                "tileUrl": tile_url,
                                "minzoom": xyz_old.get("minzoom", 0),
                                "maxzoom": xyz_old.get("maxzoom", 19)
                            }
                            changed = True
                            self.logger.info("[config] Migrated ui_map.xyz to ui_map.customXyz")
                
                # Eliminar xyz legacy
                del ui_map["xyz"]
                changed = True
                self.logger.info("[config] Removed legacy ui_map.xyz")
            
            # Eliminar labelsOverlay legacy
            if "labelsOverlay" in ui_map:
                del ui_map["labelsOverlay"]
                changed = True
                self.logger.info("[config] Removed legacy ui_map.labelsOverlay")
            
            # Migrar maptiler legacy
            if "maptiler" in ui_map and isinstance(ui_map["maptiler"], dict):
                maptiler_old = ui_map["maptiler"]
                # Si tiene key/styleUrlDark/Light/Bright legacy, normalizar
                api_key = maptiler_old.get("apiKey") or maptiler_old.get("api_key") or maptiler_old.get("key")
                style_url = (
                    maptiler_old.get("styleUrl") or
                    maptiler_old.get("styleUrlDark") or
                    maptiler_old.get("styleUrlLight") or
                    maptiler_old.get("styleUrlBright")
                )
                
                # Actualizar a la nueva estructura
                ui_map["maptiler"] = {
                    "apiKey": api_key,
                    "styleUrl": style_url
                }
                changed = True
                self.logger.info("[config] Migrated ui_map.maptiler to new structure")
            
            # Aplicar migración automática de MapTiler si el proveedor es maptiler_vector o si hay config válida
            if "maptiler" in ui_map and isinstance(ui_map["maptiler"], dict):
                maptiler_migrated, maptiler_changed = self._migrate_maptiler_config(ui_map["maptiler"])
                if maptiler_changed:
                    ui_map["maptiler"] = maptiler_migrated
                    changed = True
            
            # Asegurar que existen los 3 bloques (local, maptiler, customXyz)
            # Sin cambiar provider aquí
            if "local" not in ui_map:
                ui_map["local"] = {
                    "tileUrl": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
                    "minzoom": 0,
                    "maxzoom": 19
                }
                changed = True
            
            # Si provider es maptiler_vector pero falta el bloque, crear bloque vacío (sin cambiar provider)
            if ui_map.get("provider") == "maptiler_vector" and "maptiler" not in ui_map:
                ui_map["maptiler"] = {"apiKey": None, "styleUrl": None}
                changed = True
            # Si no hay bloque maptiler, crear uno vacío
            elif "maptiler" not in ui_map:
                ui_map["maptiler"] = {"apiKey": None, "styleUrl": None}
                changed = True
            
            if "customXyz" not in ui_map:
                ui_map["customXyz"] = {"tileUrl": None, "minzoom": 0, "maxzoom": 19}
                changed = True
            
            # Asegurar renderWorldCopies, interactive, controls
            if "renderWorldCopies" not in ui_map:
                ui_map["renderWorldCopies"] = True
                changed = True
            if "interactive" not in ui_map:
                ui_map["interactive"] = False
                changed = True
            if "controls" not in ui_map:
                ui_map["controls"] = False
                changed = True
        
        return migrated, changed
    
    def _migrate_missing_keys(self, data: Dict[str, Any]) -> Tuple[Dict[str, Any], bool]:
        merged_data, keys_added = self._merge_missing_dict_keys(
            data if isinstance(data, dict) else {},
            self._load_default_template(),
        )
        return merged_data, keys_added


__all__ = ["ConfigManager"]
