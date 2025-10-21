# Pantalla Futurista

Dashboard futurista para Raspberry Pi que muestra reloj, clima y controles de
configuración. La UI (React + Vite) se sirve como estático (Busybox/NGINX) y
usa un backend local mínimo (FastAPI) en `127.0.0.1:8081` para integrar
OpenWeatherMap, gestión de Wi-Fi y TTS offline.

## Estructura

```
.
├── dash-ui/                    # Frontend React
├── backend/                    # Backend FastAPI/Uvicorn
├── opt/dash/scripts/           # Utilidades (generate_bg_daily.py)
├── opt/dash/assets/backgrounds/auto/
├── system/pantalla-dash-backend@.service
├── system/pantalla-bg-generate.service
├── system/pantalla-bg-generate.timer
├── system/pantalla-xorg@.service
├── system/pantalla-ui.service
├── system/user/pantalla-openbox.service
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

La UI espera que el backend esté disponible en `http://127.0.0.1:8081/api`.
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
uvicorn backend.app:app --reload --host 127.0.0.1 --port 8081
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
   usuario de servicio (por ejemplo `dani`) y registrar
   `pantalla-dash-backend@dani.service`.
2. Sirve el contenido de `dash-ui/dist` en Busybox/NGINX apuntando la API a
   `127.0.0.1:8081`.
3. Verifica con `curl http://127.0.0.1:8081/api/weather/current` que el backend
   responde antes de lanzar la UI.

### Fondos futuristas generados con IA

- Copia `opt/dash/scripts/generate_bg_daily.py` a `/opt/dash/scripts/` y asegúrate
  de que sea ejecutable (`chmod +x`).
- El script requiere `pip install openai requests pillow` y lee `OPENAI_API_KEY`
  desde `/etc/pantalla-dash/env` (modo `660`, grupo `pantalla`).
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

- `system/pantalla-dash-backend@.service` inicia Uvicorn con 2 *workers* en
  `127.0.0.1:8081` dentro de `/home/<usuario>/proyectos/Pantalla_reloj`.
- `system/pantalla-xorg@.service` lanza `Xorg :0` en `vt1` y
  `system/user/pantalla-openbox.service` mantiene `openbox` vivo como sesión de
  usuario.
- `system/pantalla-ui.service` exporta `PANTALLA_UI_URL=http://127.0.0.1/` y se
  apoya en `/usr/local/bin/pantalla-ui-launch.sh` para localizar Chromium (snap).
- La plantilla Nginx `system/nginx/pantalla-dash.conf` sirve la SPA desde
  `/var/www/html` y sólo delega `/assets/backgrounds/auto/` a `/opt/dash/...`.

## Seguridad

- El backend sólo escucha en `127.0.0.1`.
- `/etc/pantalla-dash/` se instala con `drwxrws---` (root:pantalla) para que los
  servicios puedan escribir de forma segura, y los ficheros `config.json`,
  `backend.env`, `env` y `secrets.json` quedan en `660` (`dani:pantalla`).
- No se exponen secretos vía endpoints ni logs.

## Autoinicio UI

El modo kiosko queda desacoplado del escritorio GNOME y se apoya en tres
unidades systemd:

1. **`pantalla-dash-backend@dani.service`** (sistema) – levanta Uvicorn dentro
   del repositorio `/home/dani/proyectos/Pantalla_reloj` usando el entorno
   virtual `backend/.venv`.
2. **`pantalla-xorg@dani.service`** (sistema) – inicia `Xorg :0` directamente en
   `vt1` sin *display manager*.
3. **`pantalla-openbox.service`** y **`pantalla-ui.service`** (usuario `dani`) –
   `openbox` mantiene una sesión X ligera y el servicio de la UI lanza Chromium
   en modo `--app`/`--kiosk` contra `http://127.0.0.1/`.

Los units de usuario se instalan en `/etc/systemd/user/` y requieren
`loginctl enable-linger dani` (el instalador ya lo aplica). Operaciones básicas:

- **Habilitar todo el stack**:
  ```bash
  sudo systemctl enable --now pantalla-dash-backend@dani.service
  sudo systemctl enable --now pantalla-xorg@dani.service
  sudo -u dani systemctl --user enable --now pantalla-openbox.service pantalla-ui.service
  ```
- **Detener temporalmente Chromium**: `sudo -u dani systemctl --user stop pantalla-ui.service`
- **Reiniciar sólo la UI**: `sudo -u dani systemctl --user restart pantalla-ui.service`
- **Modificar la URL del kiosko**: crea un *drop-in* con
  `sudo -u dani systemctl --user edit pantalla-ui.service` y sobrescribe la
  variable `PANTALLA_UI_URL`.
- **Inspeccionar estados**:
  ```bash
  sudo systemctl status pantalla-xorg@dani.service --no-pager
  sudo -u dani systemctl --user status pantalla-openbox.service --no-pager
  sudo -u dani systemctl --user status pantalla-ui.service --no-pager
  ```

El lanzador `/usr/local/bin/pantalla-ui-launch.sh` valida que `DISPLAY` esté
disponible y prioriza `/snap/bin/chromium` antes de buscar otras variantes del
navegador.

## Kiosk headless (multi-user.target)

`scripts/install.sh` prepara un entorno sin gestor gráfico que arranca en
`multi-user.target` y, aun así, levanta una sesión X dedicada para el kiosko.
Resumen de pasos automatizados:

1. Instalación de `xserver-xorg`, `openbox`, `x11-xserver-utils` y `unclutter`
   (opcional) junto a Chromium (snap).
2. Escritura de `/etc/Xwrapper.config` con `allowed_users=anybody` y
   `needs_root_rights=yes` para permitir que `pantalla-xorg@dani.service`
   arranque sin consola activa.
3. Registro y activación de `pantalla-dash-backend@dani.service` (FastAPI en
   `127.0.0.1:8081`) seguido de `pantalla-xorg@dani.service`.
4. Habilitación de `pantalla-openbox.service` y `pantalla-ui.service` dentro de
   la sesión de `dani` (con *linger*). La UI lanza Chromium con flags
   `--app`, `--kiosk`, `--start-fullscreen`, `--window-size=1920,480` y
   `PANTALLA_UI_URL=http://127.0.0.1/`.
5. Hardening extra: desactiva autostarts previos (`snap.chromium.daemon` y
   `.desktop` heredados) para evitar que aparezcan ventanas no deseadas.

Validaciones post-instalación (todas ejecutadas por el script):

- `curl -fsS http://127.0.0.1/api/health` → `200` (backend).
- `curl -fsS http://127.0.0.1/assets/index-*.js` → `200` (SPA).
- `systemctl status pantalla-dash-backend@dani` → `active (running)`.
- `systemctl status pantalla-xorg@dani` → `active (running)`.
- `sudo -u dani systemctl --user status pantalla-openbox.service` → activo.
- `sudo -u dani systemctl --user status pantalla-ui.service` → activo.

Si `Xorg` falla con «Only console users are allowed…», comprueba que
`/etc/Xwrapper.config` contenga exactamente los valores anteriores y reinicia el
servicio (`sudo systemctl restart pantalla-xorg@dani`).

### Troubleshooting

- Comprueba el entorno en la sesión del usuario:
  `echo $XDG_RUNTIME_DIR` debe apuntar a `/run/user/1000` (o el UID
  correspondiente) y `echo $DBUS_SESSION_BUS_ADDRESS` a
  `unix:path=/run/user/1000/bus`.
- Verifica que `/snap/bin/chromium` existe y es ejecutable.
- Desde el usuario, revisa el servicio: `systemctl --user status pantalla-ui.service -l --no-pager`.

### Nginx & estáticos

- Los bundles generados por `dash-ui` se instalan en `/var/www/html/assets/`.
- No debe existir un alias global `alias /opt/dash/assets/;` sobre `/assets/`,
  ya que desviaría los ficheros `index-*.js`, `vendor-*.js` e `index-*.css` del
  build.
- La configuración por defecto utiliza `try_files $uri /index.html;` para que la
  SPA resuelva rutas internas y sólo crea un alias específico para
  `/assets/backgrounds/auto/`.
- Si se requieren fondos adicionales, puedes añadir un bloque dedicado en
  Nginx:

  ```nginx
  location /assets/backgrounds/auto/ {
    alias /opt/dash/assets/backgrounds/auto/;
    access_log off;
    expires 7d;
  }
  ```

- Tras instalar o actualizar, valida que todo responde con:

  ```bash
  curl -I http://127.0.0.1/
  curl -I http://127.0.0.1/assets/<bundle>.js
  curl -I http://127.0.0.1/api/health
  ```

## Licencia

MIT (o la licencia original del repositorio si se define).
