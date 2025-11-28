import asyncio
from typing import Tuple


def test_public_config_masks_openweather_secret(app_module: Tuple[object, object]) -> None:
    module, _ = app_module
    module.secret_store.set_secret("openweathermap_api_key", "OWM123456")

    public = module._build_public_config(module.config_manager.read())
    radar_info = public["layers"]["global"]["radar"]

    assert "api_key" not in radar_info
    assert radar_info["has_api_key"] is True
    assert radar_info["api_key_last4"] == "3456"


def test_update_openweather_secret_persists(app_module: Tuple[object, object]) -> None:
    module, _ = app_module

    asyncio.run(
        module.update_openweather_secret(module.OpenWeatherMapSecretRequest(api_key="OWMKEY9999"))
    )

    assert module.secret_store.get_secret("openweathermap_api_key") == "OWMKEY9999"
    public = module._build_public_config(module.config_manager.read())
    radar_info = public["layers"]["global"]["radar"]
    assert radar_info["has_api_key"] is True
    assert radar_info["api_key_last4"] == "9999"

    secret_meta = module.get_openweather_secret_meta()
    assert secret_meta == {"has_api_key": True, "api_key_last4": "9999"}


def test_update_openweather_secret_can_clear(app_module: Tuple[object, object]) -> None:
    module, _ = app_module
    module.secret_store.set_secret("openweathermap_api_key", "TEMP0000")

    asyncio.run(module.update_openweather_secret(module.OpenWeatherMapSecretRequest(api_key=None)))

    assert module.secret_store.get_secret("openweathermap_api_key") is None
    public = module._build_public_config(module.config_manager.read())
    radar_info = public["layers"]["global"]["radar"]
    assert radar_info["has_api_key"] is False
    assert radar_info.get("api_key_last4") is None

    secret_meta = module.get_openweather_secret_meta()
    assert secret_meta == {"has_api_key": False, "api_key_last4": None}
