#!/usr/bin/env bash
set -euo pipefail

MAX_WAIT_BACKEND=60
SLEEP=2
BACKEND_URL="http://127.0.0.1:8081/api/health"
NGINX_LOCAL_HEALTH="http://127.0.0.1/api/health"
NGINX_LOCAL_CONFIG="http://127.0.0.1/api/config"

log() { printf '%s\n' "$*"; }
log_warn() { printf '[verify][WARN] %s\n' "$*"; }
log_error() { printf '[verify][ERROR] %s\n' "$*" >&2; }

SUDO_BIN="sudo"
if [[ ${EUID:-$(id -u)} -eq 0 ]]; then
  SUDO_BIN=""
fi

BACKEND_USER="${USERNAME:-${SUDO_USER:-${USER:-}}}"
if [[ -n "${BACKEND_USER}" ]]; then
  if ! id "$BACKEND_USER" >/dev/null 2>&1; then
    log_warn "Usuario '$BACKEND_USER' no encontrado; se omite diagnostico systemctl"
    BACKEND_USER=""
  fi
else
  log_warn "No se pudo determinar el usuario objetivo; se omite diagnostico systemctl"
fi

if [[ -n "$BACKEND_USER" ]]; then
  BACKEND_SERVICE_UNIT="pantalla-dash-backend@${BACKEND_USER}.service"
else
  BACKEND_SERVICE_UNIT=""
fi

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log_error "Comando requerido no encontrado: $1"
    exit 1
  fi
}

require_cmd curl
require_cmd nginx

run_nginx() {
  if [[ -n "$SUDO_BIN" ]]; then
    $SUDO_BIN "$@"
  else
    "$@"
  fi
}

show_nginx_api_block() {
  log "[verify] Bloque nginx server_name _; location /api actual"
  local tmp_file
  tmp_file="$(mktemp)"
  if run_nginx nginx -T >"$tmp_file" 2>/dev/null; then
    sed -n '/server_name _;/,/}/p' "$tmp_file" | sed -n '/location \/api/,/}/p'
  else
    log_warn "No se pudo obtener el bloque nginx -T"
  fi
  rm -f "$tmp_file"
  log "[verify] Regla esperada: location /api { proxy_pass http://127.0.0.1:8081; }"
}

wait_for_backend() {
  log "[verify] Esperando backend en ${BACKEND_URL} (timeout ${MAX_WAIT_BACKEND}s)"
  local waited=0
  until curl -sfS "$BACKEND_URL" >/dev/null; do
    if (( waited >= MAX_WAIT_BACKEND )); then
      log_error "Backend no responde en 127.0.0.1:8081 tras ${MAX_WAIT_BACKEND}s"
      if [[ -n "$BACKEND_SERVICE_UNIT" ]]; then
        systemctl --no-pager -l status "$BACKEND_SERVICE_UNIT" | sed -n '1,60p' || true
      fi
      exit 1
    fi
    sleep "$SLEEP"
    waited=$((waited + SLEEP))
  done
  log "[verify] Backend OK en 127.0.0.1:8081"
}

handle_nginx_failure() {
  local status="$1"
  local label="$2"
  local url="$3"
  local headers_file="$4"

  if [[ -s "$headers_file" ]]; then
    printf '%s\n' "[verify] Cabeceras de respuesta para ${url}:"
    cat "$headers_file"
  fi

  case "$status" in
    502)
      log_error "${label} devolvió 502 Bad Gateway"
      show_nginx_api_block
      rm -f "$headers_file"
      exit 1
      ;;
    404)
      log_error "${label} devolvió 404 (revisa la ruta /api en nginx)"
      rm -f "$headers_file"
      exit 1
      ;;
    "")
      log_error "${label} falló (curl error al acceder a ${url})"
      rm -f "$headers_file"
      exit 1
      ;;
    *)
      log_error "${label} devolvió HTTP ${status}"
      rm -f "$headers_file"
      exit 1
      ;;
  esac
}

check_nginx_endpoint() {
  local url="$1"
  local label="$2"
  log "[verify] Probando ${label} (${url})"

  local headers_file
  headers_file="$(mktemp)"

  set +e
  curl -sS -D "$headers_file" -o /dev/null -f "$url"
  local curl_status=$?
  set -e

  local status
  status="$(awk 'NR==1 {print $2}' "$headers_file" 2>/dev/null || true)"

  if (( curl_status != 0 )) || [[ "$status" != "200" ]]; then
    handle_nginx_failure "$status" "$label" "$url" "$headers_file"
  fi

  rm -f "$headers_file"
  log "[verify] ${label} OK"
}

log "[verify] nginx -t"
set +e
if ! run_nginx nginx -t; then
  log_warn "nginx -t reportó errores"
fi
set -e

wait_for_backend

check_nginx_endpoint "$NGINX_LOCAL_HEALTH" "Nginx localhost /api/health"
check_nginx_endpoint "$NGINX_LOCAL_CONFIG" "Nginx localhost /api/config"

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [[ -n "${LAN_IP// }" ]]; then
  check_nginx_endpoint "http://${LAN_IP}/api/health" "Nginx LAN ${LAN_IP} /api/health"
  check_nginx_endpoint "http://${LAN_IP}/api/config" "Nginx LAN ${LAN_IP} /api/config"
fi

log "[verify] ✅ /api operativo vía Nginx"
