#!/usr/bin/env bash
set -euo pipefail

# Script simplificado para resolver el problema de Chromium
# Ejecutar en el servidor Linux con: sudo bash scripts/fix_chromium_simple.sh dani

TARGET_USER="${1:-dani}"
CHROMIUM_PROFILE_DIR="/home/${TARGET_USER}/.local/share/pantalla-reloj/chromium"
CHROMIUM_CACHE_DIR="/home/${TARGET_USER}/.cache/pantalla-reloj/chromium"

echo "=========================================="
echo "SOLUCIÓN PARA CHROMIUM Y PERMISOS"
echo "=========================================="
echo ""

# Paso 1: Desinstalar chromium-browser transicional
echo "1. Desinstalando chromium-browser transicional (snap)..."
apt remove -y chromium-browser 2>&1 || echo "  (ya estaba desinstalado)"

# Paso 2: Instalar Chromium real
echo ""
echo "2. Instalando Chromium real..."
apt update

# Intentar instalar chromium desde repositorios
if apt install -y chromium 2>&1; then
  CHROMIUM_BIN=$(command -v chromium 2>/dev/null || echo "")
  if [[ -n "$CHROMIUM_BIN" ]]; then
    # Verificar que NO es desde snap
    if readlink -f "$CHROMIUM_BIN" 2>/dev/null | grep -q snap; then
      echo "  ⚠ El paquete chromium también apunta a snap"
      echo "  Intentando instalar desde PPA..."
      
      # Instalar desde PPA de Chromium
      add-apt-repository -y ppa:saiarcot895/chromium-beta 2>&1 || true
      apt update
      apt install -y chromium 2>&1 || true
      CHROMIUM_BIN=$(command -v chromium 2>/dev/null || echo "")
    fi
    
    if [[ -n "$CHROMIUM_BIN" ]] && ! readlink -f "$CHROMIUM_BIN" 2>/dev/null | grep -q snap; then
      echo "  ✓ Chromium instalado: $CHROMIUM_BIN"
    else
      echo "  ✗ No se pudo instalar Chromium real"
      exit 1
    fi
  fi
else
  echo "  ✗ No se pudo instalar Chromium"
  exit 1
fi

# Paso 3: Arreglar permisos del perfil
echo ""
echo "3. Arreglando permisos del perfil de Chromium..."

# Eliminar archivos de bloqueo residuales
if [[ -d "$CHROMIUM_PROFILE_DIR" ]]; then
  echo "  Limpiando archivos de bloqueo en $CHROMIUM_PROFILE_DIR..."
  find "$CHROMIUM_PROFILE_DIR" -type f \( -name "SingletonLock" -o -name "SingletonCookie" -o -name "SingletonSocket" -o -name "LOCK" \) -delete 2>/dev/null || true
  
  # Cambiar propietario y permisos
  chown -R "${TARGET_USER}:${TARGET_USER}" "$CHROMIUM_PROFILE_DIR" 2>/dev/null || true
  chmod -R u+rwX "$CHROMIUM_PROFILE_DIR" 2>/dev/null || true
  echo "  ✓ Permisos arreglados"
else
  echo "  ℹ Directorio del perfil no existe (se creará automáticamente)"
  mkdir -p "$CHROMIUM_PROFILE_DIR"
  chown -R "${TARGET_USER}:${TARGET_USER}" "$CHROMIUM_PROFILE_DIR"
  chmod -R u+rwX "$CHROMIUM_PROFILE_DIR"
fi

if [[ -d "$CHROMIUM_CACHE_DIR" ]]; then
  echo "  Limpiando archivos de bloqueo en $CHROMIUM_CACHE_DIR..."
  find "$CHROMIUM_CACHE_DIR" -type f -name "LOCK" -delete 2>/dev/null || true
  chown -R "${TARGET_USER}:${TARGET_USER}" "$CHROMIUM_CACHE_DIR" 2>/dev/null || true
  chmod -R u+rwX "$CHROMIUM_CACHE_DIR" 2>/dev/null || true
fi

# Paso 4: Configurar kiosk.env
echo ""
echo "4. Configurando kiosk.env..."
KIOSK_ENV="/var/lib/pantalla-reloj/state/kiosk.env"
mkdir -p "$(dirname "$KIOSK_ENV")"

if [[ -f "$KIOSK_ENV" ]]; then
  # Actualizar o agregar CHROMIUM_BIN_OVERRIDE
  if grep -q "^CHROMIUM_BIN_OVERRIDE=" "$KIOSK_ENV"; then
    sed -i "s|^CHROMIUM_BIN_OVERRIDE=.*|CHROMIUM_BIN_OVERRIDE=$CHROMIUM_BIN|" "$KIOSK_ENV"
  else
    echo "CHROMIUM_BIN_OVERRIDE=$CHROMIUM_BIN" >> "$KIOSK_ENV"
  fi
else
  echo "CHROMIUM_BIN_OVERRIDE=$CHROMIUM_BIN" > "$KIOSK_ENV"
fi
echo "  ✓ kiosk.env configurado"

# Paso 5: Matar procesos residuales
echo ""
echo "5. Limpiando procesos Chromium residuales..."
pkill -u "$TARGET_USER" -f 'chromium.*--class=pantalla-kiosk' 2>/dev/null || true
sleep 2

# Paso 6: Reiniciar servicio
echo ""
echo "6. Reiniciando servicio kiosk..."
systemctl stop pantalla-kiosk-chromium@"${TARGET_USER}".service 2>/dev/null || true
systemctl daemon-reload
systemctl start pantalla-kiosk-chromium@"${TARGET_USER}".service

echo ""
echo "Esperando 5 segundos..."
sleep 5

# Paso 7: Verificar
echo ""
echo "7. Verificando estado..."
if systemctl is-active --quiet pantalla-kiosk-chromium@"${TARGET_USER}".service; then
  echo "  ✓ Servicio está activo"
else
  echo "  ✗ Servicio NO está activo"
  echo ""
  echo "  Revisando logs..."
  journalctl -u pantalla-kiosk-chromium@"${TARGET_USER}".service -n 30 --no-pager
fi

if pgrep -af 'chromium.*--class=pantalla-kiosk' >/dev/null 2>&1; then
  echo "  ✓ Proceso Chromium ejecutándose"
else
  echo "  ✗ Proceso Chromium NO está ejecutándose"
fi

echo ""
echo "=========================================="
echo "FIN DEL SCRIPT"
echo "=========================================="
echo ""
echo "Si el servicio sigue fallando, revisa:"
echo "  sudo journalctl -u pantalla-kiosk-chromium@${TARGET_USER} -n 50 --no-pager"
echo "  tail -50 /var/log/pantalla/browser-kiosk.log"
echo "  ls -la $CHROMIUM_PROFILE_DIR"

