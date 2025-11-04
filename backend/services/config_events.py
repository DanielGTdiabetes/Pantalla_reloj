"""
Servicio de eventos SSE para cambios de configuración.
Permite que el frontend (kiosk) se suscriba a cambios en tiempo real.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

log = logging.getLogger("config_events")

# Bus de eventos en memoria (lista de colas de suscriptores)
_event_subscribers: List[asyncio.Queue] = []
_subscribers_lock = asyncio.Lock()


async def subscribe() -> asyncio.Queue:
    """
    Suscribe un cliente SSE al bus de eventos.
    
    Returns:
        Queue que recibirá eventos config_changed
    """
    queue: asyncio.Queue = asyncio.Queue()
    async with _subscribers_lock:
        _event_subscribers.append(queue)
    log.info("[config-events] Nuevo suscriptor SSE (total: %d)", len(_event_subscribers))
    return queue


async def unsubscribe(queue: asyncio.Queue) -> None:
    """
    Desuscribe un cliente SSE del bus de eventos.
    
    Args:
        queue: Queue del cliente a desuscribir
    """
    async with _subscribers_lock:
        try:
            _event_subscribers.remove(queue)
            log.info("[config-events] Suscriptor desuscrito (total: %d)", len(_event_subscribers))
        except ValueError:
            pass  # Ya no estaba en la lista


async def publish_event(event_type: str, data: Dict[str, Any]) -> None:
    """
    Publica un evento en el bus para todos los suscriptores.
    
    Args:
        event_type: Tipo de evento (ej: "config_changed")
        data: Datos del evento
    """
    event = {
        "type": event_type,
        "data": data,
        "ts": int(datetime.now(timezone.utc).timestamp())
    }
    
    async with _subscribers_lock:
        subscribers = list(_event_subscribers)  # Copia para no bloquear mientras iteramos
    
    if not subscribers:
        log.debug("[config-events] No hay suscriptores para evento %s", event_type)
        return
    
    log.info("[config-events] Publicando evento %s a %d suscriptores", event_type, len(subscribers))
    
    # Enviar evento a todos los suscriptores
    for queue in subscribers:
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            log.warning("[config-events] Queue llena para un suscriptor, saltando evento")
        except Exception as e:
            log.warning("[config-events] Error enviando evento a suscriptor: %s", e)


def publish_config_changed_sync(
    config_path: str,
    changed_groups: List[str] | None = None
) -> None:
    """
    Versión síncrona de publish_config_changed para usar desde funciones no-async.
    Crea un nuevo event loop si es necesario.
    
    Args:
        config_path: Ruta al archivo de configuración
        changed_groups: Lista de grupos que cambiaron (None = "all")
    """
    import asyncio
    
    try:
        # Intentar obtener el loop actual
        loop = asyncio.get_event_loop()
        if loop.is_running():
            # Si el loop está corriendo, crear tarea
            asyncio.create_task(publish_config_changed_async(config_path, changed_groups))
        else:
            # Si no está corriendo, ejecutar directamente
            loop.run_until_complete(publish_config_changed_async(config_path, changed_groups))
    except RuntimeError:
        # Si no hay loop, crear uno nuevo
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop.run_until_complete(publish_config_changed_async(config_path, changed_groups))
            loop.close()
        except Exception as e:
            log.warning("[config-events] Error creando loop para publicar evento: %s", e)


async def publish_config_changed_async(
    config_path: str,
    changed_groups: List[str] | None = None
) -> None:
    """
    Publica evento config_changed con checksum del archivo.
    
    Args:
        config_path: Ruta al archivo de configuración
        changed_groups: Lista de grupos que cambiaron (None = "all")
    """
    from pathlib import Path
    
    try:
        config_file = Path(config_path)
        if not config_file.exists():
            log.warning("[config-events] No se puede calcular checksum: archivo no existe")
            return
        
        # Leer archivo y calcular checksum
        config_content = config_file.read_text(encoding="utf-8")
        config_dict = json.loads(config_content)
        config_str = json.dumps(config_dict, sort_keys=True)
        checksum = hashlib.sha256(config_str.encode("utf-8")).hexdigest()
        
        # Publicar evento
        await publish_event(
            "config_changed",
            {
                "checksum": checksum,
                "changed_groups": changed_groups if changed_groups is not None else ["all"],
                "ts": int(datetime.now(timezone.utc).timestamp())
            }
        )
    except Exception as e:
        log.error("[config-events] Error publicando evento config_changed: %s", e, exc_info=True)


# Alias para compatibilidad (por defecto usar async)
publish_config_changed = publish_config_changed_async


async def send_heartbeat(queue: asyncio.Queue) -> bool:
    """
    Envía un heartbeat para mantener viva la conexión SSE.
    
    Args:
        queue: Queue del suscriptor
        
    Returns:
        True si se envió exitosamente, False si hay error
    """
    try:
        queue.put_nowait({
            "type": "heartbeat",
            "data": {"ts": int(datetime.now(timezone.utc).timestamp())},
            "ts": int(datetime.now(timezone.utc).timestamp())
        })
        return True
    except Exception:
        return False

