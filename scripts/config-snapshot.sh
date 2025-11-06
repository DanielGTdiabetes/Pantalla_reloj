#!/usr/bin/env bash
# Script para crear snapshots diarios de config.json
set -euo pipefail

CONFIG_FILE="${CONFIG_FILE:-/var/lib/pantalla-reloj/config.json}"
SNAPSHOT_DIR="${SNAPSHOT_DIR:-/var/lib/pantalla-reloj/snapshots}"
MAX_SNAPSHOTS="${MAX_SNAPSHOTS:-30}"

log_info() { printf '[config-snapshot] %s\n' "$*"; }
log_error() { printf '[config-snapshot][ERROR] %s\n' "$*" >&2; }

# Verificar que config.json existe
if [[ ! -f "$CONFIG_FILE" ]]; then
  log_error "Config file not found: ${CONFIG_FILE}"
  exit 1
fi

# Crear directorio de snapshots si no existe
install -d -m 0755 -o root -g root "$SNAPSHOT_DIR"

# Crear snapshot con timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
SNAPSHOT_FILE="${SNAPSHOT_DIR}/config_${TIMESTAMP}.json"

# Copiar config.json al snapshot
if cp "$CONFIG_FILE" "$SNAPSHOT_FILE"; then
  chmod 0644 "$SNAPSHOT_FILE"
  log_info "Snapshot created: ${SNAPSHOT_FILE}"
  
  # Limpiar snapshots antiguos (mantener solo los MAX_SNAPSHOTS más recientes)
  if [[ -d "$SNAPSHOT_DIR" ]]; then
    # Ordenar por fecha y eliminar los más antiguos
    cd "$SNAPSHOT_DIR"
    ls -t config_*.json 2>/dev/null | tail -n +$((MAX_SNAPSHOTS + 1)) | while read -r old_file; do
      rm -f "$old_file"
      log_info "Removed old snapshot: ${old_file}"
    done
  fi
else
  log_error "Failed to create snapshot: ${SNAPSHOT_FILE}"
  exit 1
fi

