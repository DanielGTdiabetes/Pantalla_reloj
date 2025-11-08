#!/usr/bin/env bash
set -euo pipefail

# Script para iniciar los servicios de Pantalla_reloj en orden correcto
# Ejecutar con: sudo bash scripts/start_services.sh dani

TARGET_USER="${1:-dani}"

log() {
  printf '[start-services] %s\n' "$*" >&2
}

log_section() {
  echo ""
  echo "=========================================="
  echo "$1"
  echo "=========================================="
}

# Fase 1: Recargar systemd
log_section "FASE 1: RECARGAR SYSTEMD"

log "Recargando systemd después de corregir archivos..."
systemctl daemon-reload
log "✓ systemd recargado"

# Fase 2: Iniciar Xorg
log_section "FASE 2: INICIAR XORG"

log "Habilitando pantalla-xorg.service..."
systemctl enable pantalla-xorg.service

log "Iniciando pantalla-xorg.service..."
if systemctl start pantalla-xorg.service; then
  log "✓ pantalla-xorg.service iniciado"
  sleep 3
else
  log "✗ ERROR: No se pudo iniciar pantalla-xorg.service"
  log "Logs del servicio:"
  journalctl -u pantalla-xorg.service -n 30 --no-pager
  exit 1
fi

# Verificar que Xorg está corriendo
log "Verificando que Xorg está corriendo..."
if systemctl is-active --quiet pantalla-xorg.service; then
  log "✓ pantalla-xorg.service está activo"
else
  log "✗ ERROR: pantalla-xorg.service NO está activo"
  journalctl -u pantalla-xorg.service -n 30 --no-pager
  exit 1
fi

# Verificar que .Xauthority existe
log "Verificando .Xauthority..."
if [[ -f /var/lib/pantalla-reloj/.Xauthority ]] && [[ -s /var/lib/pantalla-reloj/.Xauthority ]]; then
  log "✓ .Xauthority existe en /var/lib/pantalla-reloj/.Xauthority"
  
  # Copiar a home del usuario
  if [[ ! -f "/home/${TARGET_USER}/.Xauthority" ]] || [[ ! -s "/home/${TARGET_USER}/.Xauthority" ]]; then
    cp -f /var/lib/pantalla-reloj/.Xauthority "/home/${TARGET_USER}/.Xauthority"
    chown "${TARGET_USER}:${TARGET_USER}" "/home/${TARGET_USER}/.Xauthority"
    chmod 600 "/home/${TARGET_USER}/.Xauthority"
    log "✓ .Xauthority copiado a /home/${TARGET_USER}/.Xauthority"
  fi
else
  log "⚠ ADVERTENCIA: .Xauthority no existe o está vacío"
  log "Esperando 5 segundos para que Xorg lo genere..."
  sleep 5
  
  if [[ -f /var/lib/pantalla-reloj/.Xauthority ]] && [[ -s /var/lib/pantalla-reloj/.Xauthority ]]; then
    cp -f /var/lib/pantalla-reloj/.Xauthority "/home/${TARGET_USER}/.Xauthority"
    chown "${TARGET_USER}:${TARGET_USER}" "/home/${TARGET_USER}/.Xauthority"
    chmod 600 "/home/${TARGET_USER}/.Xauthority"
    log "✓ .Xauthority generado y copiado"
  else
    log "✗ ERROR: .Xauthority no se generó"
    exit 1
  fi
fi

# Fase 3: Iniciar Openbox
log_section "FASE 3: INICIAR OPENBOX"

log "Habilitando pantalla-openbox@${TARGET_USER}.service..."
systemctl enable "pantalla-openbox@${TARGET_USER}.service"

log "Iniciando pantalla-openbox@${TARGET_USER}.service..."
if systemctl start "pantalla-openbox@${TARGET_USER}.service"; then
  log "✓ pantalla-openbox@${TARGET_USER}.service iniciado"
  sleep 2
else
  log "✗ ERROR: No se pudo iniciar pantalla-openbox@${TARGET_USER}.service"
  log "Logs del servicio:"
  journalctl -u "pantalla-openbox@${TARGET_USER}.service" -n 30 --no-pager
  exit 1
fi

# Verificar que Openbox está corriendo
log "Verificando que Openbox está corriendo..."
if systemctl is-active --quiet "pantalla-openbox@${TARGET_USER}.service"; then
  log "✓ pantalla-openbox@${TARGET_USER}.service está activo"
else
  log "✗ ERROR: pantalla-openbox@${TARGET_USER}.service NO está activo"
  journalctl -u "pantalla-openbox@${TARGET_USER}.service" -n 30 --no-pager
  exit 1
fi

# Fase 4: Verificar DISPLAY
log_section "FASE 4: VERIFICAR DISPLAY"

log "Verificando que DISPLAY :0 está accesible..."
if DISPLAY=:0 XAUTHORITY="/home/${TARGET_USER}/.Xauthority" xset q >/dev/null 2>&1; then
  log "✓ DISPLAY :0 está accesible"
else
  log "✗ ERROR: DISPLAY :0 NO está accesible"
  log "Verificando procesos Xorg..."
  ps aux | grep -i '[x]org' || log "No hay procesos Xorg"
  exit 1
fi

# Fase 5: Iniciar kiosk (Chrome)
log_section "FASE 5: INICIAR KIOSK"

log "Iniciando servicio Chrome kiosk..."
if [[ -f /etc/systemd/system/pantalla-kiosk-chrome@.service ]]; then
  if systemctl enable --now "pantalla-kiosk-chrome@${TARGET_USER}.service" 2>&1; then
    log "✓ pantalla-kiosk-chrome@${TARGET_USER}.service iniciado"
  else
    log "✗ ERROR: No se pudo iniciar pantalla-kiosk-chrome@${TARGET_USER}.service"
    systemctl status "pantalla-kiosk-chrome@${TARGET_USER}.service" --no-pager -l | head -20
  fi
else
  log "✗ ERROR: plantilla pantalla-kiosk-chrome@.service no encontrada"
fi

# Fase 6: Resumen final
log_section "FASE 6: RESUMEN FINAL"

log ""
log "=== ESTADO DE SERVICIOS ==="
log "pantalla-xorg.service: $(systemctl is-active pantalla-xorg.service 2>/dev/null || echo 'INACTIVO')"
log "pantalla-openbox@${TARGET_USER}.service: $(systemctl is-active "pantalla-openbox@${TARGET_USER}.service" 2>/dev/null || echo 'INACTIVO')"
log "pantalla-kiosk-chrome@${TARGET_USER}.service: $(systemctl is-active "pantalla-kiosk-chrome@${TARGET_USER}.service" 2>/dev/null || echo 'INACTIVO')"

log ""
log "=== VERIFICACIÓN DISPLAY ==="
if DISPLAY=:0 XAUTHORITY="/home/${TARGET_USER}/.Xauthority" xrandr --query >/dev/null 2>&1; then
  log "✓ xrandr funciona correctamente"
  DISPLAY=:0 XAUTHORITY="/home/${TARGET_USER}/.Xauthority" xrandr --query | head -5
else
  log "✗ xrandr NO funciona"
fi

log ""
log "=== FIN DEL SCRIPT ==="
log ""
log "Si algún servicio sigue fallando, revisa:"
log "  sudo journalctl -u pantalla-xorg.service -n 50 --no-pager"
log "  sudo journalctl -u pantalla-openbox@${TARGET_USER}.service -n 50 --no-pager"
log "  sudo journalctl -u pantalla-kiosk-chrome@${TARGET_USER}.service -n 50 --no-pager"

