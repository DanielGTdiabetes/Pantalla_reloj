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

- `PANTALLA_STATE_DIR`: Base directory for configuration/cache. Defaults to `/var/lib/pantalla`.
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
