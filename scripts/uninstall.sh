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
  --purge-webroot   Remove all files under /var/www/html (keeps directory)
  --purge-logs      Remove log files under /var/log/pantalla-reloj
  --purge-venv      Remove backend virtualenv and caches
  --purge-node      Remove frontend node_modules/dist artifacts
  --purge-assets    Remove assets stored in /opt/pantalla-reloj
  --purge-config    Remove configuration under /var/lib/pantalla-reloj
  -h, --help        Show this message
USAGE
}

PURGE_WEBROOT=0
PURGE_LOGS=0
PURGE_VENV=0
PURGE_NODE=0
PURGE_ASSETS=0
PURGE_CONFIG=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge-webroot) PURGE_WEBROOT=1 ;;
    --purge-logs) PURGE_LOGS=1 ;;
    --purge-venv) PURGE_VENV=1 ;;
    --purge-node) PURGE_NODE=1 ;;
    --purge-assets) PURGE_ASSETS=1 ;;
    --purge-config) PURGE_CONFIG=1 ;;
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
WEB_ROOT=/var/www/html
NGINX_SITE_LINK=/etc/nginx/sites-enabled/pantalla-reloj.conf
NGINX_SITE=/etc/nginx/sites-available/pantalla-reloj.conf
NGINX_DEFAULT_LINK=/etc/nginx/sites-enabled/default
NGINX_DEFAULT_STATE="${STATE_RUNTIME}/nginx-default-enabled"
WEBROOT_MANIFEST="${STATE_RUNTIME}/webroot-manifest"
UDEV_RULE=/etc/udev/rules.d/70-pantalla-render.rules

SYSTEMD_UNITS=(
  "pantalla-kiosk@${USER_NAME}.service"
  "pantalla-kiosk-chromium@${USER_NAME}.service"
  "pantalla-portal@${USER_NAME}.service"
  "pantalla-openbox@${USER_NAME}.service"
  "pantalla-dash-backend@${USER_NAME}.service"
  "pantalla-xorg.service"
  "pantalla-session.target"
)

log_info "Stopping systemd units"
for unit in "${SYSTEMD_UNITS[@]}"; do
  systemctl disable --now "$unit" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/${unit}" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/graphical.target.wants/${unit}" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/multi-user.target.wants/${unit}" >/dev/null 2>&1 || true
  rm -rf "/etc/systemd/system/${unit}.d" >/dev/null 2>&1 || true
done

rm -f /etc/systemd/system/pantalla-kiosk@.service
rm -f /etc/systemd/system/pantalla-kiosk-chromium@.service
rm -f /etc/systemd/system/pantalla-openbox@.service
rm -f /etc/systemd/system/pantalla-xorg.service
rm -f /etc/systemd/system/pantalla-dash-backend@.service
rm -f /etc/systemd/system/pantalla-portal@.service
rm -rf /etc/systemd/system/pantalla-kiosk@.service.d /etc/systemd/system/pantalla-openbox@.service.d /etc/systemd/system/pantalla-dash-backend@.service.d

systemctl daemon-reload
systemctl reset-failed >/dev/null 2>&1 || true

rm -f "$UDEV_RULE"
udevadm control --reload >/dev/null 2>&1 || true
udevadm trigger >/dev/null 2>&1 || true

rm -f "$NGINX_SITE_LINK"
rm -f "$NGINX_SITE"

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

rm -f /usr/local/bin/pantalla-kiosk

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
else
  # Keep state but remove runtime markers
  rm -rf "$STATE_RUNTIME"
fi

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

if command -v nginx >/dev/null 2>&1; then
  if nginx -t >/dev/null 2>&1; then
    systemctl reload nginx >/dev/null 2>&1 || true
  else
    log_warn "nginx -t failed after cleanup; nginx not reloaded"
  fi
fi

log_ok "Pantalla_reloj uninstalled"
