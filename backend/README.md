# Pantalla Futurista – Backend

Este backend en FastAPI sirve a la pantalla 8.8" proporcionando clima AEMET, radar
meteorológico, gestión Wi-Fi, fondos dinámicos y la mini-web de configuración.
Escucha en `127.0.0.1:8081` y está pensado para ejecutarse como servicio `systemd`.

## Requisitos

- Python 3.10+
- `NetworkManager` (`nmcli`) con permisos para gestionar Wi-Fi y modo hotspot
- `curl`, `systemd` y `systemd-timesyncd`
- Dependencias de Python listadas en `backend/requirements.txt`
- Acceso de lectura/escritura a `/etc/pantalla-dash/config.json`
- Acceso de lectura/escritura a `/etc/pantalla-dash/secrets.json` (credenciales y tokens)

Instala las dependencias de Python en un entorno virtual:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

## Configuración

1. Copia la plantilla de configuración:
   ```bash
   sudo install -Dm600 backend/config/config.example.json /etc/pantalla-dash/config.json
   ```
2. Edita los campos:
   - `aemet.apiKey`: API key de AEMET OpenData (no se expone por API).
   - `aemet.municipioId`: código de municipio para la predicción (p.ej. 28079 Madrid).
   - `weather.city` y `weather.units` para mostrar en la UI.
   - `storm.threshold` para el aviso de tormentas (0-1).
   - `wifi.preferredInterface` si no quieres que detecte automáticamente.
3. Opcional: ajusta secciones `tts`, `background`, `calendar` según necesidades.

La variable `PANTALLA_CONFIG_PATH` permite usar otro archivo durante pruebas.

## Ejecución local

```bash
PANTALLA_CONFIG_PATH=$(pwd)/backend/config/config.example.json \
uvicorn backend.app:app --reload --host 127.0.0.1 --port 8081
```

La mini-web de configuración está en `/setup`. Los endpoints REST principales:

- `GET /api/weather/today` y `GET /api/weather/weekly`
- `GET /api/storms/status` y `GET /api/storms/radar`
- `GET /api/backgrounds/current`
- `GET /api/network/status`, `GET /api/wifi/scan`, `POST /api/wifi/connect`
- `POST /api/location/override` (geolocalización desde el navegador)
- `GET /api/time/sync_status` para comprobar `systemd-timesyncd`
- `GET /api/day/brief` para efemérides, santoral y festivos
- `POST /api/calendar/google/device/start`, `GET /api/calendar/google/device/status`,
  `POST /api/calendar/google/device/cancel` y `GET /api/calendar/google/calendars`
  para el flujo OAuth de Google Calendar

### Tormentas y Radar (AEMET)

- Endpoints:
  - `GET /api/storms/status` → `{ storm_prob, near_activity, radar_url, updated_at }`
  - `GET /api/storms/radar` → proxy de imagen radar (204 si no hay dato)
- Configuración:
  - `storm.threshold` (0..1) define el umbral para considerar actividad cercana.
  - `storm.enableExperimentalLightning` permite activar futuras integraciones de rayos.
- Caché:
  - `backend/storage/cache/storms_prob.json` (TTL 15 min)
  - `backend/storage/cache/storms_radar.json` (TTL 10 min)
- Notas:
  - Actualmente no existen datos JSON públicos fiables de rayos; se usa una heurística basada en precipitación y descriptores de tormenta.
  - Preparado para integrar rayos cuando haya fuente estable (respetando la configuración experimental).

### Efemérides, Santoral y Festivos

- Endpoint: `GET /api/day/brief?date=YYYY-MM-DD` (fecha opcional, por defecto hoy).
- Fuentes empleadas:
  - Wikipedia (API REST "On This Day") para efemérides históricas.
  - Wikipedia (sección de santoral) con fallback local `backend/data/santoral_es.json`.
  - [Nager.Date](https://date.nager.at) para festivos nacionales y autonómicos de España.
  - `config.json` para patrón local configurable.
- Caché: `backend/storage/cache/dayinfo_YYYY-MM-DD.json` (TTL 24h) para limitar peticiones remotas.
- Limitaciones:
  - Los festivos regionales dependen de los códigos `counties` que expone la API de Nager.Date.
  - El patrón local sólo se resuelve si coincide con la fecha configurada (`config.patron`).

### Calendario y Google OAuth

- Configuración principal en `config.calendar` (`provider`, `mode`, `google.calendarId`).
- Credenciales (`client_id`, `client_secret`) y `refresh_token` se almacenan en `/etc/pantalla-dash/secrets.json` con permisos `0600`.
- El flujo OAuth de dispositivo expone los endpoints:
  - `POST /api/calendar/google/device/start`
  - `GET /api/calendar/google/device/status`
  - `POST /api/calendar/google/device/cancel`
  - `GET /api/calendar/google/calendars`
- Los eventos próximos (`GET /api/calendar/upcoming`) emplean `GoogleCalendarService` y cachean la respuesta en `backend/storage/cache/calendar_google_upcoming.json` (TTL 5 min).
- Documentación detallada en `../docs/google-calendar.md`.

## Cachés y almacenamiento

- Datos AEMET cacheados en `backend/storage/cache/aemet_*.json` (TTL 30 min).
- Radar y probabilidad de tormenta en `backend/storage/cache/storms_*.json`.
- Override de ubicación en `backend/storage/cache/location_override.json`.
- Fondos automáticos servidos desde `/opt/dash/assets/backgrounds/auto/`.
- `backend/storage/cache/calendar_google_upcoming.json` (eventos de Google Calendar, TTL 5 min).
- El hotspot genera la contraseña en `/var/lib/pantalla/ap_pass`.

## Seguridad

- El backend sólo escucha en `127.0.0.1`.
- `config.json` debe mantenerse con permisos `600`.
- Las contraseñas Wi-Fi no se escriben en logs.

Consulta `../docs/DEPLOY_BACKEND.md` para pasos de despliegue completos y alta de
los servicios `systemd`.
