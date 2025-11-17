#!/usr/bin/env bash
# Script de verificación completa del kiosk y mapa
# Verifica que todos los componentes estén funcionando correctamente

set -euo pipefail

USER_NAME="${1:-dani}"
STATE_DIR="/var/lib/pantalla-reloj"
CONFIG_FILE="${STATE_DIR}/config.json"
CHROME_PROFILE_DIR="${STATE_DIR}/state/chromium-kiosk"
HOME_XAUTH="/home/${USER_NAME}/.Xauthority"
STATE_XAUTH="${STATE_DIR}/.Xauthority"
BACKEND_URL="http://127.0.0.1:8081"
MAP_TEST_URL="http://127.0.0.1/api/maps/test_maptiler"

log_info() { printf '[INFO] %s\n' "$*"; }
log_warn() { printf '[WARN] %s\n' "$*"; }
log_ok()   { printf '[OK] %s\n' "$*"; }
log_error(){ printf '[ERROR] %s\n' "$*" >&2; }

EXIT_CODE=0

# 1. Verificar Xorg operativo
log_info "Verificando que Xorg esté operativo..."
if systemctl is-active --quiet pantalla-xorg.service 2>/dev/null; then
  log_ok "pantalla-xorg.service está activo"
else
  log_error "pantalla-xorg.service NO está activo"
  EXIT_CODE=1
fi

# 2. Verificar DISPLAY=:0
log_info "Verificando DISPLAY=:0..."
if DISPLAY=:0 XAUTHORITY="$HOME_XAUTH" xset q >/dev/null 2>&1; then
  log_ok "DISPLAY=:0 funciona correctamente"
else
  log_error "DISPLAY=:0 no funciona"
  EXIT_CODE=1
  
  # Intentar con XAUTHORITY de STATE_DIR como fallback
  if [[ -f "$STATE_XAUTH" ]]; then
    log_info "Intentando con XAUTHORITY de ${STATE_DIR}..."
    if DISPLAY=:0 XAUTHORITY="$STATE_XAUTH" xset q >/dev/null 2>&1; then
      log_warn "DISPLAY funciona con XAUTHORITY de ${STATE_DIR}, pero no con ${HOME_XAUTH}"
      log_warn "Considera copiar .Xauthority desde ${STATE_DIR} a ${HOME_XAUTH}"
    fi
  fi
fi

# 3. Verificar Chrome ejecutándose
log_info "Verificando que Chrome esté ejecutándose..."
CHROME_PIDS=$(pgrep -u "$USER_NAME" -f "google-chrome|chromium" 2>/dev/null || true)
if [[ -n "$CHROME_PIDS" ]]; then
  log_ok "Chrome está ejecutándose (PIDs: $CHROME_PIDS)"
  
  # Verificar que hay una ventana de Chrome visible
  if DISPLAY=:0 XAUTHORITY="$HOME_XAUTH" xdotool search --class "pantalla-kiosk" >/dev/null 2>&1; then
    log_ok "Ventana de Chrome kiosk detectada"
  else
    log_warn "Chrome está ejecutándose pero no se detecta ventana kiosk (puede estar iniciando)"
  fi
else
  log_error "Chrome NO está ejecutándose"
  EXIT_CODE=1
fi

# 4. Verificar permisos del perfil Chrome
log_info "Verificando permisos del perfil Chrome..."
if [[ -d "$CHROME_PROFILE_DIR" ]]; then
  OWNER=$(stat -c '%U:%G' "$CHROME_PROFILE_DIR" 2>/dev/null || echo "")
  PERMS=$(stat -c '%a' "$CHROME_PROFILE_DIR" 2>/dev/null || echo "")
  EXPECTED_OWNER="${USER_NAME}:${USER_NAME}"
  
  if [[ "$OWNER" == "$EXPECTED_OWNER" ]] && [[ "$PERMS" == "700" ]]; then
    log_ok "Permisos del perfil Chrome correctos (owner=$OWNER, perms=$PERMS)"
  else
    log_error "Permisos del perfil Chrome incorrectos (owner=$OWNER, perms=$PERMS, esperado=$EXPECTED_OWNER:700)"
    EXIT_CODE=1
  fi
else
  log_warn "Perfil de Chrome no existe: $CHROME_PROFILE_DIR"
  log_warn "Se creará automáticamente al iniciar el kiosk"
fi

# 5. Verificar config JSON estructurada
log_info "Verificando estructura de config.json..."
if [[ ! -f "$CONFIG_FILE" ]]; then
  log_error "config.json no existe: $CONFIG_FILE"
  EXIT_CODE=1
else
  if command -v jq >/dev/null 2>&1; then
    # Verificar que es JSON válido
    if jq empty "$CONFIG_FILE" >/dev/null 2>&1; then
      log_ok "config.json es JSON válido"
      
      # Verificar estructura de ui_map
      if jq -e '.ui_map' "$CONFIG_FILE" >/dev/null 2>&1; then
        log_ok "config.json tiene ui_map"
        
        # Verificar provider
        if jq -e '.ui_map.provider' "$CONFIG_FILE" >/dev/null 2>&1; then
          PROVIDER=$(jq -r '.ui_map.provider' "$CONFIG_FILE" 2>/dev/null || echo "")
          log_ok "config.json.ui_map.provider = $PROVIDER"
        else
          log_warn "config.json.ui_map no tiene provider"
        fi
        
        # Verificar style_url si existe
        if jq -e '.ui_map.style_url' "$CONFIG_FILE" >/dev/null 2>&1; then
          STYLE_URL=$(jq -r '.ui_map.style_url' "$CONFIG_FILE" 2>/dev/null || echo "null")
          if [[ "$STYLE_URL" != "null" ]] && [[ -n "$STYLE_URL" ]]; then
            log_ok "config.json.ui_map.style_url configurada"
          else
            log_info "config.json.ui_map.style_url no está configurada (se usará provider por defecto)"
          fi
        fi
      else
        log_warn "config.json no tiene ui_map"
      fi
    else
      log_error "config.json no es JSON válido"
      EXIT_CODE=1
    fi
  else
    log_warn "jq no está disponible, no se puede validar estructura JSON"
  fi
fi

# 6. Verificar HTTP 200 en /api/maps/test_maptiler
log_info "Verificando endpoint /api/maps/test_maptiler..."
if curl -f -s -X POST "$MAP_TEST_URL" \
  -H "Content-Type: application/json" \
  -d '{"style": "streets-v4", "provider": "maptiler"}' \
  >/dev/null 2>&1; then
  log_ok "Endpoint /api/maps/test_maptiler responde correctamente (HTTP 200)"
else
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$MAP_TEST_URL" \
    -H "Content-Type: application/json" \
    -d '{"style": "streets-v4", "provider": "maptiler"}' 2>/dev/null || echo "000")
  
  if [[ "$HTTP_CODE" == "000" ]]; then
    log_error "Endpoint /api/maps/test_maptiler no responde (conexión fallida)"
  else
    log_error "Endpoint /api/maps/test_maptiler responde con HTTP $HTTP_CODE (esperado 200)"
  fi
  EXIT_CODE=1
fi

# 7. Verificar que el backend está funcionando
log_info "Verificando que el backend esté funcionando..."
if systemctl is-active --quiet "pantalla-dash-backend@${USER_NAME}.service" 2>/dev/null; then
  log_ok "pantalla-dash-backend@${USER_NAME}.service está activo"
  
  # Verificar health endpoint
  if curl -f -s "${BACKEND_URL}/api/health" >/dev/null 2>&1; then
    log_ok "Backend health endpoint responde correctamente"
  else
    log_warn "Backend health endpoint no responde"
    EXIT_CODE=1
  fi
else
  log_error "pantalla-dash-backend@${USER_NAME}.service NO está activo"
  EXIT_CODE=1
fi

# 8. Verificar que Openbox está funcionando
log_info "Verificando que Openbox esté funcionando..."
if systemctl is-active --quiet "pantalla-openbox@${USER_NAME}.service" 2>/dev/null; then
  log_ok "pantalla-openbox@${USER_NAME}.service está activo"
else
  log_error "pantalla-openbox@${USER_NAME}.service NO está activo"
  EXIT_CODE=1
fi

# Resumen
echo ""
if [[ $EXIT_CODE -eq 0 ]]; then
  log_ok "Todas las verificaciones pasaron correctamente"
  exit 0
else
  log_error "Algunas verificaciones fallaron. Revisa los errores arriba."
  exit 1
fi

