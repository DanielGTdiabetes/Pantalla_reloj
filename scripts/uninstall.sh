#!/usr/bin/env bash
set -euo pipefail

umask 022

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

usage() {
  cat <<USAGE
Pantalla_reloj uninstaller
Usage: sudo bash uninstall.sh [options]

Options:
  --purge-webroot        Remove all files under /var/www/html (keeps directory)
  --purge-logs           Remove log files under /var/log/pantalla-reloj
  --purge-venv           Remove backend virtualenv and caches
  --purge-node           Remove frontend node_modules/dist artifacts
  --purge-assets         Remove assets stored in /opt/pantalla-reloj
  --purge-config         Remove configuration under /var/lib/pantalla-reloj and config.json
                         Use this for clean installations to avoid inheriting old configs
                         with maps: null or layers_global: null from previous versions
  --purge-browser-profile [DEPRECATED] El perfil del navegador kiosk se elimina siempre
                         automáticamente durante la desinstalación. Esta opción se mantiene
                         por compatibilidad pero no tiene efecto.
  -h, --help             Show this message

Examples:
  # Standard uninstall (preserves config for user settings)
  sudo bash uninstall.sh

  # Complete clean uninstall (removes everything including config)
  sudo bash uninstall.sh --purge-config --purge-assets --purge-webroot

  # Uninstall and remove corrupted browser profile
  sudo bash uninstall.sh --purge-browser-profile
USAGE
}

PURGE_WEBROOT=0
PURGE_LOGS=0
PURGE_VENV=0
PURGE_NODE=0
PURGE_ASSETS=0
PURGE_CONFIG=0
PURGE_BROWSER_PROFILE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge-webroot) PURGE_WEBROOT=1 ;;
    --purge-logs) PURGE_LOGS=1 ;;
    --purge-venv) PURGE_VENV=1 ;;
    --purge-node) PURGE_NODE=1 ;;
    --purge-assets) PURGE_ASSETS=1 ;;
    --purge-config) PURGE_CONFIG=1 ;;
    --purge-browser-profile) PURGE_BROWSER_PROFILE=1 ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[ERROR] Unknown argument: $1" >&2
      exit 1
      ;;
  esac
  shift
done

if [[ $EUID -ne 0 ]]; then
  echo "[ERROR] This uninstaller must be run as root" >&2
  exit 1
fi

log_info() { printf '[INFO] %s\n' "$*"; }
log_warn() { printf '[WARN] %s\n' "$*"; }
log_ok()   { printf '[OK] %s\n' "$*"; }

USER_NAME="dani"
PANTALLA_PREFIX=/opt/pantalla-reloj
SESSION_PREFIX=/opt/pantalla
BACKEND_DEST="${PANTALLA_PREFIX}/backend"
STATE_DIR=/var/lib/pantalla-reloj
AUTH_FILE="${STATE_DIR}/.Xauthority"
STATE_RUNTIME="${STATE_DIR}/state"
LOG_DIR=/var/log/pantalla-reloj
KIOSK_LOG_DIR=/var/log/pantalla
WEB_ROOT=/var/www/html
NGINX_SITE_LINK=/etc/nginx/sites-enabled/pantalla-reloj.conf
NGINX_SITE=/etc/nginx/sites-available/pantalla-reloj.conf
NGINX_DEFAULT_LINK=/etc/nginx/sites-enabled/default
NGINX_DEFAULT_STATE="${STATE_RUNTIME}/nginx-default-enabled"
WEBROOT_MANIFEST="${STATE_RUNTIME}/webroot-manifest"
UDEV_RULE=/etc/udev/rules.d/70-pantalla-render.rules
CHROMIUM_HOME_DATA_DIR="/home/${USER_NAME}/.local/share/pantalla-reloj/chromium"
CHROMIUM_HOME_CACHE_DIR="/home/${USER_NAME}/.cache/pantalla-reloj/chromium"

SYSTEMD_UNITS=(
  "pantalla-kiosk@${USER_NAME}.service"
  "pantalla-kiosk-chrome@${USER_NAME}.service"
  # Legacy shim conservado solo para limpiezas de entornos antiguos
  "pantalla-kiosk-chromium@${USER_NAME}.service"
  "pantalla-portal@${USER_NAME}.service"
  "pantalla-openbox@${USER_NAME}.service"
  "pantalla-dash-backend@${USER_NAME}.service"
  "pantalla-xorg@${USER_NAME}.service"
  "pantalla-session.target"
)

SYSTEMD_TIMERS=(
  "pantalla-kiosk-watchdog@${USER_NAME}.timer"
  "pantalla-config-snapshot.timer"
)

SYSTEMD_PATHS=(
  "pantalla-kiosk-autorefresh@${USER_NAME}.path"
)

log_info "Stopping systemd units, timers and paths"
# Detener timers primero
for timer in "${SYSTEMD_TIMERS[@]}"; do
  if systemctl is-active --quiet "$timer" 2>/dev/null; then
    log_info "Deteniendo timer $timer..."
    systemctl stop "$timer" >/dev/null 2>&1 || true
  fi
  if systemctl is-enabled --quiet "$timer" 2>/dev/null; then
    systemctl disable "$timer" >/dev/null 2>&1 || true
  fi
  rm -f "/etc/systemd/system/${timer}" >/dev/null 2>&1 || true
done

# Detener paths
for path in "${SYSTEMD_PATHS[@]}"; do
  if systemctl is-active --quiet "$path" 2>/dev/null; then
    log_info "Deteniendo path $path..."
    systemctl stop "$path" >/dev/null 2>&1 || true
  fi
  if systemctl is-enabled --quiet "$path" 2>/dev/null; then
    systemctl disable "$path" >/dev/null 2>&1 || true
  fi
  rm -f "/etc/systemd/system/${path}" >/dev/null 2>&1 || true
done

# Detener servicios en orden inverso de dependencias para evitar errores
for unit in "${SYSTEMD_UNITS[@]}"; do
  if systemctl is-active --quiet "$unit" 2>/dev/null; then
    log_info "Deteniendo $unit..."
    systemctl stop "$unit" >/dev/null 2>&1 || true
  fi
  if systemctl is-enabled --quiet "$unit" 2>/dev/null; then
    systemctl disable "$unit" >/dev/null 2>&1 || true
  fi
  rm -f "/etc/systemd/system/${unit}" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/graphical.target.wants/${unit}" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/multi-user.target.wants/${unit}" >/dev/null 2>&1 || true
  rm -rf "/etc/systemd/system/${unit}.d" >/dev/null 2>&1 || true
done

rm -f /etc/systemd/system/pantalla-kiosk@.service
rm -f /etc/systemd/system/pantalla-kiosk-chrome@.service
rm -f /etc/systemd/system/pantalla-kiosk-chromium@.service
rm -f /etc/systemd/system/pantalla-openbox@.service
rm -f /etc/systemd/system/default.target.wants/pantalla-kiosk-chrome@${USER_NAME}.service 2>/dev/null || true
rm -f /etc/systemd/system/multi-user.target.wants/pantalla-kiosk-chrome@${USER_NAME}.service 2>/dev/null || true

log_info "Eliminando plantillas y overrides de kiosk"
rm -f /etc/systemd/system/pantalla-xorg@.service
rm -f /etc/systemd/system/pantalla-dash-backend@.service
rm -f /etc/systemd/system/pantalla-portal@.service
rm -f /etc/systemd/system/pantalla-kiosk-chromium@${USER_NAME}.service.d/override.conf
rm -f /etc/systemd/system/pantalla-kiosk-chrome@${USER_NAME}.service.d/override.conf
rm -rf /etc/systemd/system/pantalla-kiosk@.service.d /etc/systemd/system/pantalla-openbox@.service.d /etc/systemd/system/pantalla-dash-backend@.service.d

# Eliminar todos los servicios watchdog y autorefresh
rm -f /etc/systemd/system/pantalla-kiosk-watchdog@.service
rm -f /etc/systemd/system/pantalla-kiosk-watchdog@.timer
rm -f /etc/systemd/system/pantalla-kiosk-autorefresh@.service
rm -f /etc/systemd/system/pantalla-kiosk-autorefresh@.path
rm -rf /etc/systemd/system/pantalla-kiosk-watchdog@.service.d
rm -rf /etc/systemd/system/pantalla-kiosk-autorefresh@.service.d
rm -rf /etc/systemd/system/pantalla-kiosk-autorefresh@.path.d

# Buscar y eliminar todas las instancias de servicios pantalla-* (por si hay más usuarios)
log_info "Buscando y eliminando servicios systemd residuales de pantalla-*"
find /etc/systemd/system -type f -name "pantalla-*" -delete >/dev/null 2>&1 || true
find /etc/systemd/system -type d -name "pantalla-*.service.d" -exec rm -rf {} + >/dev/null 2>&1 || true
find /etc/systemd/system -type d -name "pantalla-*.timer.d" -exec rm -rf {} + >/dev/null 2>&1 || true
find /etc/systemd/system -type d -name "pantalla-*.path.d" -exec rm -rf {} + >/dev/null 2>&1 || true

systemctl daemon-reload
systemctl reset-failed >/dev/null 2>&1 || true

rm -f "$UDEV_RULE"
udevadm control --reload >/dev/null 2>&1 || true
udevadm trigger >/dev/null 2>&1 || true

rm -f "$NGINX_SITE_LINK"
rm -f "$NGINX_SITE"
rm -f /etc/pantalla-reloj/wifi.conf
rmdir /etc/pantalla-reloj 2>/dev/null || true

restore_nginx_default() {
  local default_conf=/etc/nginx/sites-available/default

  if [[ -f "$NGINX_DEFAULT_STATE" ]]; then
    if grep -qx "enabled" "$NGINX_DEFAULT_STATE"; then
      if [[ -f "$default_conf" ]]; then
        ln -sfn "$default_conf" "$NGINX_DEFAULT_LINK"
        log_info "Restored nginx default site"
      fi
    fi
    rm -f "$NGINX_DEFAULT_STATE"
  fi

  # If no default server remains, attempt to re-enable the default site
  if command -v nginx >/dev/null 2>&1; then
    local other_default=0
    if [[ -d /etc/nginx/sites-enabled ]]; then
      while IFS= read -r -d '' file; do
        if grep -Eq 'listen\s+80\s+default_server' "$file" >/dev/null 2>&1; then
          other_default=1
          break
        fi
      done < <(find /etc/nginx/sites-enabled -type f -print0 2>/dev/null)
    fi
    if [[ $other_default -eq 0 && -f "$default_conf" && ! -e "$NGINX_DEFAULT_LINK" ]]; then
      ln -s "$default_conf" "$NGINX_DEFAULT_LINK"
      log_info "Enabled nginx default site because no default_server was present"
    fi
  fi
}

restore_nginx_default

log_info "Eliminando binarios instalados"
rm -f /usr/local/bin/pantalla-kiosk
rm -f /usr/local/bin/pantalla-kiosk-verify
rm -f /usr/local/bin/pantalla-kiosk-chromium
rm -f /usr/local/bin/pantalla-backend-launch
rm -f /usr/local/bin/pantalla-kiosk-autorefresh
rm -f /usr/local/bin/diag_kiosk.sh
rm -f /usr/local/bin/kiosk-ui /usr/local/bin/kiosk-diag
rm -f /usr/local/bin/pantalla-config-snapshot
rm -f /etc/systemd/system/pantalla-config-snapshot.timer
rm -f /etc/systemd/system/pantalla-config-snapshot.service
rm -f /etc/logrotate.d/pantalla-reloj

# Eliminar archivos desktop
log_info "Eliminando archivos desktop"
APP_ID=org.gnome.Epiphany.WebApp_PantallaReloj
rm -f /usr/local/share/applications/${APP_ID}.desktop
rm -f /home/${USER_NAME}/.local/share/applications/${APP_ID}.desktop
rm -f /home/${USER_NAME}/.local/share/xdg-desktop-portal/applications/${APP_ID}.desktop
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/local/share/applications >/dev/null 2>&1 || true
  runuser -u "$USER_NAME" -- update-desktop-database "/home/${USER_NAME}/.local/share/applications" >/dev/null 2>&1 || true
  runuser -u "$USER_NAME" -- update-desktop-database "/home/${USER_NAME}/.local/share/xdg-desktop-portal/applications" >/dev/null 2>&1 || true
fi

# Eliminar tmpfiles.d
log_info "Eliminando configuración tmpfiles.d"
rm -f /etc/tmpfiles.d/pantalla-reloj.conf

if [[ -f "$WEBROOT_MANIFEST" ]]; then
  log_info "Removing tracked web assets"
  mapfile -t tracked <"$WEBROOT_MANIFEST" || tracked=()
  if [[ ${#tracked[@]} -gt 0 ]]; then
    mapfile -t sorted_tracked < <(printf '%s\n' "${tracked[@]}" | awk 'NF' | sort -r)
    for rel in "${sorted_tracked[@]}"; do
      rm -rf "$WEB_ROOT/$rel"
    done
  fi
  rm -f "$WEBROOT_MANIFEST"
fi

if [[ $PURGE_WEBROOT -eq 1 ]]; then
  if [[ -d "$WEB_ROOT" ]]; then
    log_info "Purging complete webroot content"
    find "$WEB_ROOT" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  fi
fi

if [[ $PURGE_LOGS -eq 1 ]]; then
  if [[ -d "$LOG_DIR" ]]; then
    log_info "Purging log files"
    find "$LOG_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  fi
fi

if [[ $PURGE_VENV -eq 1 ]]; then
  log_info "Removing backend virtualenv"
  rm -rf "$BACKEND_DEST/.venv"
  find "$BACKEND_DEST" -type d -name '__pycache__' -prune -exec rm -rf {} + 2>/dev/null || true
fi

if [[ $PURGE_NODE -eq 1 ]]; then
  log_info "Removing frontend node_modules/dist"
  rm -rf "$REPO_ROOT/dash-ui/node_modules" "$REPO_ROOT/dash-ui/dist"
fi

if [[ $PURGE_ASSETS -eq 1 ]]; then
  if [[ -d "$PANTALLA_PREFIX" ]]; then
    log_info "Removing assets under $PANTALLA_PREFIX"
    find "$PANTALLA_PREFIX" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  fi
fi

rm -f "$SESSION_PREFIX/bin/xorg-openbox-env.sh"
rm -f "$SESSION_PREFIX/bin/wait-x.sh"
rm -f "$SESSION_PREFIX/bin/pantalla-portal-launch.sh"
rm -f "$SESSION_PREFIX/openbox/autostart"
if [[ -d "$SESSION_PREFIX/bin" ]]; then
  rmdir --ignore-fail-on-non-empty "$SESSION_PREFIX/bin" || true
fi
if [[ -d "$SESSION_PREFIX/openbox" ]]; then
  rmdir --ignore-fail-on-non-empty "$SESSION_PREFIX/openbox" || true
fi
if [[ -d "$SESSION_PREFIX" ]]; then
  rmdir --ignore-fail-on-non-empty "$SESSION_PREFIX" || true
fi

if [[ $PURGE_CONFIG -eq 1 ]]; then
  if [[ -d "$STATE_DIR" ]]; then
    log_info "Removing configuration under $STATE_DIR"
    find "$STATE_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  fi
  # Eliminar secrets.json si existe (puede estar en diferentes ubicaciones)
  SECRETS_PATHS=(
    "$STATE_DIR/secrets.json"
    "$PANTALLA_PREFIX/secrets.json"
    "/opt/pantalla-reloj/secrets.json"
  )
  for secrets_path in "${SECRETS_PATHS[@]}"; do
    if [[ -f "$secrets_path" ]]; then
      log_info "Removing secrets.json: $secrets_path"
      rm -f "$secrets_path"
    fi
  done
  # Eliminar config.json si existe (puede estar en diferentes ubicaciones)
  CONFIG_PATHS=(
    "$STATE_DIR/config.json"
    "$STATE_DIR/config/config.json"
    "$PANTALLA_PREFIX/config/config.json"
    "/opt/pantalla-reloj/config/config.json"
    "/etc/pantalla-dash/config.json"
    "/var/lib/pantalla/config.json"
  )
  for config_path in "${CONFIG_PATHS[@]}"; do
    if [[ -f "$config_path" ]]; then
      log_info "Removing config.json: $config_path"
      rm -f "$config_path"
      # Intentar eliminar el directorio padre si está vacío
      config_dir="$(dirname "$config_path")"
      if [[ -d "$config_dir" && "$config_dir" != "/" && "$config_dir" != "$STATE_DIR" ]]; then
        rmdir --ignore-fail-on-non-empty "$config_dir" 2>/dev/null || true
      fi
    fi
  done
  log_info "Configuration purged. Future installations will start with clean defaults."
  log_info "NOTE: This prevents inheriting old config.json with maps: null or layers_global: null"
else
  # Keep state but remove runtime markers
  rm -rf "$STATE_RUNTIME"
  log_info "Configuration preserved (use --purge-config to remove it for clean install)"
fi

# Limpiar directorios de caché de layers y focus masks (siempre, no solo con --purge)
log_info "Limpiando cachés de layers y focus masks"
if [[ -d /var/cache/pantalla/focus ]]; then
  rm -rf /var/cache/pantalla/focus/* >/dev/null 2>&1 || true
fi
if [[ -d /var/cache/pantalla/global ]]; then
  rm -rf /var/cache/pantalla/global/satellite/* >/dev/null 2>&1 || true
  rm -rf /var/cache/pantalla/global/radar/* >/dev/null 2>&1 || true
fi
if [[ -d /var/cache/pantalla ]]; then
  find /var/cache/pantalla -maxdepth 1 -type f \( -name "flights.*" -o -name "ships.*" \) -delete >/dev/null 2>&1 || true
fi
log_ok "Cachés de layers y focus limpiadas"

HOME_AUTH="/home/${USER_NAME}/.Xauthority"
HOME_AUTH_BACKUP="${HOME_AUTH}.bak"

if [[ -L "$HOME_AUTH" ]]; then
  link_target="$(readlink "$HOME_AUTH")"
  if [[ "$link_target" == "$AUTH_FILE" ]] || [[ "$(readlink -f "$HOME_AUTH" 2>/dev/null || true)" == "$AUTH_FILE" ]]; then
    rm -f "$HOME_AUTH"
  fi
fi

if [[ ! -e "$HOME_AUTH" && -f "$HOME_AUTH_BACKUP" ]]; then
  mv -f "$HOME_AUTH_BACKUP" "$HOME_AUTH"
fi

AUTO_FILE="/home/${USER_NAME}/.config/openbox/autostart"
AUTO_BACKUP="${AUTO_FILE}.pantalla-reloj.bak"
if [[ -f "$AUTO_BACKUP" ]]; then
  mv -f "$AUTO_BACKUP" "$AUTO_FILE"
elif [[ -f "$AUTO_FILE" ]]; then
  rm -f "$AUTO_FILE"
fi

clean_empty_chromium_dir() {
  local dir="$1"
  if [[ -d "$dir" ]]; then
    if [[ -n "$(find "$dir" -mindepth 1 -print -quit 2>/dev/null)" ]]; then
      return
    fi
    if rmdir "$dir" >/dev/null 2>&1; then
      log_info "Removed empty Chromium directory $dir"
    fi
  fi
}

clean_empty_chromium_dir "$CHROMIUM_HOME_DATA_DIR"
clean_empty_chromium_dir "$CHROMIUM_HOME_CACHE_DIR"

# ============================================================================
# ELIMINACIÓN DEL PERFIL DEL NAVEGADOR KIOSK
# ============================================================================
# El perfil del navegador kiosk se elimina siempre en una desinstalación
# para garantizar que futuras instalaciones empiezan desde cero, sin estado
# corrupto. Esto previene problemas de permisos y perfiles corruptos.
# ============================================================================

CHROME_PROFILE_DIR="${STATE_RUNTIME}/chromium-kiosk"
FIREFOX_PROFILE_DIR="${STATE_RUNTIME}/firefox-kiosk"

# Eliminar perfil de Chrome (idempotente)
if [[ -d "$CHROME_PROFILE_DIR" ]]; then
  log_info "Eliminando perfil del navegador kiosk (Chrome): $CHROME_PROFILE_DIR"
  rm -rf "$CHROME_PROFILE_DIR"
  log_ok "Perfil de Chrome eliminado"
else
  log_info "Perfil de Chrome no existe: $CHROME_PROFILE_DIR (ya limpio)"
fi

# Eliminar perfil de Firefox si existe (idempotente)
if [[ -d "$FIREFOX_PROFILE_DIR" ]]; then
  log_info "Eliminando perfil del navegador kiosk (Firefox): $FIREFOX_PROFILE_DIR"
  rm -rf "$FIREFOX_PROFILE_DIR"
  log_ok "Perfil de Firefox eliminado"
fi

# Limpiar logs, cachés y snapshots
log_info "Limpiando logs, cachés y snapshots residuales"
if [[ -d "$LOG_DIR" ]]; then
  find "$LOG_DIR" -type f -name "*.log" -delete >/dev/null 2>&1 || true
  find "$LOG_DIR" -type f -name "*.log.*" -delete >/dev/null 2>&1 || true
  find "$LOG_DIR" -type f -name "*.log.*.gz" -delete >/dev/null 2>&1 || true
fi
if [[ -d "$KIOSK_LOG_DIR" ]]; then
  find "$KIOSK_LOG_DIR" -type f -name "*.log" -delete >/dev/null 2>&1 || true
  find "$KIOSK_LOG_DIR" -type f -name "*.log.*" -delete >/dev/null 2>&1 || true
fi
if [[ -d "$STATE_RUNTIME" ]]; then
  find "$STATE_RUNTIME" -type f -name "*.snapshot" -delete >/dev/null 2>&1 || true
  find "$STATE_RUNTIME" -type f -name "*.bak" -delete >/dev/null 2>&1 || true
  find "$STATE_RUNTIME" -type f -name "*.flag" -delete >/dev/null 2>&1 || true
  find "$STATE_RUNTIME" -type f -name "*.env" -delete >/dev/null 2>&1 || true
fi

# Limpiar todos los directorios de caché de pantalla
log_info "Limpiando todos los directorios de caché"
CACHE_DIRS=(
  "/var/cache/pantalla"
  "/var/cache/pantalla/focus"
  "/var/cache/pantalla/global"
  "/var/cache/pantalla/global/satellite"
  "/var/cache/pantalla/global/radar"
  "${STATE_DIR}/cache"
  "${STATE_DIR}/config.snapshots"
)
for cache_dir in "${CACHE_DIRS[@]}"; do
  if [[ -d "$cache_dir" ]]; then
    log_info "Limpiando caché: $cache_dir"
    find "$cache_dir" -mindepth 1 -delete >/dev/null 2>&1 || true
  fi
done

# Restaurar permisos correctos en /var/lib/pantalla-reloj
if [[ -d "$STATE_DIR" ]]; then
  log_info "Restaurando permisos en $STATE_DIR"
  chown -R "$USER_NAME:$USER_NAME" "$STATE_DIR" >/dev/null 2>&1 || true
  find "$STATE_DIR" -type d -exec chmod 700 {} + >/dev/null 2>&1 || true
  find "$STATE_DIR" -type f -exec chmod 600 {} + >/dev/null 2>&1 || true
  # Permitir lectura de config.json
  if [[ -f "$STATE_DIR/config.json" ]]; then
    chmod 644 "$STATE_DIR/config.json" >/dev/null 2>&1 || true
  fi
fi

# Limpiar directorios vacíos residuales
log_info "Limpiando directorios vacíos residuales"
DIRS_TO_CLEAN=(
  "$SESSION_PREFIX/bin"
  "$SESSION_PREFIX/openbox"
  "$SESSION_PREFIX"
  "$PANTALLA_PREFIX/backend"
  "$PANTALLA_PREFIX/frontend"
  "$PANTALLA_PREFIX"
  "/etc/pantalla-reloj"
  "/etc/pantalla-dash"
  "/var/lib/pantalla"
  "$LOG_DIR"
  "$KIOSK_LOG_DIR"
  "/var/cache/pantalla/focus"
  "/var/cache/pantalla/global/satellite"
  "/var/cache/pantalla/global/radar"
  "/var/cache/pantalla/global"
  "/var/cache/pantalla"
)

for dir in "${DIRS_TO_CLEAN[@]}"; do
  if [[ -d "$dir" ]]; then
    # Intentar eliminar solo si está vacío
    rmdir "$dir" >/dev/null 2>&1 && log_info "Eliminado directorio vacío: $dir" || true
  fi
done

# Limpiar directorios de usuario si están vacíos
USER_DIRS=(
  "/home/${USER_NAME}/.local/share/pantalla-reloj"
  "/home/${USER_NAME}/.cache/pantalla-reloj"
  "/home/${USER_NAME}/.local/share/applications"
  "/home/${USER_NAME}/.local/share/xdg-desktop-portal/applications"
)
for user_dir in "${USER_DIRS[@]}"; do
  if [[ -d "$user_dir" ]]; then
    # Solo eliminar si está vacío o solo contiene archivos de pantalla-reloj
    if [[ -z "$(find "$user_dir" -mindepth 1 -maxdepth 1 ! -name "*.desktop" 2>/dev/null)" ]]; then
      find "$user_dir" -name "*pantalla*" -o -name "*PantallaReloj*" -delete >/dev/null 2>&1 || true
      rmdir --ignore-fail-on-non-empty "$user_dir" >/dev/null 2>&1 || true
    fi
  fi
done

if command -v nginx >/dev/null 2>&1; then
  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx >/dev/null 2>&1 || true
    log_ok "nginx recargado"
  else
    log_warn "nginx -t failed after cleanup; nginx not reloaded"
  fi
fi

# Verificar si quedan archivos residuales
log_info "Verificando archivos residuales..."
RESIDUAL_FILES=$(find /etc/systemd/system -name "*pantalla*" 2>/dev/null | wc -l)
if [[ $RESIDUAL_FILES -gt 0 ]]; then
  log_warn "Se encontraron $RESIDUAL_FILES archivos systemd residuales con 'pantalla' en el nombre"
  find /etc/systemd/system -name "*pantalla*" -ls 2>/dev/null || true
fi

RESIDUAL_BINARIES=$(find /usr/local/bin -name "*pantalla*" 2>/dev/null | wc -l)
if [[ $RESIDUAL_BINARIES -gt 0 ]]; then
  log_warn "Se encontraron $RESIDUAL_BINARIES binarios residuales con 'pantalla' en el nombre"
  find /usr/local/bin -name "*pantalla*" -ls 2>/dev/null || true
fi

log_ok "Pantalla_reloj desinstalado completamente"
log_info "Para una limpieza total, ejecuta: sudo bash uninstall.sh --purge-config --purge-assets --purge-webroot --purge-logs --purge-venv --purge-node"
