#!/usr/bin/env bash
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "[ERROR] Este script debe ejecutarse con sudo/root" >&2
  exit 1
fi

FIREFOX_LANG=${FIREFOX_LANG:-es-ES}
FIREFOX_URL=${FIREFOX_URL:-"https://download.mozilla.org/?product=firefox-latest&os=linux64&lang=${FIREFOX_LANG}"}
INSTALL_BASE=/opt/firefox-mozilla
INSTALL_DIR=${INSTALL_BASE}/firefox
SYMLINK_PATH=/usr/local/bin/firefox
TMP_ROOT=$(mktemp -d)
trap 'rm -rf "${TMP_ROOT}"' EXIT

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { printf '%s [INFO] %s\n' "$(ts)" "$*"; }
warn() { printf '%s [WARN] %s\n' "$(ts)" "$*" >&2; }
err() { printf '%s [ERR ] %s\n' "$(ts)" "$*" >&2; }

log "Instalando Firefox oficial (tarball) en ${INSTALL_DIR}"

installed_version=""
if [[ -f "${INSTALL_DIR}/application.ini" ]]; then
  installed_version=$(grep -E '^Version=' "${INSTALL_DIR}/application.ini" | head -n1 | cut -d= -f2- 2>/dev/null || true)
fi

resolved_url=$(curl -fsI -o /dev/null -w '%{url_effective}' -L "$FIREFOX_URL" || true)
if [[ -z "$resolved_url" ]]; then
  warn "No se pudo resolver URL final desde Mozilla, usando valor original"
  resolved_url="$FIREFOX_URL"
else
  log "Firefox URL final: ${resolved_url}"
fi

resolved_version=""
if [[ -n "$resolved_url" ]]; then
  resolved_file=${resolved_url##*/}
  resolved_file=${resolved_file%.tar.xz}
  resolved_version=${resolved_file#firefox-}
fi

need_download=1
if [[ -n "$installed_version" && -n "$resolved_version" && "$installed_version" == "$resolved_version" ]]; then
  need_download=0
  log "Firefox ${installed_version} ya presente; se reutiliza instalación"
fi

new_firefox_version="$installed_version"
if (( need_download )); then
  tarball="${TMP_ROOT}/firefox.tar.xz"
  log "Descargando Firefox (${FIREFOX_LANG})"
  if ! curl -fsSL -o "$tarball" "$resolved_url"; then
    err "No se pudo descargar Firefox desde ${resolved_url}"
    exit 1
  fi
  if [[ ! -s "$tarball" ]]; then
    err "Descarga vacía de Firefox"
    exit 1
  fi

  log "Extrayendo tarball en entorno temporal"
  if ! tar -xJf "$tarball" -C "$TMP_ROOT"; then
    err "Error al extraer Firefox"
    exit 1
  fi
  if [[ ! -d "${TMP_ROOT}/firefox" ]]; then
    err "El tarball no contiene el directorio firefox"
    exit 1
  fi

  if [[ -f "${TMP_ROOT}/firefox/application.ini" ]]; then
    new_firefox_version=$(grep -E '^Version=' "${TMP_ROOT}/firefox/application.ini" | head -n1 | cut -d= -f2- 2>/dev/null || true)
  fi
  if [[ -z "$new_firefox_version" ]]; then
    new_firefox_version=$(${TMP_ROOT}/firefox/firefox --version 2>/dev/null || true)
  fi
  if [[ -z "$new_firefox_version" ]]; then
    err "No se pudo determinar la versión descargada"
    exit 1
  fi

  log "Instalando Firefox ${new_firefox_version} en ${INSTALL_DIR}"
  rm -rf "$INSTALL_DIR"
  install -d -m 0755 "$INSTALL_BASE"
  mv "${TMP_ROOT}/firefox" "$INSTALL_DIR"
  chown -R root:root "$INSTALL_DIR"
  chmod -R 0755 "$INSTALL_DIR"
fi

if [[ ! -x "${INSTALL_DIR}/firefox" ]]; then
  err "No existe binario Firefox en ${INSTALL_DIR}/firefox"
  exit 1
fi

install -d -m 0755 /usr/local/bin
ln -sf "${INSTALL_DIR}/firefox" "$SYMLINK_PATH"
log "Symlink actualizado: ${SYMLINK_PATH} -> ${INSTALL_DIR}/firefox"

firefox_file=$(file -b "$SYMLINK_PATH" 2>/dev/null || true)
if [[ -z "$firefox_file" ]]; then
  err "'file' no pudo inspeccionar ${SYMLINK_PATH}"
  exit 1
fi
log "file ${SYMLINK_PATH}: ${firefox_file}"
log "Versión Firefox: $(${SYMLINK_PATH} --version 2>&1)"

log "Instalación de Firefox completada"
