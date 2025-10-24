# Blitzortung Relay WS→MQTT

Este directorio contiene el relay WebSocket → MQTT que obtiene rayos de fuentes públicas
(Blitzortung/LightningMaps) y los publica en el broker Mosquitto local.

## Ubicación de archivos

- Script principal: `/opt/blitzortung/ws_relay/relay.py`
- Entorno virtual: `/opt/blitzortung/.venv`
- Servicio systemd de usuario: `~/.config/systemd/user/blitz_relay.service`
- Logs del servicio: `/var/log/pantalla/blitz_relay.log` y `/var/log/pantalla/blitz_relay.err`

## Ejecución manual

```bash
source /opt/blitzortung/.venv/bin/activate
python /opt/blitzortung/ws_relay/relay.py
```

## Verificación manual del broker

```bash
mosquitto_sub -h 127.0.0.1 -t 'blitzortung/#' -v | head -n 20
```
