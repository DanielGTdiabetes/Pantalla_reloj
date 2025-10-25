from __future__ import annotations

import logging
import os
from pathlib import Path


def configure_logging() -> logging.Logger:
    log_path = Path(os.getenv("PANTALLA_BACKEND_LOG", "/var/log/pantalla/backend.log"))
    log_path.parent.mkdir(parents=True, exist_ok=True)

    logger = logging.getLogger("pantalla.backend")
    logger.setLevel(logging.INFO)

    if not logger.handlers:
        handler = logging.FileHandler(log_path)
        formatter = logging.Formatter(
            "%(asctime)s [%(levelname)s] %(name)s - %(message)s", "%Y-%m-%d %H:%M:%S"
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)

        stream_handler = logging.StreamHandler()
        stream_handler.setFormatter(formatter)
        logger.addHandler(stream_handler)

    return logger


__all__ = ["configure_logging"]
