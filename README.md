# Pantalla Futurista

Dashboard futurista para mini PC con Linux que muestra reloj, clima y controles
de configuración. La UI (React + Vite) se sirve como estático (Busybox/NGINX) y
usa un backend local mínimo (FastAPI) en `127.0.0.1:8081` para integrar
OpenWeatherMap, gestión de Wi-Fi y TTS offline.

## Estructura

```
.
├── dash-ui/                    # Frontend React
├── backend/                    # Backend FastAPI/Uvicorn
├── opt/dash/scripts/           # Utilidades
├── system/pantalla-dash-backend@.service
├── system/pantalla-xorg@.service
├── system/pantalla-ui.service
├── services/pantalla-openbox.service
└── docs/
    ├── DEPLOY_BACKEND.md      # Guía de despliegue completa
    └── google-calendar.md     # Configuración de OAuth para Google Calendar
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

- `GeoScopeCanvas` renderiza un degradado animado de referencia para la vista
  geoespacial mientras se preparan los datos reales.
- `OverlayPanel` aplica un cristal translúcido configurable (opacidad, desenfoque,
  radio) sobre el lienzo principal y posiciona la cabecera de reloj.
- `Rotator` recorre las secciones informativas con transiciones *crossfade*
  basadas en los parámetros `ui.overlay.{order,dwell_seconds,transition_ms}`.
- Los iconos meteorológicos usan `lottie-web`; activa o desactiva la animación con
  `VITE_ENABLE_LOTTIE=1|0`.
- `VITE_ENABLE_FPSMETER=1` muestra un contador de FPS para depurar rendimiento
  (oculto en producción).

### Panel de ajustes

Desde la UI puedes:

- Configurar API key, ciudad y coordenadas de OpenWeatherMap.
- Gestionar Wi-Fi (escanear, conectar, olvidar y ver estado).
- Seleccionar voz local y volumen TTS, lanzar prueba de voz.
- Activar el calendario y elegir si se carga desde una URL ICS o desde un archivo local `.ics`.

### Calendario (Google, URL o archivo .ics)

- El panel de ajustes ofrece tres proveedores: **Google**, **URL remota (.ics)** o **Archivo local (.ics)**. El backend mantiene la configuración en `config.calendar.provider`.
- Para Google Calendar utiliza el flujo OAuth *device code* (ver [docs/google-calendar.md](docs/google-calendar.md)). Necesitas un `client_id`/`client_secret` válidos en `/etc/pantalla-dash/secrets.json` para que el botón **Conectar con Google** esté disponible.
- Durante la autorización la UI muestra el `user_code` y el enlace de verificación (`https://www.google.com/device`). El backend guarda el `refresh_token` en `secrets.json` con permisos `0600` y renueva tokens automáticamente. Puedes listar calendarios con `GET /api/calendar/google/calendars` y seleccionar cuál sincronizar (`config.calendar.google.calendarId`).
- El backend cachea eventos en `backend/storage/cache/calendar_google_upcoming.json` durante 5 minutos para reducir llamadas.
- Con proveedor **URL** pega la dirección remota en la pestaña **URL ICS**; el backend la valida y la UI la usará en el próximo refresco.
- Con proveedor **Archivo** sube un `.ics` (≤5 MB) desde la pestaña **Archivo .ics**. La petición `POST /api/calendar/upload` verifica el contenido (`BEGIN:VCALENDAR`…`END:VCALENDAR`) y persiste el archivo en `/etc/pantalla-dash/calendar/calendar.ics` (`0644`).
- El archivo actual puede descargarse (`GET /api/calendar/download`) o eliminarse (`DELETE /api/calendar/file`), lo que revierte a proveedor URL si existe.
- `GET /api/calendar/status` expone `{ mode, provider, url, icsPath, exists, size, mtime, google }` para sincronizar la UI. Los eventos del gestor se registran en `/var/log/pantalla-dash/calendar.log`.

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

- `GET /api/health/full` expone métricas de CPU, memoria, disco y latencias de servicios externos como AEMET.
- `GET /api/storms/radar/animation` entrega la lista de frames recientes del radar
  para precargar y animar en la UI.

Consulta `backend/README.md` y `docs/DEPLOY_BACKEND.md` para detalles de
permisos, systemd y endurecimiento.

## Despliegue en mini PC

1. Sigue la guía `docs/DEPLOY_BACKEND.md` para instalar dependencias, crear el
   usuario de servicio (por ejemplo `dani`) y registrar
   `pantalla-dash-backend@dani.service`.
2. Sirve el contenido de `dash-ui/dist` en Busybox/NGINX apuntando la API a
   `127.0.0.1:8081`.
3. Verifica con `curl http://127.0.0.1:8081/api/weather/current` que el backend
   responde antes de lanzar la UI.

### Ajustes de sistema y red

- `system/pantalla-dash-backend@.service` inicia Uvicorn con 2 *workers* en
  `127.0.0.1:8081` dentro de `/home/<usuario>/proyectos/Pantalla_reloj`.
- `system/pantalla-xorg@.service` lanza `Xorg :0` en `vt1` y
  `services/pantalla-openbox.service` mantiene `openbox` vivo como sesión de
  usuario.
- `system/pantalla-ui.service` exporta `PANTALLA_UI_URL=http://127.0.0.1/` y se
  apoya en `/usr/local/bin/pantalla-ui-launch.sh` para localizar Chromium (snap).
- La plantilla Nginx `system/nginx/pantalla-dash.conf` sirve la SPA desde
  `/var/www/html` sin dependencias externas adicionales.

## Seguridad

- El backend sólo escucha en `127.0.0.1`.
- `/etc/pantalla-dash/` se instala con `drwxrws---` (root:pantalla) para que los
  servicios puedan escribir de forma segura, y los ficheros `config.json`,
  `backend.env`, `env` y `secrets.json` quedan en `640` (salvo `secrets.json`, que
  se protege con `600`).
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

Los units de usuario se instalan en `/etc/xdg/systemd/user/` y requieren
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
- No definas alias globales que intercepten `/assets/`, así evitarás que los
  bundles empacados (por ejemplo `index-*.js`, `vendor-*.js` o `index-*.css`)
  se resuelvan fuera del `document_root`.
- La configuración por defecto utiliza `try_files $uri /index.html;` para que la
  SPA resuelva rutas internas sin rutas adicionales.

- Tras instalar o actualizar, valida que todo responde con:

  ```bash
  curl -I http://127.0.0.1/
  curl -I http://127.0.0.1/assets/<bundle>.js
  curl -I http://127.0.0.1/api/health
  ```

## Licencia

MIT (o la licencia original del repositorio si se define).

## Blitzortung (MQTT)

El backend consume los rayos de Blitzortung directamente mediante MQTT. Por defecto se conecta
al proxy público configurado en el panel `/#!/config`, sin desplegar relays WebSocket ni un broker
local adicional.

### Configuración rápida

1. Accede a `/#/config` y abre la tarjeta «Blitzortung y apariencia».
2. Activa la integración y selecciona el modo **Proxy público (recomendado)**.
3. Ajusta `geohash` y el radio (km) para delimitar tu zona. Los cambios se aplican en caliente.

Puedes comprobar el estado actual vía `GET /api/storms/status` o desde la propia interfaz. Si ves
`enabled=true` pero `connected=false`, revisa la conectividad con el proxy o las credenciales.

### Broker local opcional

Si prefieres publicar en un Mosquitto local, instala con la bandera `--enable-local-mqtt`:

```bash
sudo ./scripts/install.sh --enable-local-mqtt …
```

y cambia el modo a **Broker personalizado (avanzado)** en `/#/config`, indicando host, puerto y
credenciales.
