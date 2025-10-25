#!/usr/bin/env bash
set -euxo pipefail

systemctl stop pantalla-* || true
systemctl disable pantalla-* || true
rm -f /etc/systemd/system/pantalla-* /etc/nginx/sites-available/pantalla-reloj.conf /etc/nginx/sites-enabled/pantalla-reloj.conf
rm -rf /opt/pantalla /var/log/pantalla /var/www/html
if [ -L /usr/local/bin/firefox ] && readlink /usr/local/bin/firefox | grep -q "/opt/firefox"; then
  rm -f /usr/local/bin/firefox
fi
rm -rf /opt/firefox
systemctl daemon-reload
systemctl reset-failed || true
systemctl reload nginx || true
echo "[OK] Pantalla_reloj desinstalado completamente."
