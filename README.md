# Pantalla_reloj (versión estable 2025-10)

Sistema reproducible para mini-PC Ubuntu 24.04 LTS con pantalla HDMI 8.8" orientada
verticalmente. La solución combina **FastAPI** (backend), **React + Vite**
(frontend) y un stack gráfico mínimo **Xorg + Openbox + Epiphany en modo kiosk**
(Firefox queda como opción adicional).

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
  valores por defecto si no existe).
- Cache JSON en `/var/lib/pantalla/cache/` y logs en `/var/log/pantalla/backend.log`.
- Se ejecuta bajo `uvicorn main:app --host 127.0.0.1 --port 8081` dentro de un
  entorno virtual local (`/opt/pantalla/backend/.venv`).

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

### Servicios systemd
- `pantalla-xorg.service`: levanta `Xorg :0` sin display manager ni TCP.
- `pantalla-openbox@dani.service`: sesión gráfica minimalista con autostart que rota
  HDMI-1 y abre Epiphany en `http://127.0.0.1/` (Firefox solo si se instala con
  `--with-firefox`).
- `pantalla-dash-backend@dani.service`: ejecuta el backend FastAPI como usuario `dani`.

## Arranque estable (boot hardening)

- **Openbox autostart robusto** (`openbox/autostart`): deja trazas en
  `/var/log/pantalla-reloj/openbox-autostart.log`, deshabilita DPMS, actualiza el
  entorno de DBus y rota la pantalla antes de ceder el control al servicio del
  navegador.
- **Sesión X autenticada**: `pantalla-xorg.service` delega en
  `/usr/lib/pantalla-reloj/xorg-launch.sh`, que genera de forma determinista la
  cookie `MIT-MAGIC-COOKIE-1` en `/var/lib/pantalla-reloj/.Xauthority` (propiedad de
  `dani`) y la reutiliza para Openbox y el navegador.
- **Lanzador de navegador resiliente**: `usr/local/bin/pantalla-kiosk` espera hasta 60
  intentos a que el backend (`/api/health`) y el frontend (`/`) respondan con HTTP 200
  antes de abrir Epiphany, utiliza `flock` para evitar ejecuciones simultáneas y
  registra la actividad en `/var/log/pantalla-reloj/kiosk.log`.
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
- Se instala Epiphany como navegador kiosk por defecto (Firefox se descarga solo
  si se ejecuta con `--with-firefox`).
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
- Logs del backend: `/var/log/pantalla/backend.log`.
- Errores de Nginx: `/var/log/nginx/pantalla-reloj.error.log`.

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
