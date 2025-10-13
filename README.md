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
├── opt/dash/scripts/           # Utilidades (generate_bg_daily.py)
├── opt/dash/assets/backgrounds/auto/
├── system/pantalla-dash-backend.service
├── system/pantalla-bg-generate.service
├── system/pantalla-bg-generate.timer
├── system/logrotate.d/pantalla-bg
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

### Motor visual y flags de rendimiento

- El hook `useBackgroundCycle` mantiene tres ranuras (anterior, actual, siguiente)
  con precarga inteligente y transición *crossfade* en ≤16 ms por frame.
- `SceneEffects` habilita un *overlay* WebGL opcional con grano sutil y aplica
  desenfoque de profundidad simulado sobre los widgets cuando `VITE_ENABLE_WEBGL=1`.
- Los iconos meteorológicos usan `lottie-web`; activa o desactiva la animación con
  `VITE_ENABLE_LOTTIE=1|0`.
- `VITE_ENABLE_FPSMETER=1` muestra un contador de FPS para depurar rendimiento
  (oculto en producción).

### Panel de ajustes

Desde la UI puedes:

- Configurar API key, ciudad y coordenadas de OpenWeatherMap.
- Gestionar Wi-Fi (escanear, conectar, olvidar y ver estado).
- Seleccionar voz local y volumen TTS, lanzar prueba de voz.
- Ajustar intervalo, modo y retención de fondos AI junto al tema (sincronizado con backend).

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

Endpoints adicionales destacados:

- `GET /api/backgrounds/current` devuelve la imagen más reciente junto a cabeceras
  `ETag`/`Last-Modified` y dispara generación on-demand si se permite.
- `GET /api/health/full` expone métricas de CPU, memoria, disco y latencias de AEMET/OpenAI.
- `GET /api/storms/radar/animation` entrega la lista de frames recientes del radar
  para precargar y animar en la UI.

Consulta `backend/README.md` y `docs/DEPLOY_BACKEND.md` para detalles de
permisos, systemd y endurecimiento.

## Despliegue en Raspberry Pi

1. Sigue la guía `docs/DEPLOY_BACKEND.md` para instalar dependencias, crear el
   usuario `dashsvc` y registrar el servicio `pantalla-dash-backend.service`.
2. Sirve el contenido de `dash-ui/dist` en Busybox/NGINX apuntando la API a
   `127.0.0.1:8787` (ya configurado en los servicios del frontend).
3. Verifica con `curl http://127.0.0.1:8787/api/weather/current` que el backend
   responde antes de lanzar la UI.

### Fondos futuristas generados con IA

- Copia `opt/dash/scripts/generate_bg_daily.py` a `/opt/dash/scripts/` y asegúrate
  de que sea ejecutable (`chmod +x`).
- El script requiere `pip install openai requests pillow` y lee `OPENAI_API_KEY`
  desde `/etc/pantalla-dash/env` (modo `600`).
- Configura `/etc/pantalla-dash/config.json` con los campos:

  ```json
  {
    "background": {
      "mode": "daily",          // o "weather"
      "retainDays": 30,
      "intervalMinutes": 5
    }
  }
  ```

- Registra los servicios systemd incluidos en `system/`:

  ```bash
  sudo cp system/pantalla-bg-generate.service /etc/systemd/system/
  sudo cp system/pantalla-bg-generate.timer /etc/systemd/system/
  sudo cp system/logrotate.d/pantalla-bg /etc/logrotate.d/
  sudo systemctl daemon-reload
  sudo systemctl enable --now pantalla-bg-generate.timer
  ```

- El temporizador ejecuta el script cada día a las 07:00, 12:00 y 19:00 (hora local) y guarda
  las imágenes (`.webp`, 1280x720) en `/opt/dash/assets/backgrounds/auto/`,
  manteniendo las últimas 30 o el número de días configurado. El backend expone
  la última imagen en `/api/backgrounds/current` y la UI actualiza el fondo con
  transición suave.

### Ajustes de sistema y red

- `system/pantalla-dash-backend.service` inicia Uvicorn con 2 *workers* para
  servir las nuevas rutas de salud y radar sin bloquear solicitudes.
- La plantilla Nginx `system/nginx/pantalla-dash.conf` habilita `http2`,
  `sendfile` y compresión `gzip`, además de exponer `/opt/dash/assets/` como
  `/assets/`.
- `system/pantalla-kiosk.service` lanza Chromium en modo kiosko con aceleración
  VA-API, rasterización fuera de proceso y *zero-copy* para maximizar FPS.

## Seguridad

- El backend sólo escucha en `127.0.0.1`.
- `/etc/pantalla-dash/config.json` debe tener permisos `600` (root:root).
- No se exponen secretos vía endpoints ni logs.

## Licencia

MIT (o la licencia original del repositorio si se define).
