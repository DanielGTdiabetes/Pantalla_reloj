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
- Se ejecuta bajo `uvicorn backend.main:app --host 127.0.0.1 --port 8081` dentro de un
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

> **Requisitos**: ejecutar como `root` en Ubuntu 24.04 minimal, con usuario
> `dani` ya creado.

```bash
sudo bash scripts/install.sh --non-interactive
```

El instalador es idempotente. Instala dependencias APT, descarga Firefox tarball,
compila la UI, crea la estructura `/opt/pantalla`, copia el backend y activa los
servicios systemd. Al finalizar genera un reporte en
`/var/log/pantalla/install_report.html` con el estado de los servicios y la salida de
`/api/health`.

## Desinstalación

```bash
sudo bash scripts/uninstall.sh
```

Detiene y elimina los servicios, borra `/opt/pantalla`, `/var/log/pantalla`,
`/var/www/html` y elimina el symlink de Firefox si apunta a `/opt/firefox`.

## Corrección de permisos

```bash
sudo bash scripts/fix_permissions.sh [usuario] [grupo]
```

Por defecto ajusta permisos para `dani:dani` y vuelve a asignar `/var/www/html` a
`www-data`.

## Desarrollo local

- Backend: `cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && uvicorn backend.main:app --reload`
- Frontend: `cd dash-ui && npm install && npm run dev`

Puedes sobreescribir rutas del backend exportando `PANTALLA_ROOT` o
`PANTALLA_CONFIG_FILE` durante el desarrollo.
