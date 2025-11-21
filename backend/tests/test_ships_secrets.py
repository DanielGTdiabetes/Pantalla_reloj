import asyncio
from typing import Tuple


def test_public_config_masks_aisstream_secret(app_module: Tuple[object, object]) -> None:
    module, _ = app_module
    module.secret_store.set_secret("aisstream_api_key", "AIS123456")

    public = module._build_public_config_v2(module.config_manager.read())
    ais_info = public["layers"]["ships"]["aisstream"]

    assert "api_key" not in ais_info
    assert ais_info["has_api_key"] is True
    assert ais_info["api_key_last4"] == "3456"


def test_update_aisstream_secret_persists(app_module: Tuple[object, object]) -> None:
    module, _ = app_module

    asyncio.run(module.update_aisstream_secret(module.AISStreamSecretRequest(api_key="AISKEY9999")))

    assert module.secret_store.get_secret("aisstream_api_key") == "AISKEY9999"
    public = module._build_public_config_v2(module.config_manager.read())
    ais_info = public["layers"]["ships"]["aisstream"]
    assert ais_info["has_api_key"] is True
    assert ais_info["api_key_last4"] == "9999"


def test_update_aisstream_secret_can_clear(app_module: Tuple[object, object]) -> None:
    module, _ = app_module
    module.secret_store.set_secret("aisstream_api_key", "TEMP0000")

    asyncio.run(module.update_aisstream_secret(module.AISStreamSecretRequest(api_key=None)))

    assert module.secret_store.get_secret("aisstream_api_key") is None
    public = module._build_public_config_v2(module.config_manager.read())
    ais_info = public["layers"]["ships"]["aisstream"]
    assert ais_info["has_api_key"] is False
    assert ais_info.get("api_key_last4") is None
