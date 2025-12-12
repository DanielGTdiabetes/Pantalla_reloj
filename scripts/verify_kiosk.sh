#!/usr/bin/env bash
set -euo pipefail

USER_NAME="${1:-dani}"
DISPLAY=":0"
XAUTHORITY="/home/${USER_NAME}/.Xauthority"
HEALTH_URL="http://127.0.0.1:8081/api/health"
PROFILE_DIR="/var/lib/pantalla-reloj/state/chromium-kiosk"

status_ok=1

timestamp() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log() { local level="$1"; shift; printf '[%s] [%s] %s\n' "$(timestamp)" "$level" "$*"; }
log_info() { log INFO "$@"; }
log_warn() { log WARN "$@"; }
log_fail() { log FAIL "$@"; status_ok=0; }
section() { printf '\n== %s ==\n' "$*"; }

list_locks() {
  local dir="$1"
  local -a locks=(SingletonLock SingletonCookie SingletonSocket)
  local existing=()
  local lock
  for lock in "${locks[@]}"; do
    if [[ -e "${dir}/${lock}" ]]; then
      existing+=("${dir}/${lock}")
    fi
  done
  printf '%s\n' "${existing[@]:-}"
}

section "Estado de servicios"
services=(
  pantalla-xorg.service
  "pantalla-openbox@${USER_NAME}.service"
  "pantalla-dash-backend@${USER_NAME}.service"
  "pantalla-kiosk-chrome@${USER_NAME}.service"
)
for svc in "${services[@]}"; do
  if systemctl is-active --quiet "$svc"; then
    log_info "[OK] ${svc} activo"
  else
    log_fail "${svc} no está activo"
  fi
done

section "Últimos logs de pantalla-kiosk-chrome@${USER_NAME}.service"
if ! journalctl -u pantalla-kiosk-chrome@"${USER_NAME}".service -n 120 --no-pager; then
  log_warn "No se pudieron obtener logs"
fi

section "Verificación de DISPLAY"
CHECK_CMD="xdpyinfo -display ${DISPLAY}"
if ! command -v xdpyinfo >/dev/null 2>&1; then
  CHECK_CMD="xset q"
fi
if DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" bash -c "$CHECK_CMD" >/dev/null 2>&1; then
  log_info "[OK] X responde con ${CHECK_CMD}"
else
  log_fail "X no respondió con ${CHECK_CMD}"
fi

section "Health del backend"
if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
  log_info "[OK] Backend responde en ${HEALTH_URL}"
else
  log_fail "Backend no responde en ${HEALTH_URL}"
fi

section "Proceso de Chrome"
if pgrep -u "$USER_NAME" -f "chrome.*--user-data-dir=${PROFILE_DIR}" >/dev/null 2>&1; then
  log_info "[OK] Chrome kiosk en ejecución con perfil ${PROFILE_DIR}"
else
  log_warn "Chrome kiosk no se detecta (puede estar arrancando)"
fi

section "Locks del perfil kiosk"
if [[ -d "$PROFILE_DIR" ]]; then
  mapfile -t locks < <(list_locks "$PROFILE_DIR") || true
  if [[ ${#locks[@]} -eq 0 ]]; then
    log_info "[OK] Sin locks Singleton en ${PROFILE_DIR}"
  else
    if pgrep -u "$USER_NAME" -f "chrome.*--user-data-dir=${PROFILE_DIR}" >/dev/null 2>&1; then
      log_info "Locks presentes pero Chrome está en ejecución: ${locks[*]}"
    else
      log_fail "Locks huérfanos detectados en ${PROFILE_DIR}: ${locks[*]}"
    fi
  fi
else
  log_fail "El perfil ${PROFILE_DIR} no existe"
fi

section "chrome_debug.log"
for candidate in "${PROFILE_DIR}/chrome_debug.log" \
  "/home/${USER_NAME}/.config/google-chrome/chrome_debug.log"; do
  if [[ -f "$candidate" ]]; then
    log_info "Mostrando últimas 40 líneas de ${candidate}:"
    tail -n 40 "$candidate"
    break
  fi
done

if [[ $status_ok -eq 1 ]]; then
  log_info "\nRESULTADO: OK"
  exit 0
else
  log_fail "\nRESULTADO: FAIL"
  exit 1
fi
