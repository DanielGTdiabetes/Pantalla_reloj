#!/usr/bin/env bash
set -euo pipefail

SERVICES=(
  pantalla-openbox@dani.service
  pantalla-dash-backend@dani.service
  pantalla-xorg.service
)

for svc in "${SERVICES[@]}"; do
  systemctl disable --now "$svc" 2>/dev/null || true
  rm -f "/etc/systemd/system/${svc}"
done

rm -f /etc/systemd/system/pantalla-openbox@.service
rm -f /etc/systemd/system/pantalla-dash-backend@.service
rm -f /etc/systemd/system/pantalla-xorg.service
systemctl daemon-reload
systemctl reset-failed || true

rm -f /etc/nginx/sites-enabled/pantalla-reloj.conf
rm -f /etc/nginx/sites-available/pantalla-reloj.conf
systemctl reload nginx 2>/dev/null || true

if [[ -L /usr/local/bin/firefox ]] && readlink /usr/local/bin/firefox | grep -q "/opt/firefox"; then
  rm -f /usr/local/bin/firefox
fi

rm -rf /opt/pantalla
rm -rf /opt/firefox
rm -rf /var/log/pantalla
if [[ -d /var/www/html ]]; then
  rm -rf /var/www/html/*
fi

AUTO_FILE="/home/dani/.config/openbox/autostart"
if [[ -f "$AUTO_FILE" ]] && grep -q "Pantalla_reloj" "$AUTO_FILE"; then
  rm -f "$AUTO_FILE"
fi

systemctl unmask display-manager.service 2>/dev/null || true

echo "[OK] Pantalla_reloj desinstalado completamente."
