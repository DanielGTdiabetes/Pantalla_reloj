# Pantalla Futurista

Dashboard futurista para Raspberry Pi que muestra reloj, clima y controles de
configuración. La UI (React + Vite) se sirve como estático (Busybox/NGINX) y
usa un backend local mínimo (FastAPI) en `127.0.0.1:8787` para integrar
OpenWeatherMap, gestión de Wi-Fi y TTS offline.

## Estructura

```
.
├── dash-ui/                    # Frontend React
├── backend/                    # Backend FastAPI/Uvicorn
├── system/pantalla-dash-backend.service
└── docs/DEPLOY_BACKEND.md      # Guía de despliegue completa
```

## Frontend (dash-ui)

```bash
cd dash-ui
npm install
npm run dev       # desarrollo
npm run build     # genera estáticos para Busybox
```

La UI espera que el backend esté disponible en `http://127.0.0.1:8787/api`.
Se almacena en `localStorage` el último clima y la configuración básica para
operar offline si el backend no responde.

### Panel de ajustes

Desde la UI puedes:

- Configurar API key, ciudad y coordenadas de OpenWeatherMap.
- Gestionar Wi-Fi (escanear, conectar, olvidar y ver estado).
- Seleccionar voz local y volumen TTS, lanzar prueba de voz.
- Ajustar intervalo de rotación de fondos y el tema (sincronizado con backend).

## Backend (FastAPI)

El backend proxy OpenWeatherMap con cache en disco, expone acciones de Wi-Fi
via `nmcli` y reproduce TTS con `pico2wave` o `espeak-ng`.

Instalación rápida de dependencias:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

Ejecución local apuntando a la configuración de ejemplo:

```bash
PANTALLA_CONFIG_PATH=$(pwd)/backend/config/config.example.json \
uvicorn backend.app:app --reload --host 127.0.0.1 --port 8787
```

Endpoints principales (`/api/*`): clima, Wi-Fi, TTS y gestión de configuración.
La cache de clima se guarda en `backend/storage/cache/weather_cache.json`.

Consulta `backend/README.md` y `docs/DEPLOY_BACKEND.md` para detalles de
permisos, systemd y endurecimiento.

## Despliegue en Raspberry Pi

1. Sigue la guía `docs/DEPLOY_BACKEND.md` para instalar dependencias, crear el
   usuario `dashsvc` y registrar el servicio `pantalla-dash-backend.service`.
2. Sirve el contenido de `dash-ui/dist` en Busybox/NGINX apuntando la API a
   `127.0.0.1:8787` (ya configurado en los servicios del frontend).
3. Verifica con `curl http://127.0.0.1:8787/api/weather/current` que el backend
   responde antes de lanzar la UI.

## Seguridad

- El backend sólo escucha en `127.0.0.1`.
- `/etc/pantalla-dash/config.json` debe tener permisos `600` (root:root).
- No se exponen secretos vía endpoints ni logs.

## Licencia

MIT (o la licencia original del repositorio si se define).
