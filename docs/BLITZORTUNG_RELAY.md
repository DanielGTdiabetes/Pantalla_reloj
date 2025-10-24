# Blitzortung MQTT Relay

Este proyecto utiliza un **relay MQTT** para consumir los rayos de Blitzortung en lugar de conectarse directamente por WebSocket. El backend levanta un consumidor interno que se encarga de recibir los mensajes del broker remoto, almacenarlos para la UI y republicarlos en el Mosquitto local (`127.0.0.1:1883`) bajo el prefijo `blitzortung/relay/#`.

## Configuración

El fichero `/etc/pantalla-dash/config.json` (y los ejemplos en `backend/config/`) incorporan la sección `blitzortung`:

```json
"blitzortung": {
  "mode": "mqtt",
  "enabled": true,
  "mqtt": {
    "host": "RELLENAR",
    "port": 8883,
    "ssl": true,
    "username": null,
    "password": null,
    "baseTopic": "RELLENAR/base",
    "geohash": null,
    "radius_km": 100
  }
}
```

Campos principales:

| Clave | Descripción |
| --- | --- |
| `mode` | `mqtt` por defecto. `ws` queda como stub legacy. |
| `enabled` | Permite desactivar el consumer sin tocar el resto de la configuración. |
| `mqtt.host` / `mqtt.port` | Broker del relay remoto (por ejemplo el servicio público TLS). |
| `mqtt.ssl` | Activa TLS al conectar. |
| `mqtt.username` / `mqtt.password` | Credenciales si el broker lo requiere. |
| `mqtt.baseTopic` | Prefijo publicado por el relay (según su documentación). |
| `mqtt.geohash` | Filtra por geohash si el relay organiza los topics por zonas. |
| `mqtt.radius_km` | Radios admitidos por algunos relays; se expone en el endpoint de estado. |

> 💡 La configuración legacy (`storm.provider=blitzortung` + `mqtt.host/port`) sigue funcionando: si no existe la sección `blitzortung`, el backend adapta esos valores automáticamente.

## Estado del consumer

El backend expone `GET /api/storms/blitz/status` con información diagnóstica:

```json
{
  "mode": "mqtt",
  "enabled": true,
  "connected": true,
  "subscribed_topics": ["relay/base/#"],
  "remote_base_topic": "relay/base",
  "relay_topic": "blitzortung/relay",
  "last_message_at": 1710000000.0
}
```

Puedes verificar que Mosquitto recibe los eventos locales con:

```bash
mosquitto_sub -h 127.0.0.1 -t 'blitzortung/#' -v
```

## Servicio opcional de usuario

El consumidor se arranca automáticamente junto al backend, pero si prefieres desacoplarlo puedes crear la unidad `~/.config/systemd/user/blitz_mqtt_relay.service` y habilitarla con `systemctl --user enable --now blitz_mqtt_relay.service`:

```ini
[Unit]
Description=Blitzortung MQTT Relay Consumer
After=network-online.target

[Service]
Type=simple
Environment=PYTHONUNBUFFERED=1
ExecStart=%h/proyectos/Pantalla_reloj/backend/.venv/bin/python3 -m backend.services.blitz_consumer
WorkingDirectory=%h/proyectos/Pantalla_reloj/backend
Restart=always
RestartSec=5
StandardOutput=append:/var/log/pantalla/blitz_mqtt_relay.log
StandardError=append:/var/log/pantalla/blitz_mqtt_relay.err

[Install]
WantedBy=default.target
```

## Instalación en dos fases

- `scripts/install.sh` prepara el sistema sin depender de D-Bus (paquetes, venv, Mosquitto en loopback, configuración).
- `scripts/install_post.sh` se ejecuta con sesión de usuario y se encarga de `loginctl enable-linger`, activar servicios de usuario y esperar a que el backend responda antes de precargar endpoints.

En entornos sin `systemd --user`, el script mostrará avisos y omitirá las acciones correspondientes.
