# Pantalla_reloj (versión estable 2025-10)

Sistema reproducible para mini-PC Ubuntu 24.04 LTS con pantalla HDMI 8.8" orientada
verticalmente. La solución combina **FastAPI** (backend), **React + Vite**
(frontend) y un stack gráfico mínimo **Xorg + Openbox + Firefox kiosk**.

## Arquitectura

```
Pantalla_reloj/
├─ backend/                  # FastAPI con endpoints de salud, datos y configuración
├─ dash-ui/                  # React/Vite UI en modo kiosk
├─ scripts/                  # install.sh, uninstall.sh, fix_permissions.sh
├─ systemd/                  # Servicios pantalla-*.service
├─ etc/nginx/sites-available # Virtual host de Nginx
└─ openbox/autostart         # Lanzamiento de Firefox en modo kiosk
```

### Backend (FastAPI)
- Endpoints: `/api/health`, `/api/config` (GET/POST), `/api/weather`, `/api/news`,
  `/api/astronomy`, `/api/calendar`, `/api/storm_mode` (GET/POST).
- Persistencia de configuración en `/opt/pantalla/config/config.json`.
- Cache JSON en `/opt/pantalla/cache/` y logs en `/var/log/pantalla/backend.log`.
- Se ejecuta bajo `uvicorn main:app --host 127.0.0.1 --port 8081` dentro de un
  entorno virtual local (`/opt/pantalla/backend/.venv`).

### Frontend (React/Vite)
- Dashboard no interactivo que rota módulos (hora, clima, astronomía, noticias,
  efemérides y calendario) en un panel principal.
- Barra lateral translúcida con estado de rotación, modo tormenta y acceso rápido a
  la página `/config`.
- Página de configuración con edición de API keys, rotación de pantalla, ajustes de
  MQTT y credenciales Wi-Fi (wlan2).
- Compilado con `npm run build` y servido por Nginx desde `/var/www/html`.

### Servicios systemd
- `pantalla-xorg.service`: levanta `Xorg :0` sin display manager ni TCP.
- `pantalla-openbox@dani.service`: sesión gráfica minimalista con autostart que rota
  HDMI-1 y lanza Firefox en modo kiosk.
- `pantalla-dash-backend@dani.service`: ejecuta el backend FastAPI como usuario `dani`.

## Instalación

### Requisitos previos

- Ubuntu 24.04 LTS con usuario **dani** creado y sudo disponible.
- Paquetes base: `sudo apt-get install -y git curl ca-certificates`.
- Node.js 20.x instalado desde NodeSource u otra fuente compatible (incluye
  Corepack y npm; **no** instales `npm` con `apt`).
- Acceso a Internet para descargar dependencias del backend/frontend y el
  tarball oficial de Firefox.

### Instalación automatizada

```bash
sudo bash scripts/install.sh --non-interactive
```

El instalador es idempotente: puedes ejecutarlo varias veces y dejará el sistema
en un estado consistente. Durante la instalación:

- Se validan e instalan las dependencias APT requeridas.
- Se habilita Corepack con `npm` actualizado sin usar `apt install npm`.
- Se descarga y despliega Firefox en `/opt/firefox` y se crea el symlink
  `/usr/local/bin/firefox`.
- Se prepara el backend (venv + `requirements.txt`) sirviendo en
  `http://127.0.0.1:8081`.
- Se construye el frontend (`dash-ui`) con npm y se publica en `/var/www/html`.
- Se configura Nginx como reverse proxy (`/api/` → backend) y servidor estático.
- Se instalan y activan las unidades systemd (`pantalla-xorg.service`,
  `pantalla-openbox@dani.service`, `pantalla-dash-backend@dani.service`).
- Se asegura la rotación de la pantalla a horizontal y se lanza Firefox en modo
  kiosk apuntando a `http://127.0.0.1`.

Al finalizar verás un resumen con el estado del backend, frontend, Nginx y los
servicios systemd.

## Desinstalación

```bash
sudo bash scripts/uninstall.sh
```

Detiene y elimina los servicios, borra `/opt/pantalla`, `/var/log/pantalla`,
`/var/www/html` (contenido) y elimina el symlink de Firefox si apunta a
`/opt/firefox`. También desinstala las unidades systemd y deshace el `mask` del
display manager.

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

## Desarrollo local

- Backend: `cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && uvicorn main:app --reload`
- Frontend: `cd dash-ui && npm install && npm run dev`

Puedes sobreescribir rutas del backend exportando `PANTALLA_ROOT` o
`PANTALLA_CONFIG_FILE` durante el desarrollo.
