# Pantalla_reloj kiosk mode

## Configuración de video

La rotación y el modo preferido del panel HDMI quedan fijados desde Xorg. El archivo [`xorg/10-monitor.conf`](../xorg/10-monitor.conf) declara el monitor `HDMI-1` con el modo `480x1920`, rotación a la izquierda y un framebuffer virtual de `1920x1920` para evitar ajustes dinámicos vía `xrandr` en tiempo de ejecución.

Con esta configuración, al iniciar `pantalla-xorg.service` se obtiene un arranque determinista y sin parpadeos. El uso de `xrandr` queda reservado únicamente para diagnóstico manual.

## Autenticación X11

Chromium se ejecuta desde el usuario normal y necesita la cookie real de Xauthority. Asegúrate de que `~/.Xauthority` exista y sea un archivo regular (`-rw-------`) perteneciente a `dani:dani`. El servicio de Xorg ya se inicia con `-auth /home/dani/.Xauthority`, por lo que no es necesario crear enlaces simbólicos en `/var/lib`.

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
