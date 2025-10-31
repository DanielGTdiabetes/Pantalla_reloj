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
- Persistencia de configuración en `/var/lib/pantalla/config.json` (se crea con
  valores por defecto si no existe) y caché JSON en `/var/lib/pantalla/cache/`.
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
