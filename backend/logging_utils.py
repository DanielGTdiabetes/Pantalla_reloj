from __future__ import annotations

import logging
import os
from pathlib import Path


def configure_logging() -> logging.Logger:
    logger = logging.getLogger("pantalla.backend")
    logger.setLevel(logging.INFO)

    if not logger.handlers:
        log_path = Path(os.getenv("PANTALLA_BACKEND_LOG", "/var/log/pantalla/backend.log"))
        stream_handler = logging.StreamHandler()
        handlers: list[logging.Handler] = [stream_handler]
        file_handler_error: OSError | None = None

        try:
            log_path.parent.mkdir(parents=True, exist_ok=True)
            file_handler = logging.FileHandler(log_path)
            handlers.append(file_handler)
        except OSError as exc:
            file_handler_error = exc

        formatter = logging.Formatter(
            "%(asctime)s [%(levelname)s] %(name)s - %(message)s", "%Y-%m-%d %H:%M:%S"
        )
        for handler in handlers:
            handler.setFormatter(formatter)
            logger.addHandler(handler)

        if file_handler_error is not None:
            logger.warning(
                "No se pudo abrir el log de backend en %s (%s). "
                "Continuando solo con salida a consola.",
                log_path,
                file_handler_error,
            )

    return logger


__all__ = ["configure_logging"]
