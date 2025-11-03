# Pantalla_reloj Backend

FastAPI backend that powers the Pantalla_reloj kiosk display. It provides read/write
configuration endpoints as well as cached data services consumed by the React
frontend.

## Local development

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8081
```

Environment variables allow overriding deployment paths when testing locally:

- `PANTALLA_STATE_DIR`: Base directory for configuration/cache. Defaults to `/var/lib/pantalla-reloj`.
- `PANTALLA_CONFIG_FILE`: Specific path to the configuration file.
- `PANTALLA_CACHE_DIR`: Location for cached JSON payloads.
- `PANTALLA_BACKEND_LOG`: Location for the backend log file.

## Endpoints

- `GET /api/health`
- `GET|PATCH /api/config`
- `GET /api/weather`
- `GET /api/news`
- `GET /api/astronomy`
- `GET /api/calendar`
- `GET|POST /api/storm_mode`

### AISStream runtime check

1) Configurar API key de AISStream (RAW, text/plain):

```
curl -sS -X POST --data 'tu_api_key' http://127.0.0.1:8081/api/config/secret/aisstream_api_key/raw
```

2) Verificar estado en health (ships.runtime):

```
curl -sS http://127.0.0.1:8081/api/health | jq '.ships.runtime'
```

Campos a observar:
- `ws_connected: true`
- `buffer_size > 0` tras ~30–90s
- `last_message_ts` no nulo

3) Datos de barcos:

```
curl -sS http://127.0.0.1:8081/api/layers/ships | jq '.meta, .features | length'
```

`meta.ok` debe ser `true` cuando haya datos y el número de `features` mayor que 0 tras unos segundos con bbox global.