#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

WITH_FIREFOX=0

usage() {
  cat <<'EOF'
Repara el entorno kiosk para Pantalla_reloj.

Uso: sudo KIOSK_USER=dani scripts/fix_kiosk_env.sh [--with-firefox]

Opciones:
  --with-firefox   Fuerza reinstalación de Firefox desde Mozilla.
  -h, --help       Muestra este mensaje y sale.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --with-firefox)
      WITH_FIREFOX=1
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Argumento desconocido: $arg" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ $EUID -ne 0 ]]; then
  echo "[ERROR] Este script debe ejecutarse como root" >&2
  exit 1
fi

KIOSK_USER="${KIOSK_USER:-dani}"
if ! id "$KIOSK_USER" >/dev/null 2>&1; then
  echo "[ERROR] El usuario $KIOSK_USER no existe" >&2
  exit 1
fi

KIOSK_UID="$(id -u "$KIOSK_USER")"
KIOSK_HOME="$(eval echo "~${KIOSK_USER}")"

log_info() {
  printf '[INFO] %s\n' "$*"
}

log_ok() {
  printf '[OK] %s\n' "$*"
}

log_warn() {
  printf '[WARN] %s\n' "$*"
}

FIREFOX_URL="https://download.mozilla.org/?product=firefox-latest&os=linux64&lang=es-ES"
FIREFOX_DEST="/opt/firefox-mozilla"

install_firefox() {
  log_info "Descargando Firefox desde Mozilla"
  tmp_tar="$(mktemp /tmp/firefox.XXXXXX.tar)"
  if ! curl -fsSL "$FIREFOX_URL" -o "$tmp_tar"; then
    rm -f "$tmp_tar"
    echo "[ERROR] No se pudo descargar Firefox" >&2
    exit 1
  fi

  mime_type="$(file -b --mime-type "$tmp_tar")"
  case "$mime_type" in
    application/x-bzip2) tar_flag=j ;;
    application/x-xz) tar_flag=J ;;
    application/gzip|application/x-gzip) tar_flag=z ;;
    *)
      rm -f "$tmp_tar"
      echo "[ERROR] El archivo de Firefox no es un tar válido (tipo $mime_type)" >&2
      exit 1
      ;;
  esac

  tmp_dir="$(mktemp -d /tmp/firefox.XXXXXX)"
  if ! tar -x"${tar_flag}"f "$tmp_tar" -C "$tmp_dir"; then
    rm -rf "$tmp_dir" "$tmp_tar"
    echo "[ERROR] No se pudo extraer Firefox" >&2
    exit 1
  fi

  extracted="$(find "$tmp_dir" -mindepth 1 -maxdepth 1 -type d | head -n1 || true)"
  if [[ -z "$extracted" ]]; then
    rm -rf "$tmp_dir" "$tmp_tar"
    echo "[ERROR] No se encontró el directorio extraído de Firefox" >&2
    exit 1
  fi

  rm -rf "$FIREFOX_DEST"
  mkdir -p "$FIREFOX_DEST"
  mv "$extracted" "$FIREFOX_DEST/firefox"
  rm -rf "$tmp_dir" "$tmp_tar"

  install -m 0755 "$REPO_ROOT/usr/local/bin/kiosk-epiphany" /usr/local/bin/kiosk-epiphany
  ln -sfn "$FIREFOX_DEST/firefox/firefox" /usr/local/bin/firefox
  chmod -R 755 "$FIREFOX_DEST"
  log_ok "Firefox reinstalado en $FIREFOX_DEST"
}

ensure_firefox() {
  if [[ $WITH_FIREFOX -eq 1 ]]; then
    install_firefox
    return
  fi

  if [[ ! -x /usr/local/bin/firefox ]]; then
    log_warn "Firefox no encontrado. Usar --with-firefox para reinstalarlo (opcional)."
    return
  fi

  if ! /usr/local/bin/firefox --version >/dev/null 2>&1; then
    log_warn "El binario de Firefox existe pero no responde. Ejecute con --with-firefox para repararlo."
  else
    log_ok "Firefox operativo ($( /usr/local/bin/firefox --version | head -n1 ))"
  fi
}

log_info "Asegurando estructura de directorios para $KIOSK_USER"
install -d -o "$KIOSK_USER" -g "$KIOSK_USER" -m 0700 "$KIOSK_HOME/.mozilla/pantalla-kiosk"
install -d -o "$KIOSK_USER" -g "$KIOSK_USER" -m 0755 "$KIOSK_HOME/.config/openbox"
install -o "$KIOSK_USER" -g "$KIOSK_USER" -m 0755 "$REPO_ROOT/openbox/autostart" "$KIOSK_HOME/.config/openbox/autostart"
touch "$KIOSK_HOME/.Xauthority"
chown "$KIOSK_USER:$KIOSK_USER" "$KIOSK_HOME/.Xauthority"

log_info "Validando runtime en /run/user/$KIOSK_UID"
install -d -m 0700 -o "$KIOSK_USER" -g "$KIOSK_USER" "/run/user/$KIOSK_UID"

log_info "Instalando scripts kiosk"
install -m 0755 "$REPO_ROOT/usr/local/bin/kiosk-epiphany" /usr/local/bin/kiosk-epiphany
install -d -m 0755 /opt/pantalla/bin
install -m 0755 "$REPO_ROOT/opt/pantalla/bin/pantalla-portal-launch.sh" /opt/pantalla/bin/pantalla-portal-launch.sh

ensure_firefox

log_info "Recargando systemd units"
install -m 0644 "$REPO_ROOT/systemd/pantalla-xorg.service" /etc/systemd/system/pantalla-xorg.service
install -m 0644 "$REPO_ROOT/systemd/pantalla-openbox@.service" /etc/systemd/system/pantalla-openbox@.service
install -m 0644 "$REPO_ROOT/systemd/pantalla-dash-backend@.service" /etc/systemd/system/pantalla-dash-backend@.service
install -m 0644 "$REPO_ROOT/systemd/pantalla-kiosk@.service" /etc/systemd/system/pantalla-kiosk@.service
install -m 0644 "$REPO_ROOT/systemd/pantalla-portal@.service" /etc/systemd/system/pantalla-portal@.service
systemctl daemon-reload

SERVICES=(
  pantalla-xorg.service
  "pantalla-dash-backend@${KIOSK_USER}.service"
  "pantalla-openbox@${KIOSK_USER}.service"
  "pantalla-portal@${KIOSK_USER}.service"
  "pantalla-kiosk@${KIOSK_USER}.service"
)

for svc in "${SERVICES[@]}"; do
  log_info "Habilitando $svc"
  systemctl enable --now "$svc"
done

log_ok "Entorno kiosk reparado para $KIOSK_USER"
