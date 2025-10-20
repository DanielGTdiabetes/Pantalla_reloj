# Rotación automática para pantalla 8.8" (1920×480)

- El instalador configura LightDM (autologin) + Openbox y crea `~/.config/openbox/autostart`.
- Si la salida conectada reporta `480x1920`, al iniciar sesión se aplica `xrandr --rotate left` y queda horizontal (1920×480).
- Si la imagen aparece invertida, cambia `left` por `right` en `~/.config/openbox/autostart`.
- Para ocultar el cursor en modo kiosko, edita el autostart y descomenta `unclutter -idle 0.5 &`.
- Si no usas `pantalla-kiosk.service`, puedes lanzar Chromium en el autostart (línea comentada).
