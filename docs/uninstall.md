# Uninstaller · Pantalla Futurista

Guía para desinstalar de forma **segura e idempotente** la app en el mini PC.
El script **NO borra** datos sensibles por defecto (configs, assets, logs), a menos que se pidan con flags `--purge-*`.

> Script: `scripts/uninstall.sh`  
> Requisitos: ejecutar con **sudo**

---

## ¿Qué hace siempre?

- Detiene y **deshabilita** los servicios:
  - `pantalla-dash-backend@<usuario>`
  - `pantalla-bg-generate.service` + `pantalla-bg-generate.timer`
  - `pantalla-bg-sync.service` + `pantalla-bg-sync.path`
- Elimina los **unit files** de systemd anteriores (si existen).
- Elimina el **vhost** de Nginx `pantalla` de `sites-available` y `sites-enabled`.
- Recarga **systemd** y **Nginx**.

Nada más se borra a menos que añadas flags `--purge-*`.

---

## Rutas relevantes

- Config y secretos: `/etc/pantalla-dash/`  
  - `config.json`
  - `env` (contiene `OPENAI_API_KEY=...`)
- Assets (fondos generados): `/opt/dash/assets/`
- Logs: `/var/log/pantalla-dash/`
- Web estática (build): `/var/www/html/`
- Repo (no se toca): `~/proyectos/Pantalla_reloj/`

---

## Uso básico

```bash
sudo ./scripts/uninstall.sh
Ejemplos
1) Desinstalar servicios, conservar todo lo demás
sudo ./scripts/uninstall.sh

2) Limpiar completamente la máquina
sudo ./scripts/uninstall.sh --purge-all

3) Forzar reinstalación limpia del código (manteniendo config/assets/logs)
sudo ./scripts/uninstall.sh --purge-venv --purge-node --purge-webroot

Comprobaciones útiles

Después de desinstalar:

# No debería haber servicios activos
systemctl status pantalla-bg-generate.service
systemctl status pantalla-bg-generate.timer
systemctl status pantalla-bg-sync.service
systemctl status pantalla-bg-sync.path
systemctl status "pantalla-dash-backend@$USER"

# Nginx sin el vhost 'pantalla'
ls -l /etc/nginx/sites-enabled/
nginx -t && systemctl restart nginx

Problemas frecuentes y soluciones

“nginx -t falló”
El script ya intenta reiniciar Nginx; si falla, revisa sintaxis de otros vhosts.

sudo nginx -t
sudo journalctl -u nginx -n 100 --no-pager


No me deja borrar /etc/pantalla-dash
Asegúrate de usar --purge-config y de ejecutar con sudo.

Quiero borrar el grupo pantalla
El script no lo elimina (por seguridad). Si no tiene miembros:

sudo groupdel pantalla

Reinstalar tras desinstalar

(Opcional) Limpiar venv/node/webroot:

sudo ./scripts/uninstall.sh --purge-venv --purge-node --purge-webroot


Instalar:

sudo ./scripts/install.sh --non-interactive \
  --openai-key "sk-..." \
  --aemet-key "..." \
  --municipio-id 12138 --municipio-name "Vila-real" \
  --postal-code 12540 --province "Castellón" --city "Vila-real"


Si moviste el instalador a scripts/, recuerda ejecutarlo como sudo ./scripts/install.sh.
