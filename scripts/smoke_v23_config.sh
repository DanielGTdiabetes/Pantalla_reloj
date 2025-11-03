#!/usr/bin/env bash
set -euo pipefail

# Smoke test para validación E2E de /config y calendario ICS
# Verifica: health, ICS upload, calendar config, toggles (radar/flights/ships), assertions JSON

log_info() { printf '[smoke] %s\n' "$*"; }
log_error() { printf '[smoke][ERROR] %s\n' "$*" >&2; }
log_success() { printf '[smoke][OK] %s\n' "$*"; }

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log_error "Comando requerido no encontrado: $1"
    exit 1
  fi
}

require_cmd curl
require_cmd jq
require_cmd python3

# Determinar usuario del servicio
RUN_USER="${1:-${VERIFY_USER:-${SUDO_USER:-${USER:-}}}}"
if [[ -z "${RUN_USER:-}" ]]; then
  log_error "No se pudo determinar el usuario del servicio"
  exit 1
fi

API_BASE="${API_BASE:-http://127.0.0.1:8081}"

# Rutas
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ICS_FILE="${PROJECT_ROOT}/backend/tests/data/sample.ics"

# Contador de errores
ERRORS=0

# Función para verificar health endpoint
check_health_ok() {
  local url="${API_BASE}/api/health"
  local description="${1:-Health endpoint}"
  
  local response
  local status
  
  if ! response=$(curl -sf -w "\n%{http_code}" "$url" 2>&1); then
    log_error "Fallo al verificar ${description}: ${response}"
    ((ERRORS++)) || true
    return 1
  fi
  
  status=$(echo "$response" | tail -n1)
  response=$(echo "$response" | head -n-1)
  
  if [[ "$status" != "200" ]]; then
    log_error "Fallo al verificar ${description}: HTTP ${status}"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Verificar que el body contiene "ok"
  if ! echo "$response" | jq -e '.status == "ok"' >/dev/null 2>&1; then
    log_error "Fallo al verificar ${description}: status no es 'ok'"
    log_error "Respuesta: ${response}"
    ((ERRORS++)) || true
    return 1
  fi
  
  log_success "${description} → HTTP ${status}, status=ok"
  return 0
}

# Función para subir archivo ICS
upload_ics_file() {
  local ics_file="$1"
  local url="${API_BASE}/api/config/upload/ics"
  
  if [[ ! -f "$ics_file" ]]; then
    log_error "Archivo ICS no encontrado: ${ics_file}"
    ((ERRORS++)) || true
    return 1
  fi
  
  local response
  local status
  local ics_path
  
  if ! response=$(curl -sf -w "\n%{http_code}" -X POST \
    -F "file=@${ics_file}" \
    "$url" 2>&1); then
    log_error "Fallo al subir ICS: ${response}"
    ((ERRORS++)) || true
    return 1
  fi
  
  status=$(echo "$response" | tail -n1)
  response=$(echo "$response" | head -n-1)
  
  if [[ "$status" != "200" ]]; then
    log_error "Fallo al subir ICS: HTTP ${status}"
    log_error "Respuesta: ${response}"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Extraer ics_path de la respuesta
  if ! ics_path=$(echo "$response" | jq -r '.path // empty' 2>/dev/null); then
    log_error "Fallo al extraer ics_path de respuesta"
    ((ERRORS++)) || true
    return 1
  fi
  
  if [[ -z "$ics_path" ]]; then
    log_error "Respuesta no contiene ics_path"
    log_error "Respuesta: ${response}"
    ((ERRORS++)) || true
    return 1
  fi
  
  log_success "ICS subido correctamente → HTTP ${status}, path=${ics_path}"
  echo "$ics_path"
  return 0
}

# Función para configurar calendario ICS via POST /api/config
configure_ics_calendar() {
  local ics_path="$1"
  local url="${API_BASE}/api/config"
  
  # Obtener configuración actual
  local current_config
  if ! current_config=$(curl -sf "$url" 2>&1); then
    log_error "Fallo al obtener configuración actual"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Actualizar configuración para activar ICS
  local updated_config
  if ! updated_config=$(python3 -c 'import json, sys
config = json.load(sys.stdin)
ics_path = sys.argv[1]
# Asegurar estructura panels.calendar
if "panels" not in config:
    config["panels"] = {}
if "calendar" not in config["panels"]:
    config["panels"]["calendar"] = {}
config["panels"]["calendar"]["enabled"] = True
config["panels"]["calendar"]["provider"] = "ics"
config["panels"]["calendar"]["ics_path"] = ics_path
# Asegurar version v2
config["version"] = 2
print(json.dumps(config))
' "$ics_path" <<< "$current_config" 2>&1); then
    log_error "Fallo al preparar configuración de calendario ICS"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Enviar configuración actualizada
  local response
  local status
  
  if ! response=$(curl -sf -w "\n%{http_code}" -X POST \
    -H "Content-Type: application/json" \
    -d "$updated_config" \
    "$url" 2>&1); then
    log_error "Fallo al actualizar configuración de calendario: ${response}"
    ((ERRORS++)) || true
    return 1
  fi
  
  status=$(echo "$response" | tail -n1)
  response=$(echo "$response" | head -n-1)
  
  if [[ "$status" != "200" ]]; then
    log_error "Fallo al actualizar configuración de calendario: HTTP ${status}"
    log_error "Respuesta: ${response}"
    ((ERRORS++)) || true
    return 1
  fi
  
  log_success "Calendario ICS configurado → HTTP ${status}"
  return 0
}

# Función para verificar calendar status
check_calendar_status() {
  local url="${API_BASE}/api/calendar/status"
  
  local response
  local status_value
  
  if ! response=$(curl -sf "$url" 2>&1); then
    log_error "Fallo al verificar calendar status"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Extraer status (debe ser "ok" o "empty", no "error")
  if ! status_value=$(echo "$response" | jq -r '.status // "error"' 2>/dev/null); then
    log_error "Fallo al parsear calendar status"
    ((ERRORS++)) || true
    return 1
  fi
  
  if [[ "$status_value" == "error" ]]; then
    log_error "Calendar status tiene error: ${status_value}"
    local error_msg
    error_msg=$(echo "$response" | jq -r '.note // .last_error // "unknown error"' 2>/dev/null || echo "unknown error")
    log_error "Mensaje de error: ${error_msg}"
    ((ERRORS++)) || true
    return 1
  fi
  
  if [[ "$status_value" != "ok" ]] && [[ "$status_value" != "empty" ]]; then
    log_error "Calendar status inesperado: ${status_value} (esperado 'ok' o 'empty')"
    ((ERRORS++)) || true
    return 1
  fi
  
  log_success "Calendar status: ${status_value}"
  return 0
}

# Función para activar toggles (radar, flights, ships)
activate_toggles() {
  local url="${API_BASE}/api/config"
  
  # Obtener configuración actual
  local current_config
  if ! current_config=$(curl -sf "$url" 2>&1); then
    log_error "Fallo al obtener configuración actual para toggles"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Actualizar configuración para activar toggles
  local updated_config
  if ! updated_config=$(python3 -c 'import json, sys
config = json.load(sys.stdin)
# Asegurar estructura layers
if "layers" not in config:
    config["layers"] = {}
# Activar flights
if "flights" not in config["layers"]:
    config["layers"]["flights"] = {}
config["layers"]["flights"]["enabled"] = True
# Activar ships
if "ships" not in config["layers"]:
    config["layers"]["ships"] = {}
config["layers"]["ships"]["enabled"] = True
# Activar radar (intentar ui_global primero, luego layers.global)
if "ui_global" not in config:
    config["ui_global"] = {}
if "radar" not in config["ui_global"]:
    config["ui_global"]["radar"] = {}
config["ui_global"]["radar"]["enabled"] = True
# Si existe layers.global.radar también activarlo
if "layers" in config:
    if "global" not in config["layers"]:
        config["layers"]["global"] = {}
    if "radar" not in config["layers"]["global"]:
        config["layers"]["global"]["radar"] = {}
    config["layers"]["global"]["radar"]["enabled"] = True
# Asegurar version v2
config["version"] = 2
print(json.dumps(config))
' <<< "$current_config" 2>&1); then
    log_error "Fallo al preparar configuración de toggles"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Enviar configuración actualizada
  local response
  local status
  
  if ! response=$(curl -sf -w "\n%{http_code}" -X POST \
    -H "Content-Type: application/json" \
    -d "$updated_config" \
    "$url" 2>&1); then
    log_error "Fallo al actualizar toggles: ${response}"
    ((ERRORS++)) || true
    return 1
  fi
  
  status=$(echo "$response" | tail -n1)
  response=$(echo "$response" | head -n-1)
  
  if [[ "$status" != "200" ]]; then
    log_error "Fallo al actualizar toggles: HTTP ${status}"
    log_error "Respuesta: ${response}"
    ((ERRORS++)) || true
    return 1
  fi
  
  log_success "Toggles activados (radar/flights/ships) → HTTP ${status}"
  return 0
}

# Función para verificar configuración con jq (sin tocar otras claves)
verify_config_assertions() {
  local url="${API_BASE}/api/config"
  
  local config_response
  
  if ! config_response=$(curl -sf "$url" 2>&1); then
    log_error "Fallo al obtener configuración para verificación"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Verificar que layers.flights.enabled == true
  if ! echo "$config_response" | jq -e '.layers.flights.enabled == true' >/dev/null 2>&1; then
    log_error "Fallo: layers.flights.enabled no es true"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Verificar que layers.ships.enabled == true
  if ! echo "$config_response" | jq -e '.layers.ships.enabled == true' >/dev/null 2>&1; then
    log_error "Fallo: layers.ships.enabled no es true"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Verificar que radar está activado (ui_global.radar.enabled o layers.global.radar.enabled)
  local radar_enabled=false
  if echo "$config_response" | jq -e '.ui_global.radar.enabled == true' >/dev/null 2>&1; then
    radar_enabled=true
  elif echo "$config_response" | jq -e '.layers.global.radar.enabled == true' >/dev/null 2>&1; then
    radar_enabled=true
  fi
  
  if [[ "$radar_enabled" != "true" ]]; then
    log_error "Fallo: radar no está activado (ni ui_global.radar.enabled ni layers.global.radar.enabled)"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Verificar que panels.calendar.provider == "ics"
  if ! echo "$config_response" | jq -e '.panels.calendar.provider == "ics"' >/dev/null 2>&1; then
    log_error "Fallo: panels.calendar.provider no es 'ics'"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Verificar que panels.calendar.enabled == true
  if ! echo "$config_response" | jq -e '.panels.calendar.enabled == true' >/dev/null 2>&1; then
    log_error "Fallo: panels.calendar.enabled no es true"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Verificar que panels.calendar.ics_path existe y no está vacío
  local ics_path
  if ! ics_path=$(echo "$config_response" | jq -r '.panels.calendar.ics_path // empty' 2>/dev/null); then
    log_error "Fallo: no se pudo extraer panels.calendar.ics_path"
    ((ERRORS++)) || true
    return 1
  fi
  
  if [[ -z "$ics_path" ]]; then
    log_error "Fallo: panels.calendar.ics_path está vacío"
    ((ERRORS++)) || true
    return 1
  fi
  
  log_success "Aserciones JSON verificadas (flights/ships/radar/calendar.ics)"
  return 0
}

# Ejecutar pruebas
log_info "Iniciando smoke tests de /config y calendario ICS..."

# Test 1: Verificar health
log_info "Test 1/7: Verificar GET /api/health → 'ok'"
if ! check_health_ok "Health endpoint"; then
  log_error "Fallo en verificación de health"
fi

# Test 2: Subir ICS
log_info "Test 2/7: Subir tests/data/sample.ics a /api/config/upload/ics"
ICS_PATH=""
if ! ICS_PATH=$(upload_ics_file "$ICS_FILE"); then
  log_error "Fallo en subida de ICS"
fi

if [[ -z "$ICS_PATH" ]]; then
  log_error "No se obtuvo ics_path de la subida"
  ((ERRORS++)) || true
fi

# Test 3: Configurar calendario ICS via POST /api/config
log_info "Test 3/7: POST /api/config para provider=ics y ics_path (merge)"
if [[ -n "$ICS_PATH" ]]; then
  if ! configure_ics_calendar "$ICS_PATH"; then
    log_error "Fallo en configuración de calendario ICS"
  fi
else
  log_error "Omitiendo configuración de calendario ICS (ics_path no disponible)"
  ((ERRORS++)) || true
fi

# Test 4: Verificar calendar status
log_info "Test 4/7: GET /api/calendar/status → status en 'ok' o 'empty' (no error)"
sleep 2  # Esperar un poco para que el calendario se procese
if ! check_calendar_status; then
  log_error "Fallo en verificación de calendar status"
fi

# Test 5: Activar toggles
log_info "Test 5/7: Activar toggles (radar ON, flights ON, ships ON)"
if ! activate_toggles; then
  log_error "Fallo en activación de toggles"
fi

# Test 6: Verificar configuración con jq
log_info "Test 6/7: GET /api/config y aserciones JSON con jq"
if ! verify_config_assertions; then
  log_error "Fallo en verificación de aserciones JSON"
fi

# Resumen
log_info "=========================================="
if [[ $ERRORS -eq 0 ]]; then
  log_success "Todos los smoke tests de /config y calendario ICS pasaron correctamente"
  exit 0
else
  log_error "Smoke tests fallaron: ${ERRORS} error(es)"
  exit 1
fi

