#!/usr/bin/env bash
set -euo pipefail

log_info() { printf '[verify] %s\n' "$*"; }
log_error() { printf '[verify][ERROR] %s\n' "$*" >&2; }

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log_error "Comando requerido no encontrado: $1"
    exit 1
  fi
}

require_cmd curl
require_cmd jq
require_cmd nginx

RUN_USER="${1:-${VERIFY_USER:-${SUDO_USER:-${USER:-}}}}"
if [[ -z "${RUN_USER:-}" ]]; then
  log_error "No se pudo determinar el usuario del servicio"
  exit 1
fi

BACKEND_UNIT="pantalla-dash-backend@${RUN_USER}.service"

diagnose_failure() {
  local url="$1"
  log_error "Fallo al verificar ${url}; generando diagnóstico"
  if ! nginx -T 2>&1 | sed -n '1,220p'; then
    log_error "No se pudo ejecutar nginx -T"
  fi
  if command -v journalctl >/dev/null 2>&1; then
    journalctl -u "$BACKEND_UNIT" -n 120 --no-pager || true
  fi
}

check_health() {
  local url="$1"
  local response
  if ! response=$(curl -sfS "$url"); then
    diagnose_failure "$url"
    exit 1
  fi
  if ! jq -e '.status=="ok"' <<<"$response" >/dev/null; then
    log_error "Respuesta inesperada en ${url}: ${response}"
    diagnose_failure "$url"
    exit 1
  fi
  log_info "OK ${url}"
}

check_health "http://127.0.0.1:8081/api/health"
check_health "http://127.0.0.1/api/health"

log_info "Verificaciones de API completadas"
