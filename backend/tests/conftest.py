import importlib
import sys
import types
from pathlib import Path
from typing import Generator, Tuple

import pytest

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parents[1] / "default_config.json"

_REAL_HTTPX = importlib.import_module("httpx")
_DUMMY_HTTPX = types.ModuleType("httpx")
for _attr in dir(_REAL_HTTPX):
    setattr(_DUMMY_HTTPX, _attr, getattr(_REAL_HTTPX, _attr))


class _DummyTimeout:
    def __init__(self, *_: object, **__: object) -> None:
        pass


class _DummyResponse:
    status_code = 200

    @staticmethod
    def json() -> dict[str, object]:
        return {"access_token": "dummy", "expires_in": 3600}


class _DummyClient:
    def __init__(self, *_, **__):
        pass

    def close(self) -> None:  # noqa: D401 - simple stub
        return

    def post(self, *_: object, **__: object) -> _DummyResponse:
        return _DummyResponse()


_DUMMY_HTTPX.Timeout = _DummyTimeout
_DUMMY_HTTPX.Client = _DummyClient
_DUMMY_HTTPX.HTTPStatusError = Exception
_DUMMY_HTTPX.RequestError = Exception
_DUMMY_HTTPX.TimeoutException = Exception

sys.modules.setdefault("httpx", _DUMMY_HTTPX)


@pytest.fixture()
def app_module(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Generator[Tuple[object, Path], None, None]:
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    config_file = state_dir / "config.json"
    config_file.write_text(DEFAULT_CONFIG_PATH.read_text(encoding="utf-8"), encoding="utf-8")

    monkeypatch.setenv("PANTALLA_STATE_DIR", str(state_dir))
    monkeypatch.setenv("PANTALLA_CONFIG", str(config_file))
    monkeypatch.setenv("PANTALLA_DEFAULT_CONFIG_FILE", str(DEFAULT_CONFIG_PATH))

    monkeypatch.setitem(sys.modules, "httpx", _DUMMY_HTTPX)

    if "backend.config_manager" in sys.modules:
        del sys.modules["backend.config_manager"]
    if "backend.main" in sys.modules:
        del sys.modules["backend.main"]

    module = importlib.import_module("backend.main")
    yield module, config_file
