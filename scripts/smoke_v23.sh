#!/usr/bin/env bash
set -euo pipefail

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
require_cmd python3

# Determinar usuario del servicio
RUN_USER="${1:-${VERIFY_USER:-${SUDO_USER:-${USER:-}}}}"
if [[ -z "${RUN_USER:-}" ]]; then
  log_error "No se pudo determinar el usuario del servicio"
  exit 1
fi

BACKEND_UNIT="pantalla-dash-backend@${RUN_USER}.service"
API_BASE="${API_BASE:-http://127.0.0.1:8081}"
API_BASE_NGINX="${API_BASE_NGINX:-http://127.0.0.1}"

# Contador de errores
ERRORS=0

# Función para verificar HTTP 200
check_http_200() {
  local url="$1"
  local description="${2:-$url}"
  
  local status
  local body
  
  if ! status=$(curl -sf -o /dev/null -w "%{http_code}" "$url" 2>&1); then
    log_error "Fallo al verificar ${description}: ${status}"
    ((ERRORS++)) || true
    return 1
  fi
  
  if [[ "$status" != "200" ]]; then
    log_error "Fallo al verificar ${description}: HTTP ${status} (esperado 200)"
    ((ERRORS++)) || true
    return 1
  fi
  
  log_success "${description} → HTTP 200"
  return 0
}

# Función para verificar health endpoint
check_health_200() {
  local url="$1"
  local description="${2:-$url}"
  
  if ! python3 -c 'import json, sys, urllib.request, urllib.error
url = sys.argv[1]
try:
    with urllib.request.urlopen(url, timeout=5) as resp:
        status = resp.getcode()
        body_bytes = resp.read()
except Exception as exc:
    print(f"request-error:{exc}", file=sys.stderr)
    sys.exit(2)
body = body_bytes.decode("utf-8", "replace")
try:
    payload = json.loads(body)
except Exception as exc:
    print(f"invalid-json:{exc}", file=sys.stderr)
    sys.exit(1)
if status == 200 and payload.get("status") == "ok":
    sys.exit(0)
print(f"unexpected-response:status={status} body={body}", file=sys.stderr)
sys.exit(1)
' "$url" 2>&1; then
    log_error "Fallo al verificar ${description}: health check no devolvió status=ok"
    ((ERRORS++)) || true
    return 1
  fi
  
  log_success "${description} → HTTP 200, status=ok"
  return 0
}

# Función para subir archivo ICS
upload_ics() {
  local ics_file="$1"
  local url="${API_BASE}/api/config/upload/ics"
  
  if [[ ! -f "$ics_file" ]]; then
    log_error "Archivo ICS no encontrado: ${ics_file}"
    ((ERRORS++)) || true
    return 1
  fi
  
  local status
  local response
  
  if ! response=$(curl -sf -w "\n%{http_code}" -X POST \
    -F "file=@${ics_file}" \
    -F "filename=$(basename "$ics_file")" \
    "$url" 2>&1); then
    log_error "Fallo al subir ICS: ${response}"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Extraer status code (última línea)
  status=$(echo "$response" | tail -n1)
  response=$(echo "$response" | head -n-1)
  
  if [[ "$status" != "200" ]]; then
    log_error "Fallo al subir ICS: HTTP ${status}"
    log_error "Respuesta: ${response}"
    ((ERRORS++)) || true
    return 1
  fi
  
  log_success "ICS subido correctamente → HTTP ${status}"
  return 0
}

# Función para activar layers (radar/aviones/barcos)
activate_layers() {
  local url="${API_BASE}/api/config"
  
  # Obtener configuración actual
  local current_config
  if ! current_config=$(curl -sf "$url" 2>&1); then
    log_error "Fallo al obtener configuración actual"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Parsear y actualizar layers
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
# Asegurar estructura ui_global para radar
if "ui_global" not in config:
    config["ui_global"] = {}
if "radar" not in config["ui_global"]:
    config["ui_global"]["radar"] = {}
config["ui_global"]["radar"]["enabled"] = True
# Asegurar version v2
config["version"] = 2
# Asegurar ui_map
if "ui_map" not in config:
    config["ui_map"] = {}
print(json.dumps(config))
' <<< "$current_config" 2>&1); then
    log_error "Fallo al preparar configuración de layers"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Enviar configuración actualizada
  local status
  local response
  
  if ! response=$(curl -sf -w "\n%{http_code}" -X POST \
    -H "Content-Type: application/json" \
    -d "$updated_config" \
    "$url" 2>&1); then
    log_error "Fallo al actualizar layers: ${response}"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Extraer status code (última línea)
  status=$(echo "$response" | tail -n1)
  response=$(echo "$response" | head -n-1)
  
  if [[ "$status" != "200" ]]; then
    log_error "Fallo al actualizar layers: HTTP ${status}"
    log_error "Respuesta: ${response}"
    ((ERRORS++)) || true
    return 1
  fi
  
  log_success "Layers activados (radar/aviones/barcos) → HTTP ${status}"
  return 0
}

# Función para verificar eventos de calendario >= 1
check_calendar_events() {
  local url="${API_BASE}/api/calendar/events"
  local min_events="${1:-1}"
  
  local events
  local count
  
  if ! events=$(curl -sf "$url" 2>&1); then
    log_error "Fallo al obtener eventos de calendario"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Contar eventos
  if ! count=$(python3 -c 'import json, sys
try:
    data = json.load(sys.stdin)
    if isinstance(data, list):
        count = len(data)
    elif isinstance(data, dict) and "events" in data:
        count = len(data["events"])
    else:
        count = 0
    print(count)
except Exception:
    print(0)
' <<< "$events" 2>&1); then
    log_error "Fallo al parsear eventos de calendario"
    ((ERRORS++)) || true
    return 1
  fi
  
  if [[ "$count" -lt "$min_events" ]]; then
    log_error "Fallo al verificar eventos: ${count} eventos (esperado >= ${min_events})"
    log_error "Respuesta: ${events}"
    ((ERRORS++)) || true
    return 1
  fi
  
  log_success "Eventos de calendario: ${count} >= ${min_events}"
  return 0
}

# Función para verificar calendar.status "ok"
check_calendar_status() {
  local url="${API_BASE}/api/calendar/status"
  
  local response
  local status_value
  
  if ! response=$(curl -sf "$url" 2>&1); then
    log_error "Fallo al verificar calendar status"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Extraer status
  if ! status_value=$(python3 -c 'import json, sys
try:
    data = json.load(sys.stdin)
    print(data.get("status", ""))
except Exception:
    print("")
' <<< "$response" 2>&1); then
    log_error "Fallo al parsear calendar status"
    ((ERRORS++)) || true
    return 1
  fi
  
  if [[ "$status_value" != "ok" ]]; then
    log_error "Fallo al verificar calendar status: ${status_value} (esperado 'ok')"
    log_error "Respuesta: ${response}"
    ((ERRORS++)) || true
    return 1
  fi
  
  log_success "Calendar status: ${status_value}"
  return 0
}

# Crear archivo ICS de prueba si no existe
create_test_ics() {
  local ics_file="${TMPDIR:-/tmp}/test_calendar_v23.ics"
  
  if [[ -f "$ics_file" ]]; then
    echo "$ics_file"
    return 0
  fi
  
  cat > "$ics_file" << 'EOF'
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Calendar v23//EN
BEGIN:VEVENT
UID:test-event-001@v23.local
DTSTART:20250101T100000Z
DTEND:20250101T110000Z
SUMMARY:Test Event v23
DESCRIPTION:Smoke test event for v23
LOCATION:Test Location
END:VEVENT
END:VCALENDAR
EOF
  
  echo "$ics_file"
}

# Ejecutar pruebas
log_info "Iniciando smoke tests E2E v23..."

# 1. Verificar health 200
log_info "Test 1/5: Verificar health 200"
if ! check_health_200 "${API_BASE}/api/health" "Health directo"; then
  log_error "Fallo en verificación de health directo"
fi

# 2. Subir ICS
log_info "Test 2/5: Subir archivo ICS"
TEST_ICS=$(create_test_ics)
if ! upload_ics "$TEST_ICS"; then
  log_error "Fallo en subida de ICS"
fi

# 3. Activar layers (radar/aviones/barcos)
log_info "Test 3/5: Activar layers (radar/aviones/barcos)"
if ! activate_layers; then
  log_error "Fallo en activación de layers"
fi

# 4. Verificar GET /api/calendar/events >= 1 evento
log_info "Test 4/5: Verificar GET /api/calendar/events >= 1 evento"
# Esperar un poco para que el calendario se procese
sleep 2
if ! check_calendar_events 1; then
  log_error "Fallo en verificación de eventos de calendario"
fi

# 5. Verificar calendar.status "ok"
log_info "Test 5/5: Verificar calendar.status 'ok'"
if ! check_calendar_status; then
  log_error "Fallo en verificación de calendar status"
fi

# Resumen
log_info "=========================================="
if [[ $ERRORS -eq 0 ]]; then
  log_success "Todos los smoke tests E2E v23 pasaron correctamente"
  exit 0
else
  log_error "Smoke tests E2E v23 fallaron: ${ERRORS} error(es)"
  exit 1
fi


