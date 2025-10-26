# Pantalla_reloj kiosk mode

## Configuración de video

La rotación y el modo preferido del panel HDMI quedan fijados desde Xorg. El archivo [`xorg/10-monitor.conf`](../xorg/10-monitor.conf) declara el monitor `HDMI-1` con el modo `480x1920`, rotación a la izquierda y un framebuffer virtual de `1920x1920` para evitar ajustes dinámicos vía `xrandr` en tiempo de ejecución.

Con esta configuración, al iniciar `pantalla-xorg.service` se obtiene un arranque determinista y sin parpadeos. El uso de `xrandr` queda reservado únicamente para diagnóstico manual.

## Autenticación X11

Chromium se ejecuta desde el usuario normal y necesita la cookie real de Xauthority. Asegúrate de que `~/.Xauthority` exista y sea un archivo regular (`-rw-------`) perteneciente a `dani:dani`. El servicio de Xorg ya se inicia con `-auth /home/dani/.Xauthority`, por lo que no es necesario crear enlaces simbólicos en `/var/lib`.

## Arranque determinista (X11 + Chromium)

### Requisitos

* `~/.Xauthority` debe ser un archivo normal (no un enlace simbólico), con permisos `-rw-------` y perteneciente a `dani:dani`.
* El drop-in [`override.conf`](../systemd/pantalla-kiosk-chromium@dani.service.d/override.conf) fija `DISPLAY=:0` y `XAUTHORITY=/home/dani/.Xauthority` para `pantalla-kiosk-chromium@dani.service`.

### Pasos de verificación

1. `journalctl -u pantalla-dash-backend@dani -n 50` → debe mostrar `Uvicorn running on http://127.0.0.1:8081` y responder `GET /api/health -> 200`.
2. `systemctl status pantalla-kiosk-chromium@dani` → estado `active (running)` sin mensajes de “Authorization required” ni “Missing X server or $DISPLAY”.
3. `DISPLAY=:0 XAUTHORITY=/home/dani/.Xauthority wmctrl -lx` → debe listar una ventana Chromium con clase `pantalla-kiosk`.

### Solución de problemas rápida

* Mensajes “not a clean path” o “Authorization required”: recrea `~/.Xauthority` copiando `/var/lib/pantalla-reloj/.Xauthority` (`install -m 600 -o dani -g dani /var/lib/pantalla-reloj/.Xauthority /home/dani/.Xauthority`).
* Backend sin iniciar: confirma que `pantalla-backend-launch` exporta `PYTHONPATH="/opt/pantalla-reloj"` y que Uvicorn apunta a `backend.main:app`.
* Chromium sin ventana: valida que el drop-in aplique y que `DISPLAY`/`XAUTHORITY` correspondan al usuario.

El watchdog (`pantalla-kiosk-watchdog@.timer`) permanece deshabilitado por defecto. Si se requiere, actívalo manualmente con:

```bash
sudo systemctl enable --now pantalla-kiosk-watchdog@dani.timer
```

## Servicios systemd relevantes

```bash
sudo systemctl enable --now pantalla-xorg.service
sudo systemctl enable --now pantalla-openbox@dani.service
sudo systemctl enable --now pantalla-kiosk-chromium@dani.service
```

El servicio [`pantalla-kiosk-chromium@.service`](../systemd/pantalla-kiosk-chromium@.service) ejecuta Chromium en modo kiosk con la clase de ventana `pantalla-kiosk`, sin ventanas emergentes de error y con la plataforma X11 forzada (`--ozone-platform=x11 --disable-gpu`).

### Escala de la interfaz

La escala de Chromium se controla mediante la variable de entorno `CHROMIUM_SCALE` que por defecto vale `0.84`. Para ajustarla sin editar la unidad:

```bash
sudo systemctl set-environment CHROMIUM_SCALE=0.86
sudo systemctl restart pantalla-kiosk-chromium@dani.service
```

### Evitar ventanas duplicadas

Openbox no lanza navegadores automáticamente y el servicio de kiosk elimina instancias previas por clase de ventana (`wmctrl -lx`). Si aparece una ventana blanca o se percibe una "doble pantalla", verifica que sólo exista una ventana con clase `pantalla-kiosk`:

```bash
wmctrl -lx | grep pantalla-kiosk
```

Si hay más de una, ciérralas con `wmctrl -ic <ID>` y revisa que no existan otros lanzadores activos.

### Troubleshooting de video

* `DISPLAY=:0 xrandr --query` debe mostrar la resolución actual `1920 x 480` y el modo `480x1920` asociado a `HDMI-1` con rotación izquierda. Si no aparece, revisa [`xorg/10-monitor.conf`](../xorg/10-monitor.conf).
* Asegúrate de que `wmctrl -lx` sólo liste una ventana con clase `pantalla-kiosk`.

## Servicios opcionales

El viejo servicio `pantalla-kiosk@.service` (Epiphany) permanece disponible pero está marcado como **deprecated** y no se habilita por defecto. De igual forma, `pantalla-portal@.service` no se activa automáticamente para evitar ventanas auxiliares; habilítalo manualmente sólo si es necesario.
