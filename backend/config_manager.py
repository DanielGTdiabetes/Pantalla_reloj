from __future__ import annotations

import grp
import hashlib
import json
import logging
import os
import pwd
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Literal, Optional, Tuple

from pydantic import ValidationError

from .models import AppConfig


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
                Path(__file__).resolve().parent / "default_config.json",
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
                if self.default_config_file.exists():
                    try:
                        self.config_file.write_text(
                            self.default_config_file.read_text(encoding="utf-8"),
                            encoding="utf-8",
                        )
                        os.chmod(self.config_file, 0o644)
                        self.logger.info("Created config file at %s from default template", self.config_file)
                        self.config_source = "file"
                    except (PermissionError, OSError) as exc:
                        self.logger.warning(
                            "Could not create config file at %s: %s", self.config_file, exc
                        )
                else:
                    try:
                        AppConfig().to_path(self.config_file)
                        os.chmod(self.config_file, 0o644)
                        self.logger.info("Created config file at %s from AppConfig() defaults", self.config_file)
                        self.config_source = "file"
                    except (PermissionError, OSError) as exc:
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
    
    def _normalize_timezone(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Normaliza timezone: mapea display.timezone a general.timezone si es necesario."""
        # Normalizar timezone: soportar tanto display.timezone como general.timezone
        if "display" in data and "timezone" in data.get("display", {}):
            timezone_value = data["display"]["timezone"]
            if timezone_value and "general" not in data:
                data["general"] = {}
            if timezone_value and "general" in data:
                if "timezone" not in data["general"]:
                    data["general"]["timezone"] = timezone_value
                    self.logger.debug(
                        "Mapped display.timezone to general.timezone: %s", timezone_value
                    )
        return data

    def _ensure_file_exists(self) -> None:
        """Asegura que el archivo de configuración existe (ya se maneja en _resolve_config_with_fallback)."""
        # La lógica de creación ya está en _resolve_config_with_fallback
        # Solo ajustar permisos si el archivo existe
        if self.config_file.exists():
            try:
                os.chmod(self.config_file, 0o644)
            except (PermissionError, OSError) as exc:
                self.logger.warning("Could not adjust permissions for %s: %s", self.config_file, exc)

    def read(self) -> AppConfig:
        """Lee la configuración con manejo robusto de errores y normalización."""
        config_data: Dict[str, Any]
        
        # Si se usó fallback embebido, usar defaults
        if self.config_source == "embedded_fallback":
            self.logger.debug("[config] Using embedded default config (fallback mode)")
            config_data = AppConfig().model_dump(mode="json")
            config = AppConfig.model_validate(config_data)
            config_hash = self._get_config_hash(config_data)
            self.logger.debug("[config] Embedded config hash (8 chars): %s", config_hash)
            if not self.config_loaded_at:
                self.config_loaded_at = datetime.now(timezone.utc).isoformat()
            return config
        
        # Leer desde archivo
        try:
            raw_text = self.config_file.read_text(encoding="utf-8")
            config_data = json.loads(raw_text)
            config_hash = self._get_config_hash(config_data)
            self.config_loaded_at = datetime.now(timezone.utc).isoformat()
            self.logger.debug("[config] Config hash (8 chars): %s", config_hash)
        except (json.JSONDecodeError, OSError, PermissionError) as exc:
            self.logger.error(
                "[config] Failed to read/parse config from %s: %s, using embedded defaults",
                self.config_file,
                exc,
            )
            self.config_source = "embedded_fallback"
            config_data = AppConfig().model_dump(mode="json")
            if not self.config_loaded_at:
                self.config_loaded_at = datetime.now(timezone.utc).isoformat()
        
        # Normalizar timezone
        config_data = self._normalize_timezone(config_data)
        
        # Migrar claves faltantes
        config_data, migrated = self._migrate_missing_keys(config_data)
        
        # Validar y crear modelo
        try:
            config = AppConfig.model_validate(config_data)
        except ValidationError as exc:
            self.logger.error(
                "[config] Invalid configuration in %s: %s, using embedded defaults",
                self.config_file,
                exc,
            )
            self.config_source = "embedded_fallback"
            config = AppConfig()
            if not self.config_loaded_at:
                self.config_loaded_at = datetime.now(timezone.utc).isoformat()
            try:
                self._atomic_write(config)
            except (PermissionError, OSError) as write_exc:
                self.logger.warning("[config] Could not write fixed config: %s", write_exc)
            return config
        
        # Si hubo migración, guardar
        if migrated:
            self.logger.info("[config] Applied configuration migrations for missing defaults")
            try:
                self._atomic_write(config)
                self._write_snapshot(config)
            except (PermissionError, OSError) as write_exc:
                self.logger.warning("[config] Could not persist migrated config: %s", write_exc)
        
        return config
    
    def reload(self) -> Tuple[AppConfig, bool]:
        """Recarga la configuración desde el archivo efectivo.
        
        Returns:
            Tuple de (config, was_reloaded)
        """
        old_loaded_at = self.config_loaded_at
        
        # Forzar recarga desde archivo
        if self.config_source == "embedded_fallback":
            self.logger.warning("[config] Cannot reload from embedded fallback")
            return self.read(), False
        
        # Leer y validar
        try:
            raw_text = self.config_file.read_text(encoding="utf-8")
            config_data = json.loads(raw_text)

            if isinstance(config_data, dict) and config_data.get("version") == 2:
                self.config_loaded_at = datetime.now(timezone.utc).isoformat()
                self.config_source = "file"
                self.logger.info(
                    "[config] Reloaded v2 configuration from %s (metadata refreshed only)",
                    self.config_file,
                )
                return AppConfig(), True

            # Normalizar timezone
            config_data = self._normalize_timezone(config_data)
            
            # Migrar claves faltantes
            config_data, migrated = self._migrate_missing_keys(config_data)
            
            # Validar
            config = AppConfig.model_validate(config_data)
            
            # Actualizar timestamp
            self.config_loaded_at = datetime.now(timezone.utc).isoformat()
            self.config_source = "file"
            
            # Guardar si hubo migración
            if migrated:
                self.logger.info("[config] Applied migrations during reload, persisting")
                try:
                    self._atomic_write(config)
                    self._write_snapshot(config)
                except (PermissionError, OSError) as write_exc:
                    self.logger.warning("[config] Could not persist migrated config: %s", write_exc)
            
            self.logger.info("[config] Reloaded config from %s", self.config_file)
            return config, True
            
        except (json.JSONDecodeError, ValidationError) as exc:
            self.logger.error(
                "[config] Failed to reload config from %s: %s",
                self.config_file,
                exc,
            )
            # Mantener configuración anterior
            return self.read(), False
        except (OSError, PermissionError) as exc:
            self.logger.error(
                "[config] Cannot read config file %s for reload: %s",
                self.config_file,
                exc,
            )
            return self.read(), False
    
    def get_config_metadata(self) -> Dict[str, Any]:
        """Retorna metadatos sobre la configuración cargada."""
        has_timezone = False
        try:
            config = self.read()
            # Verificar si hay timezone válido
            # Puede estar en general.timezone (v2) o display.timezone (v1)
            if hasattr(config, "display") and hasattr(config.display, "timezone"):
                tz = getattr(config.display, "timezone", None)
                has_timezone = bool(tz and str(tz).strip())
            # También verificar general si existe (para compatibilidad futura)
            elif hasattr(config, "general") and hasattr(config.general, "timezone"):
                tz = getattr(config.general, "timezone", None)
                has_timezone = bool(tz and str(tz).strip())
        except Exception as exc:  # noqa: BLE001
            self.logger.debug("Could not determine timezone from config: %s", exc)
        
        return {
            "config_path": self.config_path_used,
            "config_source": self.config_source_env,
            "has_timezone": has_timezone,
            "config_loaded_at": self.config_loaded_at,
        }

    def write(self, payload: Dict[str, Any]) -> AppConfig:
        config = AppConfig.model_validate(payload)
        self._atomic_write(config)
        self._write_snapshot(config)
        return config

    def _atomic_write(self, config: AppConfig) -> None:
        serialized = config.model_dump(mode="json", exclude_none=True)
        self._atomic_write_v2(serialized)
    
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

    def _write_snapshot(self, config: AppConfig) -> None:
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

    def _load_default_template(self) -> Dict[str, Any]:
        try:
            raw = self.default_config_file.read_text(encoding="utf-8")
        except OSError as exc:
            self.logger.warning("Could not read default config template %s: %s", self.default_config_file, exc)
            return AppConfig().model_dump(mode="json")
        try:
            data = json.loads(raw)
        except json.JSONDecodeError as exc:
            self.logger.warning(
                "Default config template %s is invalid JSON: %s", self.default_config_file, exc
            )
            return AppConfig().model_dump(mode="json")
        try:
            defaults_model = AppConfig.model_validate(data)
        except ValidationError as exc:
            self.logger.warning(
                "Default config template %s could not be parsed: %s", self.default_config_file, exc
            )
            return AppConfig().model_dump(mode="json")
        return defaults_model.model_dump(mode="json")

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
        
        # Eliminar cine_focus de layers si existe
        if "layers" in purged and isinstance(purged["layers"], dict):
            for layer_type in ["flights", "ships"]:
                if layer_type in purged["layers"] and isinstance(purged["layers"][layer_type], dict):
                    if "cine_focus" in purged["layers"][layer_type]:
                        del purged["layers"][layer_type]["cine_focus"]
                        changed = True
                        self.logger.info("[config] Removed layers.%s.cine_focus", layer_type)
        
        return purged, changed
    
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
            
            # Normalizar provider legacy
            provider_old = ui_map.get("provider", "xyz")
            if provider_old in ["xyz", "osm", "local"]:
                provider_new = "local_raster_xyz"
                if provider_old != provider_new:
                    ui_map["provider"] = provider_new
                    changed = True
                    self.logger.info("[config] Migrated ui_map.provider from '%s' to '%s'", provider_old, provider_new)
            elif provider_old == "maptiler":
                provider_new = "maptiler_vector"
                ui_map["provider"] = provider_new
                changed = True
                self.logger.info("[config] Migrated ui_map.provider from 'maptiler' to 'maptiler_vector'")
            
            # Migrar estructura según provider
            provider = ui_map.get("provider", "local_raster_xyz")
            
            # Si tiene xyz/xyz legacy, migrar a local o customXyz según el caso
            if "xyz" in ui_map and isinstance(ui_map["xyz"], dict):
                xyz_old = ui_map["xyz"]
                tile_url = xyz_old.get("urlTemplate")
                
                # Si es OSM, usar local_raster_xyz
                if tile_url and "openstreetmap" in tile_url.lower():
                    if provider != "local_raster_xyz":
                        ui_map["provider"] = "local_raster_xyz"
                        changed = True
                    if "local" not in ui_map:
                        ui_map["local"] = {
                            "tileUrl": tile_url,
                            "minzoom": xyz_old.get("minzoom", 0),
                            "maxzoom": xyz_old.get("maxzoom", 19)
                        }
                        changed = True
                        self.logger.info("[config] Migrated ui_map.xyz to ui_map.local")
                # Si es otro proveedor, usar customXyz
                elif tile_url:
                    if provider != "custom_xyz":
                        ui_map["provider"] = "custom_xyz"
                        changed = True
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
                api_key = maptiler_old.get("key")
                style_url = (
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
            
            # Asegurar que existen los 3 bloques (local, maptiler, customXyz)
            if "local" not in ui_map:
                ui_map["local"] = {
                    "tileUrl": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
                    "minzoom": 0,
                    "maxzoom": 19
                }
                changed = True
            
            if "maptiler" not in ui_map:
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
        # Primero purgar claves cinema
        purged_data, cinema_removed = self._purge_cinema_keys(data)
        
        # Migrar claves legacy de proveedores de mapa
        migrated_data, map_migrated = self._migrate_map_provider_keys(purged_data)
        
        # Luego aplicar migración de claves faltantes
        merged_data, keys_added = self._merge_missing_dict_keys(migrated_data, self._load_default_template())
        
        return merged_data, cinema_removed or map_migrated or keys_added


__all__ = ["ConfigManager"]
