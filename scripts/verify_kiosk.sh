#!/usr/bin/env bash
set -euo pipefail

USER_NAME="${1:-dani}"
export DISPLAY=:0
export XAUTHORITY="/home/${USER_NAME}/.Xauthority"

echo "== XRANDR =="
xrandr --query | sed -n '1,8p' || true

echo ""
echo "== Ventanas (wmctrl) =="
if wmctrl -lx 2>/dev/null | grep -qi 'google-chrome'; then
  echo "OK: Ventana Chrome kiosk detectada"
  exit 0
fi

echo "WARN: No se detecta ventana Chrome. Intento relanzar unit…"
systemctl --user restart "pantalla-kiosk-chrome@${USER_NAME}.service" 2>/dev/null || true
sleep 3

if wmctrl -lx 2>/dev/null | grep -qi 'google-chrome'; then
  echo "OK: Ventana Chrome kiosk tras relanzar"
  exit 0
else
  echo "FAIL: Sigue sin ventana Chrome"
  exit 1
fi
