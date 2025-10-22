# Blitzortung WebSocket Client

Este directorio contiene el cliente WebSocket que reenvía eventos de rayos de Blitzortung hacia el broker MQTT local.

## Ubicación de archivos

- Código del cliente: `/opt/blitzortung/ws_client/ws_client.py`
- Dependencias: `/opt/blitzortung/ws_client/requirements.txt`
- Entorno virtual: `/opt/blitzortung/.venv`
- Servicio systemd de usuario: `~/.config/systemd/user/blitz_ws_client.service`
- Log de ejecución: `~/.local/share/blitzortung/ws_client.log`

## Ejecución manual

Activar el entorno virtual y lanzar el cliente manualmente:

```bash
source /opt/blitzortung/.venv/bin/activate
python /opt/blitzortung/ws_client/ws_client.py \
  --mqtt-host 127.0.0.1 --mqtt-port 1883 \
  --topic-prefix blitzortung/1.1 \
  --geohash-precision 4 \
  --log ~/.local/share/blitzortung/ws_client.log
```

## Verificación manual del broker

> **Nota:** utilice el siguiente comando (comentado) para suscribirse a los eventos publicados en MQTT:
>
> ```bash
> # mosquitto_sub -h 127.0.0.1 -t 'blitzortung/1.1/#' -v | head -n 20
> ```

