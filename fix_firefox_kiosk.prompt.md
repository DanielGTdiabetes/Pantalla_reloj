# Contexto del proyecto

Proyecto: **Pantalla_reloj**
Plataforma: Mini-PC Ubuntu 24.04 con pantalla 8.8″ (1920x480) en modo kiosk.
Backend: FastAPI
Frontend: React/Vite servido por Nginx.
UI no interactiva (solo display, sin clics).
Servicios:  
- pantalla-xorg.service  
- pantalla-openbox@dani.service  
- pantalla-dash-backend@dani.service  

El navegador debe abrir en kiosk local a `http://127.0.0.1`.

---

# Problema detectado

Tras ejecutar `scripts/uninstall.sh` y reinstalar, el sistema:
- muestra cursor y pantalla negra (sin contenido),
- `xeyes` funciona correctamente (Xorg activo),
- Firefox no arranca en kiosk, aunque el proceso aparece brevemente (`Exiting due to channel error`),
- el enlace `/usr/local/bin/firefox` apunta a un binario roto o wrapper parcial (`broken symbolic link`),
- la sesión SSH se cierra al reiniciar `pantalla-openbox@dani.service`.

En logs:
Exiting due to channel error.
fusermount3: failed to access mountpoint /run/user/1000/doc: Permission denied
A connection to the bus can't be made
setsid: failed to execute /usr/local/bin/firefox: No such file or directory

markdown
Copiar código

---

# Objetivo

Codex debe **detectar, corregir y verificar automáticamente** lo siguiente:

1. **Reinstalar Firefox oficial** (tarball de Mozilla, no snap):
   - Extraer en `/opt/firefox-mozilla/firefox/`
   - Crear symlink válido en `/usr/local/bin/firefox`
   - Confirmar `file /usr/local/bin/firefox` → ELF válido, versión visible.

2. **Reparar el entorno gráfico kiosk**:
   - Garantizar que `pantalla-xorg.service` y `pantalla-openbox@dani.service` usen `pantalla-session.target` (aislado de SSH).
   - Comprobar variables: `DISPLAY=:0`, `XAUTHORITY=/home/dani/.Xauthority`.
   - Autostart `/home/dani/.config/openbox/autostart` debe:
     ```bash
     xset -dpms; xset s off; xset s noblank
     xrandr --output HDMI-1 --rotate left --primary
     sleep 2
     setsid -f /usr/local/bin/firefox --no-remote --kiosk http://127.0.0.1 &
     ```
   - No debe incluir Wayland ni compositores.

3. **Corregir permisos del entorno runtime**:
   - `/run/user/1000` → owned by `dani:dani`, chmod 700
   - `/home/dani/.Xauthority` debe existir.
   - Crear perfil `~/.mozilla/pantalla-kiosk/user.js` con aceleración desactivada:
     ```
     user_pref("gfx.webrender.enabled", false);
     user_pref("gfx.webrender.force-disabled", true);
     user_pref("layers.acceleration.disabled", true);
     user_pref("browser.startup.homepage", "http://127.0.0.1");
     user_pref("browser.startup.page", 1);
     user_pref("browser.shell.checkDefaultBrowser", false);
     ```

4. **Mantener la sesión SSH viva** al reiniciar servicios:
   - Crear `/etc/systemd/system/pantalla-session.target` para aislar Openbox/Xorg del usuario SSH.
   - Ajustar dependencias en los `.service`.

5. **Probar el arranque completo:**
   - `sudo systemctl restart pantalla-xorg pantalla-openbox@dani`
   - Verificar proceso Firefox (`pgrep -a firefox`)
   - Mostrar `/tmp/kiosk.err` y `systemctl status pantalla-openbox@dani`

---

# Entregables esperados

- Commit con:
  - `scripts/install_firefox.sh` (descarga, instala y crea symlink)
  - `scripts/fix_kiosk_env.sh` (crea perfil, target, corrige permisos y servicios)
- Modificaciones en `scripts/install.sh` y `scripts/uninstall.sh` para integrar esta reparación.
- Confirmación en logs de que:
firefox --version → muestra versión real
pantalla inicia con contenido visible (no negra)
SSH permanece activo tras reiniciar openbox

yaml
Copiar código

---

# Prioridad

1. Reparar binario Firefox roto.
2. Asegurar entorno kiosk 100 % funcional sin Wayland.
3. Preservar sesión SSH.

