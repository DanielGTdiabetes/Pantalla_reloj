# Blitzortung MQTT

El backend incorpora un consumidor MQTT nativo que se conecta al proxy público de Blitzortung o a
un broker externo configurado manualmente. Ya no es necesario desplegar relays WebSocket ni
republicar datos en Mosquitto salvo que quieras gestionar tu propio broker.

## Configuración

La sección `blitzortung` de `config.json` y de la UI (`/#/config`) expone los campos mínimos para el
consumidor:

```json
"blitzortung": {
  "enabled": true,
  "mqtt_host": "mqtt.blitzortung.org",
  "mqtt_port": 1883,
  "topic_base": "blitzortung/",
  "radius_km": 100,
  "time_window_min": 30
}
```

* `enabled`: activa o desactiva el consumidor sin borrar la configuración.
* `mqtt_host` / `mqtt_port`: destino del broker MQTT (proxy público o servidor propio).
* `topic_base`: prefijo de los topics a los que se suscribe el cliente (`#` se añade automáticamente).
* `radius_km`: radio de agregación para las métricas locales.
* `time_window_min`: ventana temporal para el cómputo de eventos recientes.

La UI valida estos campos y permite probar la conexión al broker antes de guardar.

## Estado del consumidor

`GET /api/storms/status` fusiona la información meteorológica con el estado del consumidor MQTT. Los
campos añadidos por Blitzortung son:

```json
{
  "storm_prob": 0.1,
  "source": "mqtt",
  "connected": true,
  "nearest_distance_km": 12.3,
  "azimuth_deg": 220.0,
  "count_recent": 8,
  "time_window_min": 30,
  "last_ts": "2024-03-15T09:21:00+00:00"
}
```

* `source` pasa a `"disabled"` cuando el consumidor está desactivado.
* `connected` indica si la sesión MQTT está viva.
* `count_recent`, `time_window_min`, `nearest_distance_km` y `azimuth_deg` resumen la actividad
  reciente recibida del feed.
* `last_ts` refleja la última marca temporal recibida (en ISO-8601).

Si `connected=false`, revisa host/puerto/TLS o consulta los logs del backend (`journalctl`).

## Diagnóstico rápido

- `journalctl -u pantalla-dash-backend@<usuario> -n 100 --no-pager`
- `curl -s http://127.0.0.1:8081/api/storms/status | jq`
- `mosquitto_sub -h <tu-broker> -t 'blitzortung/#' -v` (cuando uses un broker propio)
