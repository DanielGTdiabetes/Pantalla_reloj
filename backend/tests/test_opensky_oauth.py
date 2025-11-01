from __future__ import annotations

from typing import Tuple

from fastapi.testclient import TestClient


def test_opensky_credentials_are_masked_and_persisted(app_module: Tuple[object, object]) -> None:
    module, _ = app_module
    client = TestClient(module.app)

    response = client.post(
        "/api/config",
        json={
            "opensky": {
                "oauth2": {
                    "client_id": "demo-client-1234",
                    "client_secret": "super-secret-9876",
                }
            }
        },
    )
    assert response.status_code == 200

    assert module.secret_store.get_secret("opensky_client_id") == "demo-client-1234"
    assert module.secret_store.get_secret("opensky_client_secret") == "super-secret-9876"

    stored_config = module.config_manager.read()
    assert stored_config.opensky.oauth2.has_credentials is True
    assert stored_config.opensky.oauth2.client_id_last4 == "1234"

    public_config = client.get("/api/config")
    assert public_config.status_code == 200
    payload = public_config.json()
    oauth_public = payload["opensky"]["oauth2"]
    assert "client_id" not in oauth_public
    assert "client_secret" not in oauth_public
    assert oauth_public["has_credentials"] is True
    assert oauth_public["client_id_last4"] == "1234"

    # Blank updates should be ignored
    skip_update = client.post(
        "/api/config",
        json={"opensky": {"oauth2": {"client_id": "   ", "client_secret": ""}}},
    )
    assert skip_update.status_code == 200
    assert module.secret_store.get_secret("opensky_client_id") == "demo-client-1234"
    assert module.secret_store.get_secret("opensky_client_secret") == "super-secret-9876"

    # Health endpoint should expose auth metadata without leaking the secret
    health = client.get("/api/health")
    assert health.status_code == 200
    health_payload = health.json()
    opensky_provider = health_payload["providers"]["opensky"]
    auth_block = opensky_provider["auth"]
    assert auth_block["has_credentials"] is True
    assert auth_block["token_cached"] is False

    # Explicit null clears credentials
    cleared = client.post(
        "/api/config",
        json={"opensky": {"oauth2": {"client_id": None, "client_secret": None}}},
    )
    assert cleared.status_code == 200
    assert module.secret_store.get_secret("opensky_client_id") is None
    assert module.secret_store.get_secret("opensky_client_secret") is None

    refreshed = client.get("/api/config")
    assert refreshed.status_code == 200
    refreshed_payload = refreshed.json()["opensky"]["oauth2"]
    assert refreshed_payload["has_credentials"] is False
    assert refreshed_payload["client_id_last4"] is None
