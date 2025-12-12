#!/usr/bin/env bash
set -uo pipefail

USER_NAME="${1:-dani}"
export DISPLAY=:0
export XAUTHORITY="/home/${USER_NAME}/.Xauthority"

STATUS_UNITS=(
  pantalla-xorg.service
  "pantalla-openbox@${USER_NAME}.service"
  "pantalla-kiosk-chrome@${USER_NAME}.service"
)

failures=0

log_section() {
  printf '\n== %s ==\n' "$1"
}

log_section "Estado de servicios"
systemctl status "${STATUS_UNITS[@]}" --no-pager || true

log_section "Últimos logs de pantalla-kiosk-chrome@${USER_NAME}.service"
journalctl -u "pantalla-kiosk-chrome@${USER_NAME}.service" -n 80 --no-pager || true

log_section "Chequeo de display (xdpyinfo/xset)"
if command -v xdpyinfo >/dev/null 2>&1; then
  if ! xdpyinfo >/dev/null 2>&1; then
    echo "Display NO responde (xdpyinfo)"
    failures=1
  else
    echo "Display OK (xdpyinfo)"
  fi
else
  if ! xset q >/dev/null 2>&1; then
    echo "Display NO responde (xset)"
    failures=1
  else
    echo "Display OK (xset)"
  fi
fi

log_section "Chequeo backend /api/health"
if curl -sf http://127.0.0.1:8081/api/health >/dev/null; then
  echo "Backend OK"
else
  echo "Backend NO responde"
  failures=1
fi

echo ""
if [[ $failures -ne 0 ]]; then
  echo "Resultado: verificaciones con errores (${failures})"
else
  echo "Resultado: verificaciones OK"
fi

exit "$failures"
