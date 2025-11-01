from __future__ import annotations

import json
import os
import tempfile
import threading
from pathlib import Path
from typing import Dict, Optional


class SecretStore:
    """Secret store backed by a single JSON file with atomic writes (0600).

    Default location is controlled by env var PANTALLA_SECRETS_FILE
    (fallback: /opt/pantalla-reloj/secrets.json).
    """

    def __init__(self, file_path: Path | None = None) -> None:
        state_dir = Path(os.getenv("PANTALLA_STATE_DIR", "/var/lib/pantalla"))
        default_path = Path(os.getenv("PANTALLA_SECRETS_FILE", str(state_dir / "secrets.json")))
        self._file = file_path or default_path
        self._file.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        # Ensure file exists with correct perms
        if not self._file.exists():
            try:
                self._atomic_write({})
            except Exception:
                # Best-effort; errors handled on load
                pass
        else:
            try:
                os.chmod(self._file, 0o600)
            except PermissionError:
                pass

    # ------------------------ Internal helpers ------------------------
    def _load(self) -> Dict[str, str]:
        try:
            raw = self._file.read_text(encoding="utf-8")
        except FileNotFoundError:
            return {}
        except OSError:
            return {}
        if not raw.strip():
            return {}
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        if isinstance(data, dict):
            # Keep only string values
            return {k: str(v) for k, v in data.items() if isinstance(k, str) and isinstance(v, str)}
        return {}

    def _atomic_write(self, payload: Dict[str, str]) -> None:
        directory = self._file.parent
        directory.mkdir(parents=True, exist_ok=True)
        fd, tmp_path = tempfile.mkstemp(prefix=self._file.name + ".", dir=str(directory))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as tmp:
                tmp.write(json.dumps(payload, ensure_ascii=False))
            os.replace(tmp_path, self._file)
            os.chmod(self._file, 0o600)
        finally:
            try:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
            except OSError:
                pass

    # ------------------------ Public API ------------------------
    def set_secret(self, name: str, value: Optional[str]) -> None:
        key = str(name).strip()
        if not key:
            return
        with self._lock:
            current = self._load()
            if value is None or value == "":
                current.pop(key, None)
            else:
                current[key] = value
            self._atomic_write(current)

    def get_secret(self, name: str) -> Optional[str]:
        key = str(name).strip()
        if not key:
            return None
        current = self._load()
        value = current.get(key)
        if not value:
            return None
        return value.strip() or None

    def has_secret(self, name: str) -> bool:
        return self.get_secret(name) is not None


__all__ = ["SecretStore"]
