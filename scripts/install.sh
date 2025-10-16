#!/usr/bin/env bash
set -euo pipefail

# ==========================
# Pantalla Futurista - Installer (hardening)
# Ubuntu/Debian + systemd · idempotente
# ==========================

# ----- Utilidades de log -----
log(){ printf "\033[1;34m[INFO]\033[0m %s\n" "$*"; }
warn(){ printf "\033[1;33m[WARN]\033[0m %s\n" "$*"; }
err(){ printf "\033[1;31m[ERR ]\033[0m %s\n" "$*" >&2; }
die(){ err "$*"; exit 1; }

# ----- Paths base -----
APP_USER="${SUDO_USER:-${USER}}"
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$REPO_DIR/backend"
FRONTEND_DIR="$REPO_DIR/dash-ui"
ENV_DIR="/etc/pantalla-dash"
ASSETS_DIR="/opt/dash/assets/backgrounds/auto"
LOG_DIR="/var/log/pantalla-dash"
NGINX_SITE="/etc/nginx/sites-available/pantalla"
SYSTEMD_DIR="/etc/systemd/system"

BACKEND_SVC_BASENAME="pantalla-dash-backend"
BACKEND_SVC_TEMPLATE="${BACKEND_SVC_BASENAME}@.service"
BG_SVC="pantalla-bg-generate.service"
BG_TIMER="pantalla-bg-generate.timer"

# ----- Defaults de configuración -----
AEMET_MUNICIPIO_ID="${AEMET_MUNICIPIO_ID:-12138}"   # Vila-real
AEMET_MUNICIPIO_NAME="${AEMET_MUNICIPIO_NAME:-Vila-real}"
AEMET_POSTAL_CODE="${AEMET_POSTAL_CODE:-12540}"
AEMET_PROVINCE="${AEMET_PROVINCE:-Castellón}"
CITY_NAME="${CITY_NAME:-Vila-real}"

# ----- Flags CLI / entorno -----
OPENAI_KEY="${OPENAI_KEY:-}"
AEMET_KEY="${AEMET_KEY:-}"
NON_INTERACTIVE="0"
ENV_FILE=""
INSTALL_NODE="1"

usage() {
  cat <<EOF
Uso: sudo bash install.sh [opciones]
  --openai-key KEY        Clave OpenAI (para fondos IA)
  --aemet-key KEY         Clave AEMET
  --municipio-id ID       (por defecto: ${AEMET_MUNICIPIO_ID})
  --municipio-name NAME   (por defecto: ${AEMET_MUNICIPIO_NAME})
  --postal-code CP        (por defecto: ${AEMET_POSTAL_CODE})
  --province NAME         (por defecto: ${AEMET_PROVINCE})
  --city NAME             (por defecto: ${CITY_NAME})
  --env FILE              Cargar variables desde .env (OPENAI_KEY=..., AEMET_KEY=...)
  --no-node               No instalar Node LTS
  --non-interactive       Sin preguntas
  -h, --help              Ayuda
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --openai-key) OPENAI_KEY="$2"; shift 2;;
    --aemet-key) AEMET_KEY="$2"; shift 2;;
    --municipio-id) AEMET_MUNICIPIO_ID="$2"; shift 2;;
    --municipio-name) AEMET_MUNICIPIO_NAME="$2"; shift 2;;
    --postal-code) AEMET_POSTAL_CODE="$2"; shift 2;;
    --province) AEMET_PROVINCE="$2"; shift 2;;
    --city) CITY_NAME="$2"; shift 2;;
    --env) ENV_FILE="$2"; shift 2;;
    --no-node) INSTALL_NODE="0"; shift;;
    --non-interactive) NON_INTERACTIVE="1"; shift;;
    -h|--help) usage; exit 0;;
    *) die "Opción desconocida: $1";;
  esac
done

[[ -f "$BACKEND_DIR/app.py" ]] || die "No encuentro backend en $BACKEND_DIR"
[[ -d "$FRONTEND_DIR" ]] || warn "No encuentro dash-ui en $FRONTEND_DIR (se saltará el build)"

if [[ -n "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  OPENAI_KEY="${OPENAI_KEY:-${OPENAI_API_KEY:-$OPENAI_KEY}}"
  AEMET_KEY="${AEMET_KEY:-${AEMET_API_KEY:-$AEMET_KEY}}"
fi

if [[ "$NON_INTERACTIVE" != "1" ]]; then
  if [[ -z "$OPENAI_KEY" ]]; then read -rp "OPENAI_API_KEY (enter para dejar vacío): " OPENAI_KEY || true; fi
  if [[ -z "$AEMET_KEY" ]]; then read -rp "AEMET_API_KEY (enter para dejar vacío): " AEMET_KEY || true; fi
  read -rp "Municipio ID AEMET [${AEMET_MUNICIPIO_ID}]: " _i || true; AEMET_MUNICIPIO_ID="${_i:-$AEMET_MUNICIPIO_ID}"
  read -rp "Municipio nombre [${AEMET_MUNICIPIO_NAME}]: " _n || true; AEMET_MUNICIPIO_NAME="${_n:-$AEMET_MUNICIPIO_NAME}"
  read -rp "Código postal [${AEMET_POSTAL_CODE}]: " _p || true; AEMET_POSTAL_CODE="${_p:-$AEMET_POSTAL_CODE}"
  read -rp "Provincia [${AEMET_PROVINCE}]: " _pr || true; AEMET_PROVINCE="${_pr:-$AEMET_PROVINCE}"
  read -rp "Ciudad (UI) [${CITY_NAME}]: " _c || true; CITY_NAME="${_c:-$CITY_NAME}"
fi

log "Instalando paquetes base…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y python3 python3-venv python3-pip nginx curl jq unzip ca-certificates espeak-ng network-manager

if [[ "$INSTALL_NODE" == "1" ]]; then
  if ! command -v node >/dev/null 2>&1; then
    log "Instalando Node LTS…"
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi
fi

log "Creando grupos/rutas y permisos…"
groupadd -f pantalla
mkdir -p "$ENV_DIR" "$ASSETS_DIR" "$LOG_DIR" /opt/dash/assets
chown -R "$APP_USER:$APP_USER" /opt/dash
chmod 755 /opt/dash /opt/dash/assets
touch "$LOG_DIR/bg.log"
chown "$APP_USER:$APP_USER" "$LOG_DIR/bg.log"
chmod 664 "$LOG_DIR/bg.log"
chgrp pantalla "$ENV_DIR" || true
chmod 750 "$ENV_DIR"
usermod -aG pantalla "$APP_USER" || true

log "Escribiendo $ENV_DIR/env …"
# normaliza formato: si se pasó clave sin prefijo, la convertimos
if [[ -n "${OPENAI_KEY:-}" ]]; then
  printf "OPENAI_API_KEY=%s\n" "$OPENAI_KEY" > "$ENV_DIR/env"
else
  # mantiene fichero (si existe) o crea vacío con comentario
  if [[ ! -f "$ENV_DIR/env" ]]; then echo "# OPENAI_API_KEY=" > "$ENV_DIR/env"; fi
fi
chgrp pantalla "$ENV_DIR/env"
chmod 640 "$ENV_DIR/env"

log "Escribiendo $ENV_DIR/config.json …"
cat > "$ENV_DIR/config.json" <<JSON
{
  "aemet": {
    "apiKey": "${AEMET_KEY:-AEMET_API_KEY_PLACEHOLDER}",
    "municipioId": "${AEMET_MUNICIPIO_ID}",
    "municipioName": "${AEMET_MUNICIPIO_NAME}",
    "postalCode": "${AEMET_POSTAL_CODE}",
    "province": "${AEMET_PROVINCE}"
  },
  "weather": { "units": "metric", "city": "${CITY_NAME}" },
  "storm": { "threshold": 0.6, "enableExperimentalLightning": false },
  "wifi": { "preferredInterface": "wlan0" },
  "background": { "intervalMinutes": 60, "mode": "auto", "retainDays": 7 },
  "locale": { "country": "ES", "autonomousCommunity": "Comunitat Valenciana", "province": "Castellón", "city": "${CITY_NAME}" }
}
JSON
chgrp pantalla "$ENV_DIR/config.json"
chmod 640 "$ENV_DIR/config.json"

log "Preparando backend (venv + deps)…"
cd "$BACKEND_DIR"
sudo -u "$APP_USER" bash -lc "python3 -m venv .venv"
sudo -u "$APP_USER" bash -lc "source .venv/bin/activate && pip install -U pip && pip install fastapi uvicorn httpx pydantic requests python-dateutil Jinja2 openai pillow"

log "Servicio backend templated…"
# migra posible unidad antigua
if [[ -f "$SYSTEMD_DIR/${BACKEND_SVC_BASENAME}.service" ]]; then
  mv "$SYSTEMD_DIR/${BACKEND_SVC_BASENAME}.service" "$SYSTEMD_DIR/${BACKEND_SVC_TEMPLATE}"
fi
cat > "$SYSTEMD_DIR/${BACKEND_SVC_TEMPLATE}" <<'SERVICE'
[Unit]
Description=Pantalla Dash Backend (FastAPI)
After=network-online.target
Wants=network-online.target

[Service]
User=%i
SupplementaryGroups=pantalla
WorkingDirectory=%h/proyectos/Pantalla_reloj/backend
Environment="PYTHONUNBUFFERED=1"
ExecStart=/bin/bash -lc 'source .venv/bin/activate && uvicorn app:app --host 127.0.0.1 --port 8787 --workers 2 --timeout-keep-alive 30'
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable --now "${BACKEND_SVC_BASENAME}@$APP_USER" || true

# --- Hardening del generador IA: corrige parámetros del script ---
GEN_SCRIPT="$REPO_DIR/opt/dash/scripts/generate_bg_daily.py"
if [[ -f "$GEN_SCRIPT" ]]; then
  log "Revisando/parcheando $GEN_SCRIPT (response_format / size)…"
  sed -i -E 's/,?\s*response_format\s*=\s*["'\''][^"'\'']*["'\'']//g' "$GEN_SCRIPT" || true
  sed -i -E 's/size\s*=\s*["'\''][^"'\'']*["'\'']/size="1536x1024"/g' "$GEN_SCRIPT" || true
fi

# ----- Frontend -----
if [[ -f "$FRONTEND_DIR/package.json" ]]; then
  log "Construyendo frontend…"
  cd "$FRONTEND_DIR"
  if [[ -f package-lock.json ]]; then
    sudo -u "$APP_USER" bash -lc "npm ci"
  else
    warn "No hay package-lock.json, usando npm install"
    sudo -u "$APP_USER" bash -lc "npm install"
  fi
  sudo -u "$APP_USER" bash -lc "npm run build"
  rm -rf /var/www/html/*
  cp -r dist/* /var/www/html/
else
  warn "dash-ui no encontrado; saltando build"
fi

log "Configurando Nginx…"
cat > "$NGINX_SITE" <<'NGINX'
server {
  listen 80 default_server;
  server_name _;
  root /var/www/html;
  index index.html;

  location /api/ {
    proxy_pass http://127.0.0.1:8787/;
    proxy_set_header Host $host;
  }

  location /assets/ {
    alias /opt/dash/assets/;
    access_log off;
    expires 7d;
  }

  location = /healthz {
    default_type text/plain;
    return 200 'ok';
  }
}
NGINX
ln -sf "$NGINX_SITE" /etc/nginx/sites-enabled/pantalla
rm -f /etc/nginx/sites-enabled/default || true
nginx -t && systemctl restart nginx

# ----- Servicio fondos IA -----
log "Instalando servicio y timer de fondos IA…"
cat > "$SYSTEMD_DIR/$BG_SVC" <<SERVICE
[Unit]
Description=Pantalla Dash · Generar fondo IA
After=network-online.target

[Service]
Type=simple
EnvironmentFile=$ENV_DIR/env
User=$APP_USER
SupplementaryGroups=pantalla
WorkingDirectory=$REPO_DIR
ExecStart=$BACKEND_DIR/.venv/bin/python $GEN_SCRIPT
StandardOutput=append:$LOG_DIR/bg.log
StandardError=append:$LOG_DIR/bg.log

[Install]
WantedBy=multi-user.target
SERVICE

cat > "$SYSTEMD_DIR/$BG_TIMER" <<'TIMER'
[Unit]
Description=Timer fondos IA
[Timer]
OnBootSec=30s
OnCalendar=*-*-* 07:00:00
OnCalendar=*-*-* 12:00:00
OnCalendar=*-*-* 19:00:00
Persistent=true
AccuracySec=1min
RandomizedDelaySec=120
Unit=pantalla-bg-generate.service
[Install]
WantedBy=timers.target
TIMER

systemctl daemon-reload
systemctl enable --now "$BG_TIMER"

# ----- Checks finales -----
echo
log "Checks finales:"
set +e
curl -fsS http://127.0.0.1:8787/api/health >/dev/null && echo "  ✅ Backend UP" || echo "  ❌ Backend DOWN (ver: journalctl -u ${BACKEND_SVC_BASENAME}@$APP_USER -n 100)"
curl -fsS http://127.0.0.1/healthz        >/dev/null && echo "  ✅ Nginx UP"   || echo "  ❌ Nginx DOWN (ver: journalctl -u nginx -n 100)"
set -e

# genera primer fondo si hay clave
if grep -qE '^OPENAI_API_KEY=.+$' "$ENV_DIR/env"; then
  log "Generando primer fondo IA…"
  systemctl start "$BG_SVC" || true
  sleep 2
  if ls -1 "$ASSETS_DIR"/*.webp >/dev/null 2>&1; then
    echo "  ✅ Fondo IA generado en $ASSETS_DIR"
  else
    echo "  ℹ️  Aún no se ve .webp; revisa log: tail -n 120 $LOG_DIR/bg.log"
  fi
else
  warn "OPENAI_API_KEY no configurada. Saltando generación inicial de fondo."
fi

echo
log "Instalación completada."
echo "  UI:       http://localhost/"
echo "  Backend:  http://127.0.0.1:8787"
echo "  Config:   $ENV_DIR/config.json (root:pantalla 640)"
echo "  Secretos: $ENV_DIR/env (root:pantalla 640)"
echo "  Fondos:   $ASSETS_DIR"

