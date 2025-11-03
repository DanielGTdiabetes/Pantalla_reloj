# Pantalla_reloj (versión estable 2025-10)

Sistema reproducible para mini-PC Ubuntu 24.04 LTS con pantalla HDMI 8.8" orientada
verticalmente. La solución combina **FastAPI** (backend), **React + Vite**
(frontend) y un stack gráfico mínimo **Xorg + Openbox + Chromium en modo kiosk**
(Epiphany queda como opción secundaria).

## Arquitectura

```
Pantalla_reloj/
├─ backend/                  # FastAPI con endpoints de salud, datos y configuración
├─ dash-ui/                  # React/Vite UI en modo kiosk
├─ scripts/                  # install.sh, uninstall.sh, fix_permissions.sh
├─ systemd/                  # Servicios pantalla-*.service
├─ etc/nginx/sites-available # Virtual host de Nginx
└─ openbox/autostart         # Lanzamiento de Epiphany en modo kiosk (Firefox opcional)
```

### Backend (FastAPI)
- Endpoints: `/api/health`, `/api/config` (GET/PATCH), `/api/weather`, `/api/news`,
  `/api/astronomy`, `/api/calendar`, `/api/storm_mode` (GET/POST), `/api/astronomy/events`.
- Persistencia de configuración en `/var/lib/pantalla-reloj/config.json` (se crea con
  valores por defecto si no existe) y caché JSON en `/var/lib/pantalla/cache/`.
- **Ruta oficial de config**: `/var/lib/pantalla-reloj/config.json`. Están obsoletas:
  `/etc/pantalla-dash/config.json`, `/var/lib/pantalla/config.json` (el backend las detecta
  al arranque y emite WARNING si existen, pero las ignora).
- El lanzador `usr/local/bin/pantalla-backend-launch` garantiza que existan
  `/var/log/pantalla` y `/var/lib/pantalla`, verifica que `import backend.main`
  funcione (fallando con código 3 si no) y envía stdout/stderr a
  `/tmp/backend-launch.log` antes de delegar en `uvicorn main:app --host
  127.0.0.1 --port 8081` dentro de un entorno virtual local
  (`/opt/pantalla/backend/.venv`).

#### Funcionalidades Implementadas (2025-01)
- ✅ **Proveedores personalizados**: `CustomFlightProvider` y `CustomShipProvider` con configuración de URL y API key
- ✅ **Precisión astronómica**: Cálculos precisos de efemérides usando `astral` (±1 minuto), información extendida (dusk, dawn, solar noon)
- ✅ **Procesamiento de radar**: Procesamiento de tiles RainViewer con `Pillow` y `numpy` para generar máscaras de foco
- ✅ **Unión geométrica**: Combinación real de polígonos CAP y radar usando `shapely` para máscaras de foco en modo `"both"`
- ✅ **Datos enriquecidos**: Santoral con información adicional (type, patron_of, name_days), hortalizas con siembra y cosecha, eventos astronómicos
- ✅ **Mejoras de fuentes**: `calculate_extended_astronomy()`, `get_astronomical_events()`, datos mejorados de harvest y saints

### Frontend (React/Vite)
- Dashboard por defecto en modo `full`: mapa principal con tarjetas de noticias y
  eventos, más panel lateral derecho con métricas de clima, rotación y estado de
  tormenta.
- El panel lateral puede moverse a la izquierda y el carrusel de módulos (modo demo)
  puede activarse desde `/config`; por defecto ambos permanecen deshabilitados.
- `/config` expone la administración completa (rotación, API keys, MQTT, Wi-Fi y
  opciones de UI). El overlay solo aparece en `/` si se añade `?overlay=1` para
  depuración puntual.
- La tarjeta **Mapa → Modo Cine** ofrece ahora controles dedicados: selector de
  velocidad (lenta/media/rápida), amplitud del barrido con `range`, easing
  lineal/suave, pausa automática cuando hay overlays y un botón para restaurar
  los valores por defecto.
- El bloque **AEMET** permite gestionar la API key de forma segura. El campo se
  muestra enmascarado (•••• 1234), el botón «Mostrar» habilita la edición en
  claro y el botón «Probar clave» ejecuta `/api/aemet/test_key` para validar la
  credencial sin exponerla al resto del formulario.
- Compilado con `npm run build` y servido por Nginx desde `/var/www/html`.

#### Autopan y diagnósticos

- El mapa GeoScope rota automáticamente en modo kiosk incluso si el panel lateral
  no es visible; se escribe una traza periódica en `console.log`
  (`[diagnostics:auto-pan] bearing=<valor>`) para que `journalctl` pueda validar el
  movimiento.
- Flags de runtime disponibles vía `window.location.search` o `localStorage`:
  - `autopan=1|0` fuerza la animación ON/OFF.
  - `force=1|0` ignora heurísticas y activa/desactiva el autopan incluso en escritorio.
  - `reducedMotion=1|0` (alias heredado `reduced`) indica si se respeta `prefers-reduced-motion`.
  - `speed=<grados/segundo>` fija la velocidad sin recompilar (por defecto ~0.1 °/s).
- `/diagnostics/auto-pan` monta solo el mapa a pantalla completa con
  `force=1&reducedMotion=0` y muestra un banner superior con el bearing actual, ideal
  para comprobar rápidamente el kiosk.

### Configurar MapTiler

- Crea una cuenta en [MapTiler](https://maptiler.com/) y genera una API key desde el
  panel **Cloud → API keys**. Copia el identificador alfanumérico (solo letras,
  números, punto, guion y guion bajo).
- En la UI de configuración (`/#/config`), abre la tarjeta **Mapas**, selecciona
  **MapTiler** como proveedor y pega la API key. Usa el botón «Mostrar» para
  comprobarla antes de guardar.
- La clave queda almacenada en `config.json` y se envía al navegador para cargar los
  estilos vectoriales, por lo que se considera información visible desde el cliente.
  Si el plan de MapTiler lo permite, restringe la API key a los dominios o direcciones
  IP del kiosk desde el panel de MapTiler.

### Configurar AEMET

- En la tarjeta **AEMET** de `/config` podrás activar/desactivar la integración y
  definir qué capas (CAP, radar, satélite) se descargan.
- La clave se almacena sólo en backend: el campo muestra `•••• 1234` si existe
  un secreto guardado. Pulsa «Mostrar» para editar y «Guardar clave» para enviar
  la actualización a `/api/config/secret/aemet_api_key`.
- Usa «Probar clave» para llamar a `/api/aemet/test_key`; el backend contacta con
  AEMET y responde `{ok:true}` o `{ok:false, reason:"unauthorized|network|…"}`.
- `GET /api/config` nunca devuelve la clave completa; expone `has_api_key` y
  `api_key_last4` para saber si se ha cargado correctamente.

### Calendario ICS

El sistema soporta calendarios ICS (iCalendar) que pueden configurarse mediante subida de archivos o rutas locales.

#### Subida de archivo ICS

1. **Subir archivo ICS**: Usa el endpoint `POST /api/config/upload/ics` para subir un archivo `.ics`:
   ```bash
   curl -X POST \
     -F "file=@/ruta/a/tu/calendario.ics" \
     -F "filename=calendario.ics" \
     http://127.0.0.1:8081/api/config/upload/ics
   ```
   El archivo se almacena de forma segura y se valida automáticamente.

2. **Configuración desde UI**: Desde la interfaz de configuración (`/#/config`), selecciona el proveedor `ics` y proporciona:
   - **Ruta local**: Ruta absoluta al archivo ICS en el sistema de archivos
   - **URL remota**: URL HTTP/HTTPS para descargar el archivo ICS

3. **Validación**: El backend valida que:
   - El archivo existe y es legible (rutas locales)
   - La URL es accesible (rutas remotas)
   - El formato ICS es válido
   - El tamaño no excede 2 MB

#### Endpoints relacionados

- `GET /api/calendar/events`: Obtiene eventos del calendario ICS
- `GET /api/calendar/status`: Verifica el estado del calendario ICS (devuelve `status: "ok"` si está funcionando correctamente)
- `POST /api/config/upload/ics`: Sube un archivo ICS al servidor
- `GET /api/health`: Incluye información del calendario en el campo `calendar.status`

#### Formato ICS soportado

El sistema soporta el formato estándar iCalendar (RFC 5545) con eventos `VEVENT` básicos:
- `UID`: Identificador único del evento
- `DTSTART` / `DTEND`: Fechas de inicio y fin
- `SUMMARY`: Título del evento
- `DESCRIPTION`: Descripción opcional
- `LOCATION`: Ubicación opcional

### Timezone y rangos de fecha

- **Configuración**: El timezone se define en `config.display.timezone` (por defecto `Europe/Madrid`).
- **Backend**: Los endpoints que trabajan con fechas (`/api/calendar/events`, `/api/weather/weekly`) usan el timezone del config para:
  - Construir rangos del día local actual si no se proporcionan fechas.
  - Convertir siempre rangos local → UTC al consultar proveedores externos.
  - Loguear proyecciones local/UTC en DEBUG para trazabilidad.
- **Frontend**: Usa utilidades `formatLocal()` para renderizar horas/fechas según el timezone del config.
- **Hot-reload**: Con `POST /api/config/reload` cambiando `display.timezone`, los endpoints ajustan automáticamente sin reiniciar.
- **Metadatos**: `/api/health` expone `timezone` y `now_local_iso` para diagnóstico.

#### Diagnóstico calendario (inspect)

- **Modo inspección**: Añade `?inspect=1` o `?debug=1` a `/api/calendar/events` para obtener información detallada:
  - `tz`: Timezone aplicada (p. ej., `Europe/Madrid`)
  - `local_range`: Rango del día local calculado (`start`, `end` en ISO)
  - `utc_range`: Conversión a UTC del rango local (`start`, `end` en ISO)
  - `provider`: Proveedor usado (`google`, `ics` o `disabled`)
  - `provider_enabled`: Si el proveedor está habilitado
  - `credentials_present`: Si existen credenciales (API key y calendar ID para Google, o url/path para ICS)
  - `calendars_found`: Número de calendarios detectados
  - `raw_events_count`: Eventos crudos recibidos del proveedor
  - `filtered_events_count`: Eventos tras normalización
  - `note`: Motivo si no hay eventos (p. ej., sin credenciales, error API, provider deshabilitado)
- **Estado en health**: `/api/health` incluye bloque `calendar` con:
  - `enabled`: Si el calendario está habilitado
  - `provider`: Proveedor configurado (`google`, `ics` o `disabled`)
  - `credentials_present`: Si hay credenciales
  - `last_fetch_iso`: Última consulta exitosa (si está disponible)
  - `status`: Estado (`ok`, `stale`, `error`, `disabled`)
- **Configuración de calendario**: En `/config`, puedes seleccionar el proveedor (`google`, `ics` o `disabled`):
  - **Google Calendar**: Requiere `secrets.google.api_key` y `secrets.google.calendar_id`
  - **ICS (iCalendar)**: Requiere `secrets.calendar_ics.url` (HTTP/HTTPS) o `secrets.calendar_ics.path` (ruta local)
  - **Deshabilitado**: Desactiva completamente el panel de calendario
- **Logs DEBUG**: El backend loguea información detallada con prefijo `[Calendar]` y `[timezone]`:
  ```bash
  journalctl -u pantalla-dash-backend@dani -n 60 --no-pager -l | egrep -i 'calendar|tz|range|utc'
  ```

### Integración OpenSky

- Crea un cliente OAuth2 en el portal de [OpenSky Network](https://opensky-network.org/)
  (sección *API Access → OAuth2 client credentials*). El formulario devuelve un
  `client_id` y `client_secret` válidos para `grant_type=client_credentials`.
- El backend solicita tokens en
  `https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token`
  enviando ambos valores como `application/x-www-form-urlencoded`. Los tokens
  duran ~30 minutos y se renuevan automáticamente 60 segundos antes de expirar.
- Desde la tarjeta **OpenSky** de `/config` puedes:
  - Habilitar/deshabilitar la capa de vuelos sin tocar el resto del dashboard.
  - Definir el *bounding box* (Castellón por defecto) o cambiar a modo global.
  - Ajustar `poll_seconds` (mínimo 10 s en modo anónimo, 5 s con credenciales).
  - Limitar el número máximo de aeronaves (`max_aircraft`) y activar el clustering.
  - Solicitar el modo extendido (`extended=1`) para obtener categoría y squawk.
- Los secretos se guardan en `/var/lib/pantalla/secrets/opensky_client_*` via
  `PUT /api/config/secret/opensky_client_id` y
  `PUT /api/config/secret/opensky_client_secret`. Las respuestas `GET` sólo
  exponen `{"set": true|false}` para confirmar si existe un valor persistido.
- La UI incluye un botón «Probar conexión» que consulta `/api/opensky/status` y
  muestra: validez del token, edad del último sondeo, conteo de aeronaves
  cacheadas y cualquier error reciente (401, 429, backoff en curso, etc.).
- El endpoint público `/api/layers/flights` devuelve `items[]` normalizados
  (lon/lat, velocidad, rumbo, país, última recepción) y se apoya en una caché
  en memoria con TTL = `poll_seconds` (nunca <5 s). Si OpenSky responde con 429
  o 5xx se reutiliza el último snapshot marcándolo como `stale=true`.

### Nginx (reverse proxy `/api`)

- El virtual host `etc/nginx/sites-available/pantalla-reloj.conf` debe quedar
  activo y apuntar a `/var/www/html`. Asegúrate de que el bloque `/api/` use
  `proxy_pass http://127.0.0.1:8081;` **sin barra final** para mantener los
  paths correctos.
- El site por defecto de Nginx no debe estar habilitado: elimina el symlink
  `/etc/nginx/sites-enabled/default` para evitar colisiones con `server_name _`.

### Verificación post-deploy

Tras cada build o despliegue ejecuta la verificación rápida del proxy/API:

```bash
chmod +x scripts/verify_api.sh
./scripts/verify_api.sh
```

Confirma que `nginx -t` pasa y que `/api/health` y `/api/config` responden vía
Nginx antes de dar por finalizada la actualización.

### Checks posteriores a install.sh

Tras ejecutar `sudo bash scripts/install.sh` valida el estado final con:

```bash
systemctl is-active pantalla-openbox@dani
systemctl is-active pantalla-kiosk@dani
curl -s http://127.0.0.1/ui-healthz
systemctl show pantalla-kiosk@dani -p Environment
pantalla-kiosk-verify
```

- `curl` debe devolver `{"ui":"ok"}` (HTTP 200) gracias al fallback SPA.
- `systemctl show ... -p Environment` debe listar `EnvironmentFile=/var/lib/pantalla-reloj/state/kiosk.env` y las variables
  heredadas de ese archivo.
- `pantalla-kiosk-verify` debe terminar con código 0; cualquier resumen diferente a
  `ok` merece revisión antes de cerrar el despliegue.

### Wi-Fi por defecto

`install.sh` crea `/etc/pantalla-reloj/wifi.conf` con `WIFI_INTERFACE=wlp2s0` para
uniformar la configuración inalámbrica. Comprueba la interfaz presente en el
equipo con `nmcli device status` y edita el archivo si usas otro nombre (p. ej.
`wlan0`). Recarga cualquier script/servicio dependiente tras modificar la
variable.

### Build estable (guardarraíles Node/npm)

- El repositorio incluye `.nvmrc` fijado a **Node.js 18.20.3** y `package.json`
  exige `node >=18.18 <21` y `npm >=9 <11` para evitar incompatibilidades.
- Todos los scripts usan `npm install --no-audit --no-fund` en lugar de
  `npm ci`, de modo que el lockfile se sincroniza automáticamente cuando cambian
  las dependencias.
- Comandos de referencia para despliegues reproducibles:

  ```bash
  nvm use || true
  npm run build:stable
  npm run verify:api
  ```

  `build:stable` limpia `node_modules`, instala dependencias sin auditoría y
  ejecuta `npm run build`.

### Servicios systemd
- `pantalla-xorg.service`: levanta `Xorg :0` sin display manager ni TCP.
- `pantalla-openbox@dani.service`: sesión gráfica minimalista con autostart que aplica
  la geometría fija descrita arriba y prepara el entorno antes de lanzar el kiosk.
- `pantalla-dash-backend@dani.service`: ejecuta el backend FastAPI como usuario `dani`
  vía `pantalla-backend-launch`, que valida imports y crea las rutas necesarias.
- `pantalla-kiosk@dani.service`: lanzador agnóstico que prioriza Chromium (deb o snap) y
  recurre a Firefox si no hay binario Chromium disponible; consume `kiosk.env` para
  URL y overrides.
- `pantalla-kiosk-chromium@dani.service`: wrapper legado mantenido para entornos que
  aún dependan del despliegue antiguo; no se habilita por defecto.

## Arranque estable (boot hardening)

- **Openbox autostart robusto** (`openbox/autostart`): deja trazas en
  `/var/log/pantalla-reloj/openbox-autostart.log`, deshabilita DPMS y entrega el
  control al servicio Chromium para que aplique la geometría conocida.
- **Sesión X autenticada**: `pantalla-xorg.service` delega en
  `/usr/lib/pantalla-reloj/xorg-launch.sh`, que genera de forma determinista la
  cookie `MIT-MAGIC-COOKIE-1` en `/home/dani/.Xauthority` y la reutiliza para
  Openbox y el navegador.
- **Lanzador de navegador resiliente**: `pantalla-kiosk@dani.service` selecciona
  Chromium (`chromium-browser`, `chromium`, snap o `CHROME_BIN_OVERRIDE`) y recurre a
  Firefox como fallback, reutilizando perfiles persistentes en
  `/var/lib/pantalla-reloj/state/chromium-kiosk` o `/var/lib/pantalla-reloj/state/firefox-kiosk`.
- **Orden de arranque garantizado**: `pantalla-openbox@dani.service` depende de
  `pantalla-xorg.service`, del backend y de Nginx (`After=`/`Wants=`) con reinicio
  automático (`Restart=always`). `pantalla-xorg.service` se engancha a
  `graphical.target`, levanta `Xorg :0` en `vt7` y también se reinicia ante fallos.
- **Healthchecks previos al navegador**: el script de autostart espera a que Nginx y
  el backend respondan antes de lanzar la ventana kiosk, evitando popups de “la página
  no responde”.
- **Grupos del sistema**: durante la instalación `install.sh` añade a `dani` a los
  grupos `render` y `video`, informando si se requiere reinicio (con opción
  `--auto-reboot` para reiniciar automáticamente).
- **Display manager controlado**: el instalador enmascara `display-manager.service`
  (registrándolo en `/var/lib/pantalla-reloj/state`) y el desinstalador solo lo
  deshace si lo enmascaramos nosotros, evitando interferencias con sesiones gráficas
  ajenas.

## Kiosk Browser

### Servicios esenciales

```bash
sudo systemctl enable --now pantalla-xorg.service
sudo systemctl enable --now pantalla-openbox@dani.service
sudo systemctl enable --now pantalla-kiosk@dani.service
```

`pantalla-kiosk@.service` carga `/var/lib/pantalla-reloj/state/kiosk.env` y fija
`DISPLAY=:0`, `XAUTHORITY=/home/%i/.Xauthority`, `GDK_BACKEND=x11`,
`GTK_USE_PORTAL=0`, `GIO_USE_PORTALS=0` y `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/%U/bus`
para que Chromium (paquete deb o snap) funcione sin portales ni errores de bus.

### Archivo `kiosk.env` (overrides)

`scripts/install.sh` crea `kiosk.env` solo si no existe. El archivo mantiene
variables persistentes y puede editarse manualmente. Valores admitidos:

- `KIOSK_URL` – URL inicial (por defecto `http://127.0.0.1/`).
- `CHROME_BIN_OVERRIDE` – comando o ruta absoluta para Chromium/Chrome.
- `FIREFOX_BIN_OVERRIDE` – comando o ruta absoluta para Firefox.
- `CHROMIUM_PROFILE_DIR` – perfil persistente de Chromium
  (default `/var/lib/pantalla-reloj/state/chromium-kiosk`).
- `FIREFOX_PROFILE_DIR` – perfil persistente de Firefox
  (default `/var/lib/pantalla-reloj/state/firefox-kiosk`).
- `PANTALLA_CHROMIUM_VERBOSE` – `1` para añadir `--v=1` y forzar trazas VERBOSE.
- `PANTALLA_ALLOW_SWIFTSHADER` – `1` para permitir el fallback
  `--enable-unsafe-swiftshader` si ANGLE falla.

Después de editar `kiosk.env`, ejecuta `sudo systemctl restart pantalla-kiosk@dani`.

### Orden de preferencia del navegador

1. `CHROME_BIN_OVERRIDE` (o `CHROMIUM_BIN_OVERRIDE` heredado) si apunta a un
   ejecutable válido.
2. `chromium-browser`.
3. `chromium`.
4. `/snap/bin/chromium`.
5. `google-chrome-stable` / `google-chrome`.
6. `/snap/chromium/current/usr/lib/chromium-browser/chrome`.
7. `FIREFOX_BIN_OVERRIDE`.
8. `firefox`.
9. `firefox-esr`.

Si no se encuentra ningún binario compatible el servicio escribe un error y se
reinicia tras `RestartSec=2`.

### Flags y perfiles persistentes

Chromium se lanza con los flags mínimos requeridos para kiosk estable:
`--kiosk --no-first-run --no-default-browser-check --password-store=basic`,
`--ozone-platform=x11`, `--ignore-gpu-blocklist`, `--enable-webgl` y
`--use-gl=egl-angle`, siempre acompañados de `--user-data-dir=<perfil>`. Firefox
recibe `--kiosk --new-instance --profile <dir> --no-remote`.

El wrapper elimina previamente cualquier ventana `pantalla-kiosk` o
`chrome.chromium` con `wmctrl -ic` y replica el stderr del navegador en
`/tmp/pantalla-chromium.XXXXXX.log` y `/var/log/pantalla/browser-kiosk.log`. Usa
`PANTALLA_CHROMIUM_VERBOSE=1` para habilitar `--v=1` o `PANTALLA_ALLOW_SWIFTSHADER=1`
para permitir el fallback software.

Los perfiles viven en `/var/lib/pantalla-reloj/state/chromium-kiosk` y
`/var/lib/pantalla-reloj/state/firefox-kiosk` (permisos `0700`). Puedes moverlos
editando `kiosk.env`.

### Troubleshooting DBus y portals

El entorno fija explícitamente `DBUS_SESSION_BUS_ADDRESS`, `GTK_USE_PORTAL=0` y
`GIO_USE_PORTALS=0`. Si reaparece el error “Failed to connect to the bus: Could
not parse server address”, confirma que `/run/user/<UID>/bus` existe y que
`systemctl show pantalla-kiosk@dani -p Environment` refleja la variable. Eliminar
portals evita cuadros de diálogo inesperados en modo kiosk.

### Logs y diagnóstico

El lanzador escribe en `/var/log/pantalla/browser-kiosk.log`. Para revisar la
ejecución completa usa `journalctl -u pantalla-kiosk@dani.service -n 120 --no-pager -l`.
`/usr/local/bin/diag_kiosk.sh` sigue siendo compatible y vuelca variables, PID y
trazas `diagnostics:auto-pan` durante 20 segundos.

### Diagnóstico rápido

```bash
sudo systemctl status pantalla-xorg.service pantalla-openbox@dani.service \
  pantalla-kiosk@dani.service
DISPLAY=:0 xrandr --query
DISPLAY=:0 wmctrl -lx
```

### Modo diagnóstico del kiosk

Para forzar temporalmente `/diagnostics/auto-pan` añade la entrada
`KIOSK_URL=http://127.0.0.1/diagnostics/auto-pan?force=1&reducedMotion=0` a
`kiosk.env` o aplica un drop-in con `systemctl edit pantalla-kiosk@dani.service`.
Recarga con `sudo systemctl daemon-reload` (si creaste un drop-in) y reinicia el
servicio. Comprueba el valor efectivo con
`systemctl show pantalla-kiosk@dani -p Environment` y vuelve a
`http://127.0.0.1/` al terminar.

## Instalación

### Requisitos previos

- Ubuntu 24.04 LTS con usuario **dani** creado y sudo disponible.
- Paquetes base: `sudo apt-get install -y git curl ca-certificates`.
- Node.js 20.x instalado desde NodeSource u otra fuente compatible (incluye
  Corepack y npm; **no** instales `npm` con `apt`).
- Acceso a Internet para descargar dependencias del backend/frontend y,
  opcionalmente, el tarball oficial de Firefox.

### Instalación automatizada

```bash
sudo bash scripts/install.sh --non-interactive
```

Si quieres conservar Firefox como navegador alternativo, añade la bandera
`--with-firefox` al comando anterior.

El instalador es idempotente: puedes ejecutarlo varias veces y dejará el sistema
en un estado consistente. Durante la instalación:

- Se validan e instalan las dependencias APT requeridas.
- Se habilita Corepack con `npm` actualizado sin usar `apt install npm`.
- Se instala el lanzador multi-navegador (`/usr/local/bin/pantalla-kiosk`) y la
  unidad `pantalla-kiosk@.service`, creando `kiosk.env` solo si falta para evitar
  sobrescrituras.
- Se prepara el backend (venv + `requirements.txt`) sirviendo en
  `http://127.0.0.1:8081` y se crea `/var/lib/pantalla/config.json` con el layout
  `full`, panel derecho y overlay oculto.
- Se construye el frontend (`dash-ui`) aplicando las variables Vite por defecto y
  se publica en `/var/www/html`.
- Se configura Nginx como reverse proxy (`/api/` → backend) y servidor estático.
- Se instalan y activan las unidades systemd (`pantalla-xorg.service`,
  `pantalla-openbox@dani.service`, `pantalla-dash-backend@dani.service`).
- Se asegura la rotación de la pantalla a horizontal y se lanza el navegador kiosk
  (Chromium por defecto, Firefox como fallback) apuntando a `http://127.0.0.1`.
- Crea `/var/log/pantalla`, `/var/lib/pantalla` y `/var/lib/pantalla-reloj/state`,
  asegurando que la cookie `~/.Xauthority` exista con permisos correctos para
  `dani`.

Al finalizar verás un resumen con el estado del backend, frontend, Nginx y los
servicios systemd.

## Desinstalación

```bash
sudo bash scripts/uninstall.sh
```

Detiene y elimina los servicios, borra `/opt/pantalla`, `/opt/firefox`,
`/var/lib/pantalla`, `/var/log/pantalla`, restaura `/var/www/html` con el HTML
por defecto y elimina el symlink de Firefox si apuntaba a `/opt/firefox`.
También desinstala las unidades systemd sin reactivar ningún display manager.

## Health check y troubleshooting

- Verificar backend: `curl -sf http://127.0.0.1:8081/api/health` (debe devolver
  HTTP 200 con `{"status": "ok"}`).
- Verificar Nginx: `sudo systemctl is-active nginx`.
- Verificar servicios gráficos: `sudo systemctl is-active pantalla-xorg.service`,
  `sudo systemctl is-active pantalla-openbox@dani.service`.
- Verificar backend por systemd: `sudo systemctl status pantalla-dash-backend@dani.service`.
- Logs del backend: `/tmp/backend-launch.log`.
- Errores de Nginx: `/var/log/nginx/pantalla-reloj.error.log`.

### Solución de problemas

#### Problemas comunes con calendario ICS

1. **El calendario no muestra eventos**:
   - Verifica que el archivo ICS se haya subido correctamente:
     ```bash
     curl -s http://127.0.0.1:8081/api/calendar/status
     ```
     Debe devolver `"status": "ok"` si está funcionando.
   - Verifica que el proveedor esté configurado como `ics`:
     ```bash
     curl -s http://127.0.0.1:8081/api/config | python3 -m json.tool | grep -A 5 calendar
     ```
   - Comprueba que el archivo ICS tenga el formato correcto:
     ```bash
     head -n 5 /var/lib/pantalla-reloj/ics/calendar.ics
     ```
     Debe comenzar con `BEGIN:VCALENDAR`.

2. **Error al subir archivo ICS**:
   - Verifica que el archivo no exceda 2 MB:
     ```bash
     ls -lh tu_archivo.ics
     ```
   - Verifica que el archivo tenga extensión `.ics`:
     ```bash
     file tu_archivo.ics
     ```
   - Revisa los logs del backend:
     ```bash
     journalctl -u pantalla-dash-backend@dani.service -n 50 --no-pager | grep -i ics
     ```

3. **El calendario muestra `status: "error"`**:
   - Verifica que el archivo ICS existe y es legible:
     ```bash
     sudo -u dani test -r /var/lib/pantalla-reloj/ics/calendar.ics && echo "OK" || echo "ERROR"
     ```
   - Verifica los permisos del directorio ICS:
     ```bash
     ls -ld /var/lib/pantalla-reloj/ics/
     ```
   - Revisa el estado del calendario:
     ```bash
     curl -s http://127.0.0.1:8081/api/calendar/status | python3 -m json.tool
     ```
     Busca el campo `note` para ver el mensaje de error específico.

#### Problemas con layers (radar/aviones/barcos)

1. **Las capas no se activan**:
   - Verifica la configuración actual:
     ```bash
     curl -s http://127.0.0.1:8081/api/config | python3 -m json.tool | grep -A 10 layers
     ```
   - Activa las capas manualmente:
     ```bash
     curl -X POST http://127.0.0.1:8081/api/config \
       -H "Content-Type: application/json" \
       -d '{"version": 2, "ui_map": {}, "layers": {"flights": {"enabled": true}, "ships": {"enabled": true}}, "ui_global": {"radar": {"enabled": true}}}'
     ```

2. **El radar no se muestra**:
   - Verifica que AEMET esté configurado:
     ```bash
     curl -s http://127.0.0.1:8081/api/config | python3 -m json.tool | grep -A 5 aemet
     ```
   - Verifica el estado de AEMET en el health:
     ```bash
     curl -s http://127.0.0.1:8081/api/health | python3 -m json.tool | grep -A 10 aemet
     ```

#### Problemas con la persistencia de configuración

1. **Los cambios en `/config` no se guardan**:
   - Verifica los permisos del archivo de configuración:
     ```bash
     ls -l /var/lib/pantalla-reloj/config.json
     ```
   - Verifica que el directorio tenga permisos correctos:
     ```bash
     ls -ld /var/lib/pantalla-reloj/
     ```
   - Revisa los logs del backend para errores de escritura:
     ```bash
     journalctl -u pantalla-dash-backend@dani.service -n 50 --no-pager | grep -i "config\|persist\|write"
     ```

2. **La configuración se corrompe**:
   - Verifica que el archivo JSON sea válido:
     ```bash
     python3 -m json.tool /var/lib/pantalla-reloj/config.json > /dev/null && echo "OK" || echo "ERROR"
     ```
   - Restaura desde un backup si es necesario:
     ```bash
     sudo cp /var/lib/pantalla-reloj/config.json.backup /var/lib/pantalla-reloj/config.json
     ```

#### Smoke test E2E

Ejecuta el script de smoke test para verificar que todos los componentes funcionan correctamente:

```bash
chmod +x scripts/smoke_v23.sh
bash scripts/smoke_v23.sh
```

El script verifica:
1. Health endpoint (HTTP 200)
2. Subida de archivo ICS
3. Activación de layers (radar/aviones/barcos)
4. Eventos de calendario (>= 1 evento)
5. Calendar status ("ok")

Si algún test falla, el script mostrará el error específico y sugerencias de diagnóstico.

### Runbook: pantalla negra + puntero

1. Revisar servicios clave:
   ```bash
   sudo systemctl status pantalla-xorg.service pantalla-openbox@dani.service \
     pantalla-dash-backend@dani.service pantalla-kiosk@dani.service
   ```
2. Si el backend falló, inspeccionar `/tmp/backend-launch.log`; para reiniciar:
   ```bash
   sudo systemctl restart pantalla-dash-backend@dani.service
   curl -sS http://127.0.0.1:8081/healthz
   ```
3. Validar que Chromium tenga acceso a DISPLAY=:0:
   ```bash
   sudo -u dani env DISPLAY=:0 XAUTHORITY=/home/dani/.Xauthority \
     chromium-browser --version
   ```
   Si falla con "Authorization required", revisa permisos de `~/.Xauthority`.
4. Diagnosticar geometría activa y ventanas:
   ```bash
   DISPLAY=:0 XAUTHORITY=/home/dani/.Xauthority xrandr --query
   DISPLAY=:0 XAUTHORITY=/home/dani/.Xauthority wmctrl -lx
   ```
5. Reaplicar la secuencia mínima de `xrandr` si aparece `BadMatch`:
   ```bash
   DISPLAY=:0 XAUTHORITY=/home/dani/.Xauthority xrandr --fb 1920x1920
   DISPLAY=:0 XAUTHORITY=/home/dani/.Xauthority \
     xrandr --output HDMI-1 --mode 480x1920 --primary --pos 0x0 --rotate left
   ```
6. Si persiste la pantalla negra, revisa el journal del servicio kiosk:
   ```bash
   journalctl -u pantalla-kiosk@dani.service -n 120 --no-pager -l
   ```

## Corrección de permisos

```bash
sudo bash scripts/fix_permissions.sh [usuario] [grupo]
```

Por defecto ajusta permisos para `dani:dani` y vuelve a asignar `/var/www/html` a
`www-data`.

## Reparación del entorno kiosk

Si Firefox, Xorg u Openbox quedaron en un estado inconsistente (por ejemplo, un
symlink roto en `/usr/local/bin/firefox` o permisos erróneos en
`/run/user/1000`), ejecuta:

```bash
sudo KIOSK_USER=dani scripts/fix_kiosk_env.sh --with-firefox
```

El script reinstala el navegador desde Mozilla (opcional con
`--with-firefox`), restablece `~/.mozilla/pantalla-kiosk`, `.Xauthority`,
copias actualizadas de los servicios `pantalla-*.service` y reactiva
automáticamente `pantalla-xorg`, `pantalla-openbox@dani`,
`pantalla-dash-backend@dani` y `pantalla-kiosk@dani`.

## Desarrollo local

- Backend: `cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && uvicorn main:app --reload`
- Frontend: `cd dash-ui && npm install && npm run dev`

Puedes sobreescribir rutas del backend exportando `PANTALLA_STATE_DIR`,
`PANTALLA_CONFIG_FILE` o `PANTALLA_CACHE_DIR` durante el desarrollo.
