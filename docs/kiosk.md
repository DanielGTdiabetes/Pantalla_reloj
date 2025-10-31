# Pantalla_reloj kiosk mode

## Configuración de video

La rotación y el modo preferido del panel HDMI quedan fijados desde Xorg. El archivo [`xorg/10-monitor.conf`](../xorg/10-monitor.conf) declara el monitor `HDMI-1` con el modo `480x1920`, rotación a la izquierda y un framebuffer virtual de `1920x1920` para evitar ajustes dinámicos vía `xrandr` en tiempo de ejecución.

Con esta configuración, al iniciar `pantalla-xorg.service` se obtiene un arranque determinista y sin parpadeos. El uso de `xrandr` queda reservado únicamente para diagnóstico manual.

## Autenticación X11

Chromium se ejecuta desde el usuario normal y necesita la cookie real de Xauthority. Asegúrate de que `~/.Xauthority` exista y sea un archivo regular (`-rw-------`) perteneciente a `dani:dani`. El servicio de Xorg ya se inicia con `-auth /home/dani/.Xauthority`, por lo que no es necesario crear enlaces simbólicos en `/var/lib`.

## Arranque determinista (X11 + navegador kiosk)

### Requisitos

* `~/.Xauthority` debe ser un archivo normal (no un enlace simbólico), con permisos `-rw-------` y perteneciente a `dani:dani`.
* `pantalla-kiosk@dani.service` fija `DISPLAY=:0`, `XAUTHORITY=/home/dani/.Xauthority`, `GDK_BACKEND=x11`, `GTK_USE_PORTAL=0`, `GIO_USE_PORTALS=0` y `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/<UID>/bus` consumiendo `/var/lib/pantalla-reloj/state/kiosk.env`.

### Pasos de verificación

1. `journalctl -u pantalla-dash-backend@dani -n 50` → debe mostrar `Uvicorn running on http://127.0.0.1:8081` y responder `GET /api/health -> 200`.
2. `systemctl status pantalla-kiosk@dani` → estado `active (running)` sin mensajes de “Authorization required”, “Failed to connect to the bus” ni “Missing X server or $DISPLAY”.
3. `DISPLAY=:0 XAUTHORITY=/home/dani/.Xauthority wmctrl -lx` → debe listar una ventana del navegador con clase `pantalla-kiosk`.

### Solución de problemas rápida

* Mensajes “not a clean path” o “Authorization required”: recrea `~/.Xauthority` copiando `/var/lib/pantalla-reloj/.Xauthority` (`install -m 600 -o dani -g dani /var/lib/pantalla-reloj/.Xauthority /home/dani/.Xauthority`).
* Backend sin iniciar: confirma que `pantalla-backend-launch` exporta `PYTHONPATH="/opt/pantalla-reloj"` y que Uvicorn apunta a `backend.main:app`.
* Navegador sin ventana: revisa `/var/log/pantalla/browser-kiosk.log`, confirma que `kiosk.env` tenga rutas válidas y valida con `systemctl show pantalla-kiosk@dani -p Environment` que `DISPLAY`, `XAUTHORITY` y `DBUS_SESSION_BUS_ADDRESS` estén definidos.

El watchdog (`pantalla-kiosk-watchdog@.timer`) permanece deshabilitado por defecto. Si se requiere, actívalo manualmente con:

```bash
sudo systemctl enable --now pantalla-kiosk-watchdog@dani.timer
```

## Servicios systemd relevantes

```bash
sudo systemctl enable --now pantalla-xorg.service
sudo systemctl enable --now pantalla-openbox@dani.service
sudo systemctl enable --now pantalla-kiosk@dani.service
```

`pantalla-kiosk@.service` invoca `/usr/local/bin/pantalla-kiosk`, que prioriza Chromium y recurre a Firefox si no hay binario Chromium disponible. El perfil persistente vive en `/var/lib/pantalla-reloj/state/chromium-kiosk`. Cada arranque deja un log temporal en `/tmp/pantalla-chromium.XXXXXX.log` y replica la salida en `/var/log/pantalla/browser-kiosk.log` (rotado a ~4000 líneas en cada arranque). Para habilitar los mensajes verbosos (`--v=1`) exporta `PANTALLA_CHROMIUM_VERBOSE=1` antes de reiniciar el servicio.

Las variables `KIOSK_URL`, `CHROME_BIN_OVERRIDE`, `FIREFOX_BIN_OVERRIDE`, `CHROMIUM_PROFILE_DIR` y `FIREFOX_PROFILE_DIR` se definen en `/var/lib/pantalla-reloj/state/kiosk.env`. Tras cualquier cambio reinicia el servicio con `sudo systemctl restart pantalla-kiosk@dani`.

### Evitar ventanas duplicadas

Openbox no lanza navegadores automáticamente y el servicio de kiosk elimina instancias previas por clase de ventana (`wmctrl -lx`). Si aparece una ventana blanca o se percibe una "doble pantalla", verifica que sólo exista una ventana con clase `pantalla-kiosk`:

```bash
wmctrl -lx | grep pantalla-kiosk
```

Si hay más de una, ciérralas con `wmctrl -ic <ID>` y revisa que no existan otros lanzadores activos. Un `wmctrl -lx` limpio no debe listar entradas `chrome.chromium` ni `chromium-browser.Chromium-browser`; si aparecen indica que quedó la ventana 10×10 residual.

Para comprobar que el proceso usa ANGLE (EGL) ejecuta:

```bash
pgrep -af -- '--class=pantalla-kiosk'
```

Debe aparecer `--use-gl=egl-angle` en la línea de comandos. Si falta, reinicia el servicio y revisa los logs del kiosk.

### Troubleshooting de video

* `DISPLAY=:0 xrandr --query` debe mostrar la resolución actual `1920 x 480` y el modo `480x1920` asociado a `HDMI-1` con rotación izquierda. Si no aparece, revisa [`xorg/10-monitor.conf`](../xorg/10-monitor.conf).
* Asegúrate de que `wmctrl -lx` sólo liste una ventana con clase `pantalla-kiosk`.

### SwiftShader opcional

Chromium se lanza con ANGLE (EGL) y bloquea el fallback software. Si el hardware no soporta WebGL, habilita temporalmente SwiftShader con:

```bash
PANTALLA_ALLOW_SWIFTSHADER=1 sudo systemctl restart pantalla-kiosk@dani
```

El script intentará de nuevo con `--enable-unsafe-swiftshader` sólo cuando el arranque estándar falle; el valor por defecto (sin variable) mantiene el modo seguro.

## Servicios opcionales

El wrapper legado `pantalla-kiosk-chromium@.service` permanece disponible para escenarios que aún dependan de la configuración anterior. También `pantalla-portal@.service` continúa deshabilitado por defecto para evitar ventanas auxiliares; habilítalo manualmente sólo si es necesario.
