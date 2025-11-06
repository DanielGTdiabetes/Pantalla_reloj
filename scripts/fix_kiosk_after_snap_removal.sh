#!/usr/bin/env bash
set -euo pipefail

# Script para resolver la pantalla en negro tras eliminar snap
# Ejecutar en el servidor Linux con: sudo bash scripts/fix_kiosk_after_snap_removal.sh

TARGET_USER="${1:-dani}"
KIOSK_SERVICE="pantalla-kiosk-chromium@${TARGET_USER}.service"
KIOSK_SERVICE_GENERIC="pantalla-kiosk@${TARGET_USER}.service"

log() {
  printf '[fix-kiosk] %s\n' "$*" >&2
}

log_section() {
  echo ""
  echo "=========================================="
  echo "$1"
  echo "=========================================="
}

# Fase 1: Diagnóstico
log_section "FASE 1: DIAGNÓSTICO"

log "Verificando navegadores disponibles..."
CHROMIUM_BROWSER=""
CHROMIUM=""
FIREFOX=""

if command -v chromium-browser >/dev/null 2>&1; then
  CHROMIUM_BROWSER="$(command -v chromium-browser)"
  log "✓ chromium-browser encontrado: $CHROMIUM_BROWSER"
else
  log "✗ chromium-browser NO encontrado"
fi

if command -v chromium >/dev/null 2>&1; then
  CHROMIUM="$(command -v chromium)"
  log "✓ chromium encontrado: $CHROMIUM"
else
  log "✗ chromium NO encontrado"
fi

if command -v firefox >/dev/null 2>&1; then
  FIREFOX="$(command -v firefox)"
  log "✓ firefox encontrado: $FIREFOX"
else
  log "✗ firefox NO encontrado"
fi

# Verificar si es desde snap
if [[ -n "$CHROMIUM_BROWSER" ]]; then
  if readlink -f "$CHROMIUM_BROWSER" 2>/dev/null | grep -q snap; then
    log "⚠ ADVERTENCIA: chromium-browser es desde snap"
    CHROMIUM_BROWSER=""
  fi
fi

if [[ -n "$CHROMIUM" ]]; then
  if readlink -f "$CHROMIUM" 2>/dev/null | grep -q snap; then
    log "⚠ ADVERTENCIA: chromium es desde snap"
    CHROMIUM=""
  fi
fi

# Verificar estado del servicio
log ""
log "Verificando estado del servicio kiosk..."
if systemctl is-active --quiet "$KIOSK_SERVICE" 2>/dev/null; then
  log "✓ Servicio $KIOSK_SERVICE está activo"
elif systemctl is-active --quiet "$KIOSK_SERVICE_GENERIC" 2>/dev/null; then
  log "✓ Servicio $KIOSK_SERVICE_GENERIC está activo"
  KIOSK_SERVICE="$KIOSK_SERVICE_GENERIC"
else
  log "✗ Servicio kiosk NO está activo"
fi

# Ver logs recientes
log ""
log "Últimos logs del servicio:"
journalctl -u "$KIOSK_SERVICE" -n 20 --no-pager 2>/dev/null || journalctl -u "$KIOSK_SERVICE_GENERIC" -n 20 --no-pager 2>/dev/null || log "No se pudieron obtener logs"

# Verificar procesos Chromium
log ""
log "Verificando procesos Chromium..."
if pgrep -af chromium >/dev/null 2>&1; then
  log "Procesos Chromium encontrados:"
  pgrep -af chromium | head -3
else
  log "✗ No hay procesos Chromium ejecutándose"
fi

# Fase 2: Instalación de Chromium
log_section "FASE 2: INSTALACIÓN DE CHROMIUM"

if [[ -z "$CHROMIUM_BROWSER" ]] && [[ -z "$CHROMIUM" ]]; then
  log "Chromium no está instalado. Instalando desde repositorios..."
  
  # Actualizar repositorios
  log "Actualizando repositorios..."
  apt update
  
  # Intentar instalar chromium-browser primero
  if apt install -y chromium-browser 2>&1; then
    log "✓ chromium-browser instalado correctamente"
    CHROMIUM_BROWSER="$(command -v chromium-browser)"
  else
    log "⚠ No se pudo instalar chromium-browser, intentando chromium..."
    if apt install -y chromium 2>&1; then
      log "✓ chromium instalado correctamente"
      CHROMIUM="$(command -v chromium)"
    else
      log "✗ ERROR: No se pudo instalar Chromium"
      log "Intentando instalar Firefox como alternativa..."
      if apt install -y firefox-esr 2>&1; then
        log "✓ firefox-esr instalado como alternativa"
        FIREFOX="$(command -v firefox)"
      else
        log "✗ ERROR: No se pudo instalar ningún navegador"
        exit 1
      fi
    fi
  fi
else
  log "✓ Chromium ya está instalado"
fi

# Verificar instalación final
log ""
log "Verificando instalación final..."
CHROMIUM_FINAL=""
if [[ -n "$CHROMIUM_BROWSER" ]] && [[ -x "$CHROMIUM_BROWSER" ]]; then
  CHROMIUM_FINAL="$CHROMIUM_BROWSER"
elif [[ -n "$CHROMIUM" ]] && [[ -x "$CHROMIUM" ]]; then
  CHROMIUM_FINAL="$CHROMIUM"
fi

if [[ -n "$CHROMIUM_FINAL" ]]; then
  log "✓ Chromium disponible en: $CHROMIUM_FINAL"
  if readlink -f "$CHROMIUM_FINAL" 2>/dev/null | grep -q snap; then
    log "⚠ ADVERTENCIA: Chromium es desde snap"
  else
    log "✓ Chromium NO es desde snap (correcto)"
  fi
  "$CHROMIUM_FINAL" --version 2>&1 | head -1 || true
fi

# Fase 3: Configuración
log_section "FASE 3: CONFIGURACIÓN"

# Verificar y crear kiosk.env si es necesario
KIOSK_ENV="/var/lib/pantalla-reloj/state/kiosk.env"
log "Verificando configuración en $KIOSK_ENV..."

if [[ -n "$CHROMIUM_FINAL" ]]; then
  mkdir -p "$(dirname "$KIOSK_ENV")"
  
  # Si el archivo existe, verificar si tiene CHROMIUM_BIN_OVERRIDE
  if [[ -f "$KIOSK_ENV" ]]; then
    if grep -q "CHROMIUM_BIN_OVERRIDE" "$KIOSK_ENV"; then
      log "✓ kiosk.env ya tiene CHROMIUM_BIN_OVERRIDE configurado"
    else
      log "Agregando CHROMIUM_BIN_OVERRIDE a kiosk.env..."
      echo "CHROMIUM_BIN_OVERRIDE=$CHROMIUM_FINAL" >> "$KIOSK_ENV"
      log "✓ CHROMIUM_BIN_OVERRIDE agregado"
    fi
  else
    log "Creando kiosk.env con CHROMIUM_BIN_OVERRIDE..."
    echo "CHROMIUM_BIN_OVERRIDE=$CHROMIUM_FINAL" > "$KIOSK_ENV"
    log "✓ kiosk.env creado"
  fi
fi

# Verificar XAUTHORITY
log ""
log "Verificando XAUTHORITY..."
XAUTH_PATH="/home/${TARGET_USER}/.Xauthority"
if [[ -f "$XAUTH_PATH" ]]; then
  log "✓ XAUTHORITY existe: $XAUTH_PATH"
  ls -la "$XAUTH_PATH"
else
  log "⚠ ADVERTENCIA: XAUTHORITY no existe en $XAUTH_PATH"
  log "Puede ser necesario recrearlo si hay problemas de autenticación X11"
fi

# Fase 4: Reiniciar servicios
log_section "FASE 4: REINICIAR SERVICIOS"

log "Deteniendo servicios kiosk..."
systemctl stop "$KIOSK_SERVICE" 2>/dev/null || true
systemctl stop "$KIOSK_SERVICE_GENERIC" 2>/dev/null || true

# Matar procesos Chromium residuales
log "Limpiando procesos Chromium residuales..."
pkill -u "$TARGET_USER" -f 'chromium.*--class=pantalla-kiosk' 2>/dev/null || true
sleep 2

log "Recargando systemd..."
systemctl daemon-reload

log "Iniciando servicio kiosk..."
if systemctl start "$KIOSK_SERVICE" 2>&1; then
  log "✓ Servicio $KIOSK_SERVICE iniciado"
  sleep 5
elif systemctl start "$KIOSK_SERVICE_GENERIC" 2>&1; then
  log "✓ Servicio $KIOSK_SERVICE_GENERIC iniciado"
  KIOSK_SERVICE="$KIOSK_SERVICE_GENERIC"
  sleep 5
else
  log "✗ ERROR: No se pudo iniciar el servicio kiosk"
  log "Verificando logs..."
  journalctl -u "$KIOSK_SERVICE" -n 30 --no-pager || journalctl -u "$KIOSK_SERVICE_GENERIC" -n 30 --no-pager
  exit 1
fi

# Fase 5: Validación
log_section "FASE 5: VALIDACIÓN"

log "Verificando estado del servicio..."
if systemctl is-active --quiet "$KIOSK_SERVICE"; then
  log "✓ Servicio está activo"
else
  log "✗ Servicio NO está activo"
  systemctl status "$KIOSK_SERVICE" --no-pager -l | head -20
fi

log ""
log "Verificando procesos del navegador..."
if [[ -n "$CHROMIUM_FINAL" ]]; then
  if pgrep -af 'chromium.*--class=pantalla-kiosk' >/dev/null 2>&1; then
    log "✓ Proceso Chromium kiosk encontrado:"
    pgrep -af 'chromium.*--class=pantalla-kiosk' | head -1
  else
    log "✗ No se encontró proceso Chromium kiosk"
  fi
elif [[ -n "$FIREFOX" ]]; then
  if pgrep -af 'firefox.*--kiosk' >/dev/null 2>&1; then
    log "✓ Proceso Firefox kiosk encontrado:"
    pgrep -af 'firefox.*--kiosk' | head -1
  else
    log "✗ No se encontró proceso Firefox kiosk"
  fi
fi

log ""
log "Verificando ventana kiosk (requiere X11)..."
if [[ -n "${DISPLAY:-}" ]] && [[ -f "$XAUTH_PATH" ]]; then
  if command -v wmctrl >/dev/null 2>&1; then
    if DISPLAY="${DISPLAY:-:0}" XAUTHORITY="$XAUTH_PATH" wmctrl -lx 2>/dev/null | grep -q pantalla-kiosk; then
      log "✓ Ventana kiosk detectada"
      DISPLAY="${DISPLAY:-:0}" XAUTHORITY="$XAUTH_PATH" wmctrl -lx | grep pantalla-kiosk
    else
      log "⚠ No se detectó ventana kiosk (puede tardar unos segundos)"
    fi
  else
    log "⚠ wmctrl no disponible, no se puede verificar ventana"
  fi
else
  log "⚠ DISPLAY o XAUTHORITY no configurados, no se puede verificar ventana"
fi

log ""
log "Verificando backend..."
if curl -sf --max-time 3 http://127.0.0.1:8081/api/health >/dev/null 2>&1; then
  log "✓ Backend respondiendo correctamente"
else
  log "⚠ Backend NO responde (puede ser normal si aún no está iniciado)"
fi

log ""
log "Verificando frontend..."
if curl -sf --max-time 3 http://127.0.0.1/ >/dev/null 2>&1; then
  log "✓ Frontend accesible"
else
  log "⚠ Frontend NO accesible (puede ser normal si nginx no está configurado)"
fi

# Fase 6: Resumen final
log_section "FASE 6: RESUMEN FINAL"

log ""
log "=== RESUMEN ==="
log "Navegador instalado: ${CHROMIUM_FINAL:-${FIREFOX:-NINGUNO}}"
log "Servicio kiosk: $KIOSK_SERVICE"
log "Estado del servicio: $(systemctl is-active "$KIOSK_SERVICE" 2>/dev/null || echo 'INACTIVO')"
log ""

if systemctl is-active --quiet "$KIOSK_SERVICE" 2>/dev/null; then
  log "✓ El servicio kiosk está activo"
  log ""
  log "Próximos pasos:"
  log "1. Espera 10-15 segundos para que el navegador se inicie completamente"
  log "2. Verifica la pantalla - debería mostrar la aplicación"
  log "3. Si sigue en negro, revisa los logs:"
  log "   sudo journalctl -u $KIOSK_SERVICE -n 50 --no-pager"
  log "   tail -50 /var/log/pantalla/browser-kiosk.log"
else
  log "✗ El servicio kiosk NO está activo"
  log ""
  log "Revisa los logs para más información:"
  log "   sudo journalctl -u $KIOSK_SERVICE -n 50 --no-pager"
  log ""
  log "Posibles problemas:"
  log "- Chromium no está instalado correctamente"
  log "- XAUTHORITY no está configurado"
  log "- Backend no está ejecutándose"
  log "- Problemas de permisos"
fi

log ""
log "=== FIN DEL SCRIPT ==="

