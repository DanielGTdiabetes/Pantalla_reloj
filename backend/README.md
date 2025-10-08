# Pantalla Futurista – Backend mínimo

Este backend FastAPI actúa como capa local para la Pantalla Futurista, gestionando
clima (OpenWeatherMap), Wi-Fi a través de NetworkManager y síntesis de voz local.
Se ejecuta en `127.0.0.1:8787` y está pensado para correr como servicio `systemd`
con usuario restringido.

## Requisitos

- Python 3.10+
- `nmcli` (NetworkManager)
- Motor TTS local (pico2wave recomendado o espeak-ng como alternativa)
- `aplay`, `paplay` o `mpv` para reproducir audio generado
- Acceso lectura/escritura a `/etc/pantalla-dash/config.json`

Instalar dependencias de Python:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

## Configuración

1. Copia la plantilla:
   ```bash
   sudo install -Dm600 backend/config/config.example.json /etc/pantalla-dash/config.json
   ```
2. Ajusta valores de latitud/longitud, ciudad y unidades.
3. Añade tu API key de OpenWeatherMap (no se expone vía API).
4. Opcional: define `wifi.preferredInterface` si no es `wlan0`.

El backend respeta la variable de entorno `PANTALLA_CONFIG_PATH` para apuntar a un
archivo distinto durante pruebas/desarrollo.

## Ejecución local

```bash
PANTALLA_CONFIG_PATH=$(pwd)/backend/config/config.example.json \
uvicorn backend.app:app --reload --host 127.0.0.1 --port 8787
```

Los endpoints se exponen en `/api/*`. Por ejemplo:

- `GET /api/weather/current` → clima actual (cacheado en `backend/storage/cache/`).
- `GET /api/wifi/scan` → redes Wi-Fi disponibles.
- `POST /api/tts/speak` → reproduce frase usando voz configurada.
- `GET /api/config` → configuración sin secretos.

## Logs y cache

- Cache de clima: `backend/storage/cache/weather_cache.json` (último dato válido).
- Logs: apunta a `backend/storage/logs/` (se deja el directorio creado para el servicio).
- Los comandos `nmcli` se ejecutan sin registrar contraseñas (se enmascaran en logs).

## Seguridad

- El servicio sólo escucha en `127.0.0.1`.
- `config.json` debe tener permisos `600` y propietario `root`.
- Evitar incluir credenciales en logs o stdout.

Consulta `../docs/DEPLOY_BACKEND.md` para una guía completa de despliegue en la Raspberry Pi.
