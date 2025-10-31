from __future__ import annotations

from __future__ import annotations

import os
import threading
from pathlib import Path
from typing import Optional


class SecretStore:
    """Simple secret store that keeps secrets in files with strict permissions."""

    def __init__(self, base_dir: Path | None = None) -> None:
        state_dir = Path(os.getenv("PANTALLA_STATE_DIR", "/var/lib/pantalla"))
        self._base_dir = base_dir or Path(
            os.getenv("PANTALLA_SECRET_DIR", state_dir / "secrets")
        )
        self._base_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def _path(self, name: str) -> Path:
        sanitized = name.replace("/", "_")
        return self._base_dir / sanitized

    def set_secret(self, name: str, value: Optional[str]) -> None:
        path = self._path(name)
        with self._lock:
            if value is None or value == "":
                path.unlink(missing_ok=True)
                return
            path.write_text(value, encoding="utf-8")
            os.chmod(path, 0o600)

    def get_secret(self, name: str) -> Optional[str]:
        path = self._path(name)
        if not path.exists():
            return None
        try:
            return path.read_text(encoding="utf-8").strip() or None
        except OSError:
            return None

    def has_secret(self, name: str) -> bool:
        return self.get_secret(name) is not None


__all__ = ["SecretStore"]
