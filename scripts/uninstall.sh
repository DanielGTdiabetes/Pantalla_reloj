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
  rm -f "/etc/systemd/system/graphical.target.wants/${svc}"
  rm -f "/etc/systemd/system/multi-user.target.wants/${svc}"
done

rm -f /etc/systemd/system/pantalla-openbox@.service
rm -f /etc/systemd/system/pantalla-dash-backend@.service
rm -f /etc/systemd/system/pantalla-xorg.service
systemctl daemon-reload
systemctl reset-failed || true

PR_STATE_DIR=/var/lib/pantalla-reloj
PR_STATE_STATE_DIR="$PR_STATE_DIR/state"
DISPLAY_MANAGER_MARK="$PR_STATE_STATE_DIR/display-manager.masked"

if [[ -f "$DISPLAY_MANAGER_MARK" ]]; then
  systemctl unmask display-manager.service 2>/dev/null || true
  rm -f "$DISPLAY_MANAGER_MARK"
fi

rm -f /etc/nginx/sites-enabled/pantalla-reloj.conf
rm -f /etc/nginx/sites-available/pantalla-reloj.conf
systemctl reload nginx 2>/dev/null || true

if [[ -L /usr/local/bin/firefox ]] && readlink /usr/local/bin/firefox | grep -q "/opt/firefox"; then
  rm -f /usr/local/bin/firefox
fi

rm -rf /opt/pantalla
rm -rf /opt/firefox
rm -rf /var/lib/pantalla
rm -rf /var/log/pantalla
rm -rf "$PR_STATE_DIR"
if [[ -d /var/www/html ]]; then
  rm -rf /var/www/html/*
else
  mkdir -p /var/www/html
fi

if [[ -f /usr/share/nginx/html/index.html ]]; then
  cp /usr/share/nginx/html/index.html /var/www/html/index.html
else
  cat <<'HTML' >/var/www/html/index.html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>Nginx</title>
  </head>
  <body>
    <h1>Servidor Nginx listo</h1>
    <p>Contenido restaurado por pantalla_reloj/uninstall.sh.</p>
  </body>
</html>
HTML
fi
chown -R www-data:www-data /var/www/html 2>/dev/null || true

AUTO_FILE="/home/dani/.config/openbox/autostart"
if [[ -f "$AUTO_FILE" ]] && grep -q "Pantalla_reloj" "$AUTO_FILE"; then
  rm -f "$AUTO_FILE"
fi

echo "[OK] Pantalla_reloj desinstalado completamente."
