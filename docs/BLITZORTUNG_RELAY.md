# Blitzortung MQTT

El backend incorpora un consumidor MQTT nativo que se conecta al proxy público de Blitzortung o a
un broker personalizado, según la configuración que definas desde la UI (`/#/config`). Ya no es
necesario desplegar relays WebSocket externos ni republicar datos en Mosquitto salvo que lo
habilites expresamente.

## Configuración

La sección `blitzortung` de `config.json`/`secrets.json` se mapea con el formulario de la UI:

```json
"blitzortung": {
  "enabled": true,
  "mqtt": {
    "mode": "public_proxy",
    "proxy_host": "mqtt.ejemplo.org",
    "proxy_port": 8883,
    "proxy_ssl": true,
    "proxy_baseTopic": "blitzortung",
    "geohash": null,
    "radius_km": 100,
    "host": null,
    "port": 1883,
    "ssl": false,
    "username": null,
    "password": null
  }
}
```

Campos principales:

| Clave | Descripción |
| --- | --- |
| `enabled` | Activa o desactiva el consumidor sin borrar la configuración. |
| `mqtt.mode` | `public_proxy` usa el proxy TLS recomendado. `custom_broker` apunta a un Mosquitto propio. |
| `mqtt.proxy_*` | Parámetros del proxy público (host, puerto, TLS y prefijo base). |
| `mqtt.geohash` / `mqtt.radius_km` | Delimitan la zona de interés según ofrezca el proveedor. |
| `mqtt.host` / `mqtt.port` | Broker personalizado cuando se selecciona `custom_broker`. |
| `mqtt.username` / `mqtt.password` | Credenciales opcionales. La contraseña se almacena en `secrets.json` y se oculta en la UI. |

> ⚙️ Para usar un Mosquitto local, instala el proyecto con `--enable-local-mqtt` y escoge el modo
> **Broker personalizado** desde la interfaz.

## Estado del consumidor

`GET /api/storms/status` combina el estado meteorológico y el diagnóstico del consumidor MQTT. Los
campos relevantes son:

```json
{
  "storm_prob": 0.1,
  "enabled": true,
  "connected": true,
  "mode": "public_proxy",
  "topic": "blitzortung/auto/100",
  "last_event_at": "2024-03-15T09:21:00+00:00",
  "counters": {
    "received": 42,
    "last_distance_km": 12.3
  }
}
```

Si `enabled=true` pero `connected=false`, revisa host/puerto/TLS o consulta los logs del backend.

## Diagnóstico rápido

- `journalctl -u pantalla-dash-backend@<usuario> -n 100 --no-pager`
- `curl -s http://127.0.0.1:8081/api/storms/status | jq` (si `jq` está disponible)
- `mosquitto_sub -h <tu-broker> -t 'blitzortung/#' -v` (cuando uses un broker propio)
