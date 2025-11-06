#!/usr/bin/env bash
set -euo pipefail

# Script para instalar Chromium real (no snap) y arreglar permisos
# Ejecutar en el servidor Linux con: sudo bash scripts/fix_chromium_real_install.sh

TARGET_USER="${1:-dani}"
CHROMIUM_PROFILE_DIR="/home/${TARGET_USER}/.local/share/pantalla-reloj/chromium"
CHROMIUM_CACHE_DIR="/home/${TARGET_USER}/.cache/pantalla-reloj/chromium"

log() {
  printf '[fix-chromium] %s\n' "$*" >&2
}

log_section() {
  echo ""
  echo "=========================================="
  echo "$1"
  echo "=========================================="
}

# Fase 1: Desinstalar chromium-browser transicional
log_section "FASE 1: ELIMINAR CHROMIUM-BROWSER TRANSICIONAL"

log "Desinstalando chromium-browser (paquete transicional a snap)..."
apt remove -y chromium-browser 2>&1 || log "⚠ chromium-browser no estaba instalado o ya fue eliminado"

# Fase 2: Instalar Chromium real
log_section "FASE 2: INSTALAR CHROMIUM REAL"

log "Actualizando repositorios..."
apt update

log "Buscando paquetes Chromium disponibles..."
apt search chromium 2>&1 | grep -E "^chromium[^-]" | head -10 || true

# Intentar instalar chromium desde diferentes fuentes
CHROMIUM_INSTALLED=0

# Opción 1: chromium desde repositorios estándar
if apt install -y chromium 2>&1; then
  CHROMIUM_BIN=$(command -v chromium 2>/dev/null || echo "")
  if [[ -n "$CHROMIUM_BIN" ]] && ! readlink -f "$CHROMIUM_BIN" 2>/dev/null | grep -q snap; then
    log "✓ Chromium instalado correctamente desde repositorios: $CHROMIUM_BIN"
    CHROMIUM_INSTALLED=1
  fi
fi

# Opción 2: Si no funciona, intentar desde PPA de Chromium
if [[ $CHROMIUM_INSTALLED -eq 0 ]]; then
  log "Intentando instalar desde PPA de Chromium..."
  add-apt-repository -y ppa:saiarcot895/chromium-beta 2>&1 || true
  apt update
  if apt install -y chromium 2>&1; then
    CHROMIUM_BIN=$(command -v chromium 2>/dev/null || echo "")
    if [[ -n "$CHROMIUM_BIN" ]] && ! readlink -f "$CHROMIUM_BIN" 2>/dev/null | grep -q snap; then
      log "✓ Chromium instalado desde PPA: $CHROMIUM_BIN"
      CHROMIUM_INSTALLED=1
    fi
  fi
fi

# Opción 3: Descargar Chromium directamente
if [[ $CHROMIUM_INSTALLED -eq 0 ]]; then
  log "Intentando descargar Chromium directamente..."
  CHROMIUM_DIR="/opt/chromium"
  mkdir -p "$CHROMIUM_DIR"
  
  # Descargar Chromium para Linux desde repositorio oficial
  CHROMIUM_URL="https://download-chromium.appspot.com/dl/Linux_x64?type=snapshots"
  CHROMIUM_ZIP="/tmp/chromium.zip"
  
  if curl -L "$CHROMIUM_URL" -o "$CHROMIUM_ZIP" 2>&1; then
    cd "$CHROMIUM_DIR"
    unzip -q "$CHROMIUM_ZIP" 2>&1 || true
    CHROMIUM_BIN="$CHROMIUM_DIR/chrome-linux/chrome"
    if [[ -x "$CHROMIUM_BIN" ]]; then
      ln -sf "$CHROMIUM_BIN" /usr/local/bin/chromium-kiosk-bin
      CHROMIUM_BIN="/usr/local/bin/chromium-kiosk-bin"
      log "✓ Chromium descargado e instalado en: $CHROMIUM_BIN"
      CHROMIUM_INSTALLED=1
    fi
  fi
fi

if [[ $CHROMIUM_INSTALLED -eq 0 ]]; then
  log "✗ ERROR: No se pudo instalar Chromium real"
  log "Intentando instalar Firefox como alternativa..."
  if apt install -y firefox-esr 2>&1; then
    log "✓ Firefox instalado como alternativa"
  else
    log "✗ ERROR: No se pudo instalar ningún navegador"
    exit 1
  fi
fi

# Fase 3: Arreglar permisos del perfil
log_section "FASE 3: ARREGLAR PERMISOS DEL PERFIL"

log "Limpiando archivos de bloqueo residuales..."
if [[ -d "$CHROMIUM_PROFILE_DIR" ]]; then
  # Cambiar propietario del directorio completo
  chown -R "${TARGET_USER}:${TARGET_USER}" "$CHROMIUM_PROFILE_DIR" 2>/dev/null || true
  
  # Eliminar archivos de bloqueo
  find "$CHROMIUM_PROFILE_DIR" -type f \( -name "SingletonLock" -o -name "SingletonCookie" -o -name "SingletonSocket" -o -name "LOCK" \) -delete 2>/dev/null || true
  
  # Asegurar permisos correctos
  chmod -R u+rwX "$CHROMIUM_PROFILE_DIR" 2>/dev/null || true
  log "✓ Permisos del perfil arreglados"
else
  log "⚠ Directorio del perfil no existe, se creará automáticamente"
fi

if [[ -d "$CHROMIUM_CACHE_DIR" ]]; then
  chown -R "${TARGET_USER}:${TARGET_USER}" "$CHROMIUM_CACHE_DIR" 2>/dev/null || true
  find "$CHROMIUM_CACHE_DIR" -type f -name "LOCK" -delete 2>/dev/null || true
  chmod -R u+rwX "$CHROMIUM_CACHE_DIR" 2>/dev/null || true
  log "✓ Permisos del cache arreglados"
fi

# Fase 4: Configurar kiosk.env
log_section "FASE 4: CONFIGURAR KIOSK.ENV"

KIOSK_ENV="/var/lib/pantalla-reloj/state/kiosk.env"
mkdir -p "$(dirname "$KIOSK_ENV")"

if [[ $CHROMIUM_INSTALLED -eq 1 ]] && [[ -n "$CHROMIUM_BIN" ]]; then
  log "Configurando CHROMIUM_BIN_OVERRIDE en kiosk.env..."
  
  # Si el archivo existe, actualizar o agregar la variable
  if [[ -f "$KIOSK_ENV" ]]; then
    if grep -q "^CHROMIUM_BIN_OVERRIDE=" "$KIOSK_ENV"; then
      sed -i "s|^CHROMIUM_BIN_OVERRIDE=.*|CHROMIUM_BIN_OVERRIDE=$CHROMIUM_BIN|" "$KIOSK_ENV"
      log "✓ CHROMIUM_BIN_OVERRIDE actualizado"
    else
      echo "CHROMIUM_BIN_OVERRIDE=$CHROMIUM_BIN" >> "$KIOSK_ENV"
      log "✓ CHROMIUM_BIN_OVERRIDE agregado"
    fi
  else
    echo "CHROMIUM_BIN_OVERRIDE=$CHROMIUM_BIN" > "$KIOSK_ENV"
    log "✓ kiosk.env creado con CHROMIUM_BIN_OVERRIDE"
  fi
  
  log "Contenido de kiosk.env:"
  cat "$KIOSK_ENV"
fi

# Fase 5: Reiniciar servicio
log_section "FASE 5: REINICIAR SERVICIO"

log "Deteniendo servicio kiosk..."
systemctl stop pantalla-kiosk-chromium@"${TARGET_USER}".service 2>/dev/null || true
systemctl stop pantalla-kiosk@"${TARGET_USER}".service 2>/dev/null || true

# Matar procesos Chromium residuales
log "Limpiando procesos Chromium residuales..."
pkill -u "$TARGET_USER" -f 'chromium.*--class=pantalla-kiosk' 2>/dev/null || true
sleep 2

log "Recargando systemd..."
systemctl daemon-reload

log "Iniciando servicio kiosk..."
if systemctl start pantalla-kiosk-chromium@"${TARGET_USER}".service 2>&1; then
  log "✓ Servicio iniciado"
  sleep 5
else
  log "✗ ERROR: No se pudo iniciar el servicio"
  log "Logs del servicio:"
  journalctl -u pantalla-kiosk-chromium@"${TARGET_USER}".service -n 30 --no-pager
  exit 1
fi

# Fase 6: Validación
log_section "FASE 6: VALIDACIÓN"

log "Verificando estado del servicio..."
if systemctl is-active --quiet pantalla-kiosk-chromium@"${TARGET_USER}".service; then
  log "✓ Servicio está activo"
else
  log "✗ Servicio NO está activo"
  systemctl status pantalla-kiosk-chromium@"${TARGET_USER}".service --no-pager -l | head -30
fi

log ""
log "Verificando proceso Chromium..."
if pgrep -af 'chromium.*--class=pantalla-kiosk' >/dev/null 2>&1; then
  log "✓ Proceso Chromium kiosk encontrado:"
  pgrep -af 'chromium.*--class=pantalla-kiosk' | head -1
else
  log "✗ No se encontró proceso Chromium kiosk"
  log "Revisando logs..."
  journalctl -u pantalla-kiosk-chromium@"${TARGET_USER}".service -n 50 --no-pager
  tail -50 /var/log/pantalla/browser-kiosk.log 2>/dev/null || echo "Log del navegador no disponible"
fi

log ""
log "=== RESUMEN ==="
log "Chromium instalado: ${CHROMIUM_BIN:-NO}"
log "Permisos arreglados: ✓"
log "Servicio estado: $(systemctl is-active pantalla-kiosk-chromium@"${TARGET_USER}".service 2>/dev/null || echo 'INACTIVO')"
log ""
log "Si el servicio sigue fallando, revisa:"
log "  sudo journalctl -u pantalla-kiosk-chromium@${TARGET_USER} -n 50 --no-pager"
log "  tail -50 /var/log/pantalla/browser-kiosk.log"

