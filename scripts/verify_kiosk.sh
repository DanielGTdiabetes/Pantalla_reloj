#!/usr/bin/env bash
set -euo pipefail

USER_NAME="${1:-dani}"
DISPLAY=":0"
XAUTHORITY="/home/${USER_NAME}/.Xauthority"
HEALTH_URL="http://127.0.0.1:8081/api/health"

status_ok=1

log() { printf '%s\n' "$*"; }
section() { printf '\n== %s ==\n' "$*"; }

section "Estado de servicios"
services=(
  pantalla-xorg.service
  "pantalla-openbox@${USER_NAME}.service"
  "pantalla-dash-backend@${USER_NAME}.service"
  "pantalla-kiosk-chrome@${USER_NAME}.service"
)
for svc in "${services[@]}"; do
  if systemctl is-active --quiet "$svc"; then
    log "[OK] ${svc} activo"
  else
    log "[FAIL] ${svc} no está activo"
    status_ok=0
  fi
done

section "Últimos logs de pantalla-kiosk-chrome@${USER_NAME}.service"
if ! journalctl -u pantalla-kiosk-chrome@"${USER_NAME}".service -n 120 --no-pager; then
  log "[FAIL] No se pudieron obtener logs"
  status_ok=0
fi

section "Verificación de DISPLAY"
CHECK_CMD="xdpyinfo -display ${DISPLAY}"
if ! command -v xdpyinfo >/dev/null 2>&1; then
  CHECK_CMD="xset q"
fi
if DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" bash -c "$CHECK_CMD" >/dev/null 2>&1; then
  log "[OK] X responde con ${CHECK_CMD}"
else
  log "[FAIL] X no respondió con ${CHECK_CMD}"
  status_ok=0
fi

section "Health del backend"
if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
  log "[OK] Backend responde en ${HEALTH_URL}"
else
  log "[FAIL] Backend no responde en ${HEALTH_URL}"
  status_ok=0
fi

section "Proceso de Chrome"
if pgrep -u "$USER_NAME" -f "chrome.*--class=pantalla-kiosk" >/dev/null 2>&1; then
  log "[OK] Chrome kiosk en ejecución"
else
  log "[WARN] Chrome kiosk no se detecta (puede estar arrancando)"
fi

if [[ $status_ok -eq 1 ]]; then
  log "\nRESULTADO: OK"
  exit 0
else
  log "\nRESULTADO: FAIL"
  exit 1
fi
