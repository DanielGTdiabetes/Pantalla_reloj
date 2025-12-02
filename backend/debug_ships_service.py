import asyncio
import logging
import sys
import os
from pathlib import Path

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("debug_ships")

from backend.services.ships_service import AISStreamService
from backend.models import ShipsLayerConfig, AISStreamProviderConfig, ShipsBBoxConfig

async def run_debug():
    class SimpleSecretStore:
        def get_secret(self, key):
            return "38dd87bbfef35a1f4dc6133293bed27f0e2c9ff7"
        def has_secret(self, key):
            return True

    class SimpleCacheStore:
        def store(self, key, value):
            pass
        def load(self, key, max_age_minutes=None):
            return None

    print("Initializing AISStreamService...")
    service = AISStreamService(
        cache_store=SimpleCacheStore(),
        secret_store=SimpleSecretStore(),
        logger=logger
    )

    # Configure
    config = ShipsLayerConfig(
        enabled=True,
        provider="aisstream",
        aisstream=AISStreamProviderConfig(
            ws_url="wss://stream.aisstream.io/v0/stream",
            bbox=ShipsBBoxConfig(
                lamin=36.0,
                lamax=44.0,
                lomin=-10.0,
                lomax=5.0
            )
        )
    )

    print("Applying config...")
    service.apply_config(config)

    print("Waiting for ships (20s)...")
    for i in range(20):
        await asyncio.sleep(1)
        snapshot = service.get_snapshot()
        if snapshot:
            count = len(snapshot.get("features", []))
            print(f"[{i}s] Ships found: {count}")
            if count > 0:
                print("First ship:", snapshot["features"][0])
        else:
            print(f"[{i}s] No snapshot yet")
    
    print("Stopping service...")
    service.close()

if __name__ == "__main__":
    asyncio.run(run_debug())
