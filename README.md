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
  `/api/astronomy`, `/api/calendar`, `/api/storm_mode` (GET/POST).
- Persistencia de configuración en `/var/lib/pantalla/config.json` (se crea con
  valores por defecto si no existe) y caché JSON en `/var/lib/pantalla/cache/`.
- El lanzador `usr/local/bin/pantalla-backend-launch` garantiza que existan
  `/var/log/pantalla` y `/var/lib/pantalla`, verifica que `import backend.main`
  funcione (fallando con código 3 si no) y envía stdout/stderr a
  `/tmp/backend-launch.log` antes de delegar en `uvicorn main:app --host
  127.0.0.1 --port 8081` dentro de un entorno virtual local
  (`/opt/pantalla/backend/.venv`).

### Frontend (React/Vite)
- Dashboard por defecto en modo `full`: mapa principal con tarjetas de noticias y
  eventos, más panel lateral derecho con métricas de clima, rotación y estado de
  tormenta.
- El panel lateral puede moverse a la izquierda y el carrusel de módulos (modo demo)
  puede activarse desde `/config`; por defecto ambos permanecen deshabilitados.
- `/config` expone la administración completa (rotación, API keys, MQTT, Wi-Fi y
  opciones de UI). El overlay solo aparece en `/` si se añade `?overlay=1` para
  depuración puntual.
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
systemctl is-active pantalla-kiosk-chromium@dani
curl -s http://127.0.0.1/ui-healthz
systemctl show pantalla-kiosk-chromium@dani -p Environment
pantalla-kiosk-verify
```

- `curl` debe devolver `{"ui":"ok"}` (HTTP 200) gracias al fallback SPA.
- `systemctl show ... -p Environment` debe listar un único `KIOSK_URL=...` definido en
  `/etc/systemd/system/pantalla-kiosk-chromium@dani.service.d/override.conf`.
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
- `pantalla-kiosk@dani.service`: (obsoleto) mantiene la integración con Epiphany para
  instalaciones que aún no migran.
- `pantalla-kiosk-chromium@dani.service`: navegador recomendado basado en Chromium
  (paquete deb o snap) con rotación estable 480×1920, DPMS deshabilitado y sin portals.

## Arranque estable (boot hardening)

- **Openbox autostart robusto** (`openbox/autostart`): deja trazas en
  `/var/log/pantalla-reloj/openbox-autostart.log`, deshabilita DPMS y entrega el
  control al servicio Chromium para que aplique la geometría conocida.
- **Sesión X autenticada**: `pantalla-xorg.service` delega en
  `/usr/lib/pantalla-reloj/xorg-launch.sh`, que genera de forma determinista la
  cookie `MIT-MAGIC-COOKIE-1` en `/home/dani/.Xauthority` y la reutiliza para
  Openbox y el navegador.
- **Lanzador de navegador resiliente**: `pantalla-kiosk-chromium@dani.service`
  arranca `chromium-browser` con `--ozone-platform=x11`, `--disable-gpu` y un
  `user-data-dir` persistente en `/var/lib/pantalla-reloj/state/chromium`, tras
  ejecutar únicamente la secuencia mínima y estable de `xrandr` para 480×1920.
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

## Kiosk (Chromium) — Opción A (Recomendada)

Habilita los tres servicios gráficos y el navegador Chromium con:

```bash
sudo systemctl enable --now pantalla-xorg.service
sudo systemctl enable --now pantalla-openbox@dani.service
sudo systemctl enable --now pantalla-kiosk-chromium@dani.service
```

### Troubleshooting específico de Chromium

- **BadMatch (RANDR RRSetCrtcConfig)**: asegúrate de ejecutar únicamente:
  ```bash
  xrandr --fb 1920x1920
  xrandr --output HDMI-1 --mode 480x1920 --primary --pos 0x0 --rotate left
  ```
  Elimina cualquier `--fb 480x1920` previo.
- **"Authorization required" / "Missing X server or $DISPLAY"**: confirma que
  exista `/home/dani/.Xauthority` (no debe ser un symlink), con permisos
  `-rw------- dani:dani`.
- **Verificación rápida de modos**:
  ```bash
  DISPLAY=:0 xrandr --query
  ```
  Debe mostrar `HDMI-1 connected 480x1920+0+0 left (normal left inverted right x axis y axis)`.

### Diagnóstico rápido

```bash
sudo systemctl status pantalla-xorg.service pantalla-openbox@dani.service \
  pantalla-kiosk-chromium@dani.service
DISPLAY=:0 xrandr --query
DISPLAY=:0 wmctrl -lx
```

Para un volcado rápido de entorno y bearings ejecuta
`sudo /usr/local/bin/diag_kiosk.sh` (acepta el usuario como argumento opcional).
El script muestra las variables efectivas del servicio, la línea de comandos de
Chromium y retransmite durante 20 s las trazas `diagnostics:auto-pan` desde
`journalctl`.

#### Modo diagnóstico del kiosk

Para forzar temporalmente la ruta `/diagnostics/auto-pan` (útil al ajustar el
autopan) edita el override de systemd y reinicia el servicio:

```bash
sudoedit /etc/systemd/system/pantalla-kiosk-chromium@dani.service.d/override.conf
# Sustituye/añade:
# Environment=KIOSK_URL=http://127.0.0.1/diagnostics/auto-pan?force=1&reducedMotion=0
sudo systemctl daemon-reload
sudo systemctl restart pantalla-kiosk-chromium@dani.service
```

Comprueba el valor activo con
`systemctl show pantalla-kiosk-chromium@dani -p Environment` y revierte la URL a
`http://127.0.0.1/` cuando finalices la prueba.

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
- Se instala Epiphany como navegador histórico (Firefox se descarga solo si se
  ejecuta con `--with-firefox`). Para operar en modo soportado, habilita
  `pantalla-kiosk-chromium@dani.service` tras la instalación (ver sección
  "Kiosk (Chromium) — Opción A").
- Se prepara el backend (venv + `requirements.txt`) sirviendo en
  `http://127.0.0.1:8081` y se crea `/var/lib/pantalla/config.json` con el layout
  `full`, panel derecho y overlay oculto.
- Se construye el frontend (`dash-ui`) aplicando las variables Vite por defecto y
  se publica en `/var/www/html`.
- Se configura Nginx como reverse proxy (`/api/` → backend) y servidor estático.
- Se instalan y activan las unidades systemd (`pantalla-xorg.service`,
  `pantalla-openbox@dani.service`, `pantalla-dash-backend@dani.service`).
- Se asegura la rotación de la pantalla a horizontal y se lanza Epiphany en modo
  kiosk apuntando a `http://127.0.0.1` (Firefox solo si se solicitó).
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
     pantalla-dash-backend@dani.service pantalla-kiosk-chromium@dani.service
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
6. Si persiste la pantalla negra, revisa el journal del servicio Chromium:
   ```bash
   journalctl -u pantalla-kiosk-chromium@dani.service -n 120 --no-pager -l
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
`pantalla-dash-backend@dani` y `pantalla-kiosk@dani`. Tras su ejecución,
habilita manualmente `pantalla-kiosk-chromium@dani.service` si deseas volver al
modo recomendado con Chromium.

## Desarrollo local

- Backend: `cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && uvicorn main:app --reload`
- Frontend: `cd dash-ui && npm install && npm run dev`

Puedes sobreescribir rutas del backend exportando `PANTALLA_STATE_DIR`,
`PANTALLA_CONFIG_FILE` o `PANTALLA_CACHE_DIR` durante el desarrollo.
