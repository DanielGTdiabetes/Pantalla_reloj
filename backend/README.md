# Pantalla Futurista – Backend

Este backend en FastAPI sirve a la pantalla 8.8" proporcionando clima AEMET, radar
meteorológico, gestión Wi-Fi, fondos dinámicos y la mini-web de configuración.
Escucha en `127.0.0.1:8787` y está pensado para ejecutarse como servicio `systemd`.

## Requisitos

- Python 3.10+
- `NetworkManager` (`nmcli`) con permisos para gestionar Wi-Fi y modo hotspot
- `curl`, `systemd` y `systemd-timesyncd`
- Dependencias de Python listadas en `backend/requirements.txt`
- Acceso de lectura/escritura a `/etc/pantalla-dash/config.json`

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
uvicorn backend.app:app --reload --host 127.0.0.1 --port 8787
```

La mini-web de configuración está en `/setup`. Los endpoints REST principales:

- `GET /api/weather/today` y `GET /api/weather/weekly`
- `GET /api/storms/status` y `GET /api/storms/radar`
- `GET /api/backgrounds/current`
- `GET /api/network/status`, `GET /api/wifi/scan`, `POST /api/wifi/connect`
- `POST /api/location/override` (geolocalización desde el navegador)
- `GET /api/time/sync_status` para comprobar `systemd-timesyncd`

## Cachés y almacenamiento

- Datos AEMET cacheados en `backend/storage/cache/aemet_*.json` (TTL 30 min).
- Override de ubicación en `backend/storage/cache/location_override.json`.
- Fondos automáticos servidos desde `/opt/dash/assets/backgrounds/auto/`.
- El hotspot genera la contraseña en `/var/lib/pantalla/ap_pass`.

## Seguridad

- El backend sólo escucha en `127.0.0.1`.
- `config.json` debe mantenerse con permisos `600`.
- Las contraseñas Wi-Fi no se escriben en logs.

Consulta `../docs/DEPLOY_BACKEND.md` para pasos de despliegue completos y alta de
los servicios `systemd`.
