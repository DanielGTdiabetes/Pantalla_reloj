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

# Función para verificar /api/weather/now
check_weather_now() {
  local url="${API_BASE}/api/weather/now"
  
  local response
  local status
  
  if ! response=$(curl -sf -w "\n%{http_code}" "$url" 2>&1); then
    log_error "Fallo al obtener weather/now: ${response}"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Extraer status code (última línea)
  status=$(echo "$response" | tail -n1)
  response=$(echo "$response" | head -n-1)
  
  if [[ "$status" != "200" ]]; then
    log_error "Fallo al verificar weather/now: HTTP ${status} (esperado 200)"
    log_error "Respuesta: ${response}"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Verificar que no es un 500 (permitir vacío pero no errores del servidor)
  if ! python3 -c 'import json, sys
try:
    data = json.load(sys.stdin)
    # Si es un dict con "error" o "detail", es un error
    if isinstance(data, dict) and ("error" in data or ("detail" in data and "500" in str(data.get("detail", "")))):
        sys.exit(1)
except Exception as exc:
    # Si no puede parsear JSON, puede ser error HTML
    if "500" in sys.stdin.read():
        sys.exit(1)
' <<< "$response" 2>&1; then
    log_error "weather/now devolvió error del servidor (500)"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Verificar que tiene iconKey o está vacío (permitir ambos casos)
  if ! python3 -c 'import json, sys
try:
    data = json.load(sys.stdin)
    # Si es dict, debe tener estructura válida o estar vacío
    # No verificamos contenido específico, solo que no sea 500
    pass
except Exception:
    pass
' <<< "$response" 2>&1; then
    log_success "weather/now → HTTP ${status} (sin 500)"
  else
    log_success "weather/now → HTTP ${status}"
  fi
  
  return 0
}

# Función para verificar /api/weather/weekly
check_weather_weekly() {
  local url="${API_BASE}/api/weather/weekly"
  
  local response
  local status
  
  if ! response=$(curl -sf -w "\n%{http_code}" "$url" 2>&1); then
    log_error "Fallo al obtener weather/weekly: ${response}"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Extraer status code (última línea)
  status=$(echo "$response" | tail -n1)
  response=$(echo "$response" | head -n-1)
  
  if [[ "$status" != "200" ]]; then
    log_error "Fallo al verificar weather/weekly: HTTP ${status} (esperado 200)"
    log_error "Respuesta: ${response}"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Verificar que no es un 500
  if ! python3 -c 'import json, sys
try:
    data = json.load(sys.stdin)
    if isinstance(data, dict) and ("error" in data or ("detail" in data and "500" in str(data.get("detail", "")))):
        sys.exit(1)
except Exception:
    if "500" in sys.stdin.read():
        sys.exit(1)
' <<< "$response" 2>&1; then
    log_error "weather/weekly devolvió error del servidor (500)"
    ((ERRORS++)) || true
    return 1
  fi
  
  log_success "weather/weekly → HTTP ${status} (sin 500)"
  return 0
}

# Función para verificar /api/ephemerides
check_ephemerides() {
  local url="${API_BASE}/api/ephemerides"
  
  local response
  local status
  
  if ! response=$(curl -sf -w "\n%{http_code}" "$url" 2>&1); then
    log_error "Fallo al obtener ephemerides: ${response}"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Extraer status code (última línea)
  status=$(echo "$response" | tail -n1)
  response=$(echo "$response" | head -n-1)
  
  if [[ "$status" != "200" ]]; then
    log_error "Fallo al verificar ephemerides: HTTP ${status} (esperado 200)"
    log_error "Respuesta: ${response}"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Verificar que no es un 500 (permitir vacío pero no errores del servidor)
  if ! python3 -c 'import json, sys
try:
    data = json.load(sys.stdin)
    if isinstance(data, dict) and ("error" in data or ("detail" in data and "500" in str(data.get("detail", "")))):
        sys.exit(1)
except Exception:
    if "500" in sys.stdin.read():
        sys.exit(1)
' <<< "$response" 2>&1; then
    log_error "ephemerides devolvió error del servidor (500)"
    ((ERRORS++)) || true
    return 1
  fi
  
  log_success "ephemerides → HTTP ${status} (sin 500, permite vacío)"
  return 0
}

# Función para verificar /api/saints
check_saints() {
  local url="${API_BASE}/api/saints"
  
  local response
  local status
  
  if ! response=$(curl -sf -w "\n%{http_code}" "$url" 2>&1); then
    log_error "Fallo al obtener saints: ${response}"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Extraer status code (última línea)
  status=$(echo "$response" | tail -n1)
  response=$(echo "$response" | head -n-1)
  
  if [[ "$status" != "200" ]]; then
    log_error "Fallo al verificar saints: HTTP ${status} (esperado 200)"
    log_error "Respuesta: ${response}"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Verificar que no es un 500 (permitir vacío pero no errores del servidor)
  if ! python3 -c 'import json, sys
try:
    data = json.load(sys.stdin)
    if isinstance(data, dict) and ("error" in data or ("detail" in data and "500" in str(data.get("detail", "")))):
        sys.exit(1)
except Exception:
    if "500" in sys.stdin.read():
        sys.exit(1)
' <<< "$response" 2>&1; then
    log_error "saints devolvió error del servidor (500)"
    ((ERRORS++)) || true
    return 1
  fi
  
  log_success "saints → HTTP ${status} (sin 500, permite vacío)"
  return 0
}

# Función para verificar efemérides históricas status
check_efemerides_status() {
  local url="${API_BASE}/api/efemerides/status"
  
  local response
  local status_value
  
  if ! response=$(curl -sf "$url" 2>&1); then
    log_error "Fallo al verificar efemerides status"
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
    log_error "Fallo al parsear efemerides status"
    ((ERRORS++)) || true
    return 1
  fi
  
  if [[ "$status_value" != "ok" ]] && [[ "$status_value" != "missing" ]]; then
    log_error "Fallo al verificar efemerides status: ${status_value} (esperado 'ok' o 'missing')"
    log_error "Respuesta: ${response}"
    ((ERRORS++)) || true
    return 1
  fi
  
  log_success "Efemerides status: ${status_value}"
  return 0
}

# Función para verificar efemérides del día actual
check_efemerides_today() {
  local url="${API_BASE}/api/efemerides"
  
  local response
  local status
  local count
  
  if ! response=$(curl -sf -w "\n%{http_code}" "$url" 2>&1); then
    log_error "Fallo al obtener efemerides: ${response}"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Extraer status code (última línea)
  status=$(echo "$response" | tail -n1)
  response=$(echo "$response" | head -n-1)
  
  if [[ "$status" != "200" ]]; then
    log_error "Fallo al verificar efemerides: HTTP ${status} (esperado 200)"
    log_error "Respuesta: ${response}"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Extraer count
  if ! count=$(python3 -c 'import json, sys
try:
    data = json.load(sys.stdin)
    print(data.get("count", 0))
except Exception:
    print(0)
' <<< "$response" 2>&1); then
    log_error "Fallo al parsear efemerides count"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Permitir count >= 0 (puede estar vacío si no hay datos para hoy)
  log_success "Efemerides del día: count=${count} → HTTP ${status}"
  return 0
}

# Función para subir archivo JSON de efemérides
upload_efemerides_json() {
  local json_file="$1"
  local url="${API_BASE}/api/efemerides/upload"
  
  if [[ ! -f "$json_file" ]]; then
    log_error "Archivo JSON de efemérides no encontrado: ${json_file}"
    ((ERRORS++)) || true
    return 1
  fi
  
  local status
  local response
  
  if ! response=$(curl -sf -w "\n%{http_code}" -X POST \
    -F "file=@${json_file}" \
    "$url" 2>&1); then
    log_error "Fallo al subir JSON de efemerides: ${response}"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Extraer status code (última línea)
  status=$(echo "$response" | tail -n1)
  response=$(echo "$response" | head -n-1)
  
  if [[ "$status" != "200" ]]; then
    log_error "Fallo al subir JSON de efemerides: HTTP ${status}"
    log_error "Respuesta: ${response}"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Verificar que la respuesta contiene "ok": true
  if ! python3 -c 'import json, sys
try:
    data = json.load(sys.stdin)
    if not data.get("ok", False):
        sys.exit(1)
except Exception:
    sys.exit(1)
' <<< "$response" 2>&1; then
    log_error "Fallo al verificar respuesta de upload: ok != true"
    log_error "Respuesta: ${response}"
    ((ERRORS++)) || true
    return 1
  fi
  
  log_success "JSON de efemerides subido correctamente → HTTP ${status}"
  return 0
}

# Función para verificar que overlay tiene historicalEvents habilitado
check_overlay_has_historical() {
  local url="${API_BASE}/api/config"
  
  local response
  local has_historical
  
  if ! response=$(curl -sf "$url" 2>&1); then
    log_error "Fallo al obtener config para verificar historicalEvents"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Verificar que existe panels.historicalEvents.enabled
  if ! has_historical=$(python3 -c 'import json, sys
try:
    data = json.load(sys.stdin)
    panels = data.get("panels", {})
    historical = panels.get("historicalEvents", {})
    enabled = historical.get("enabled", False)
    print("yes" if enabled else "no")
except Exception:
    print("no")
' <<< "$response" 2>&1); then
    log_error "Fallo al parsear config para historicalEvents"
    ((ERRORS++)) || true
    return 1
  fi
  
  if [[ "$has_historical" != "yes" ]]; then
    log_error "Config no tiene panels.historicalEvents.enabled == true"
    ((ERRORS++)) || true
    return 1
  fi
  
  log_success "Config tiene panels.historicalEvents.enabled == true"
  return 0
}

# Función para verificar overlay en /api/config
check_overlay_config() {
  local url="${API_BASE}/api/config"
  
  local response
  local has_overlay
  
  if ! response=$(curl -sf "$url" 2>&1); then
    log_error "Fallo al obtener config para verificar overlay"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Verificar que existe bloque ui_overlay o ui_global.overlay
  if ! has_overlay=$(python3 -c 'import json, sys
try:
    data = json.load(sys.stdin)
    # Verificar ui_overlay (v1 legacy) o ui_global.overlay (v2)
    if "ui_overlay" in data or (isinstance(data.get("ui_global"), dict) and "overlay" in data.get("ui_global", {})):
        print("yes")
    else:
        print("no")
except Exception:
    print("no")
' <<< "$response" 2>&1); then
    log_error "Fallo al parsear config para overlay"
    ((ERRORS++)) || true
    return 1
  fi
  
  if [[ "$has_overlay" != "yes" ]]; then
    log_error "Config no contiene bloque overlay (ui_overlay o ui_global.overlay)"
    ((ERRORS++)) || true
    return 1
  fi
  
  log_success "Config contiene bloque overlay coherente"
  return 0
}

# Crear archivo JSON de efemérides de prueba si no existe
create_test_efemerides_json() {
  local json_file="${TMPDIR:-/tmp}/test_efemerides_v23.json"
  
  if [[ -f "$json_file" ]]; then
    echo "$json_file"
    return 0
  fi
  
  cat > "$json_file" << 'EOF'
{
  "01-01": [
    "1959: Fidel Castro toma el poder en Cuba.",
    "1993: Entra en vigor el Tratado de Maastricht."
  ],
  "11-03": [
    "1957: Se lanza el Sputnik 2 con Laika, el primer ser vivo en orbitar la Tierra.",
    "1992: Firma del Tratado de Maastricht que establece la Unión Europea."
  ],
  "12-25": [
    "1066: Coronación de Guillermo el Conquistador como rey de Inglaterra.",
    "1991: Dimisión de Mikhail Gorbachev, fin de la Unión Soviética."
  ]
}
EOF
  
  echo "$json_file"
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
log_info "Test 1/13: Verificar health 200"
if ! check_health_200 "${API_BASE}/api/health" "Health directo"; then
  log_error "Fallo en verificación de health directo"
fi

# 2. Subir ICS
log_info "Test 2/13: Subir archivo ICS"
TEST_ICS=$(create_test_ics)
if ! upload_ics "$TEST_ICS"; then
  log_error "Fallo en subida de ICS"
fi

# 3. Activar layers (radar/aviones/barcos)
log_info "Test 3/13: Activar layers (radar/aviones/barcos)"
if ! activate_layers; then
  log_error "Fallo en activación de layers"
fi

# 4. Verificar GET /api/calendar/events >= 1 evento
log_info "Test 4/13: Verificar GET /api/calendar/events >= 1 evento"
# Esperar un poco para que el calendario se procese
sleep 2
if ! check_calendar_events 1; then
  log_error "Fallo en verificación de eventos de calendario"
fi

# 5. Verificar calendar.status "ok"
log_info "Test 5/13: Verificar calendar.status 'ok'"
if ! check_calendar_status; then
  log_error "Fallo en verificación de calendar status"
fi

# 6. Verificar /api/weather/now
log_info "Test 6/13: Verificar /api/weather/now (sin 500)"
if ! check_weather_now; then
  log_error "Fallo en verificación de weather/now"
fi

# 7. Verificar /api/weather/weekly
log_info "Test 7/13: Verificar /api/weather/weekly (sin 500)"
if ! check_weather_weekly; then
  log_error "Fallo en verificación de weather/weekly"
fi

# 8. Verificar /api/ephemerides
log_info "Test 8/13: Verificar /api/ephemerides (sin 500, permite vacío)"
if ! check_ephemerides; then
  log_error "Fallo en verificación de ephemerides"
fi

# 9. Verificar /api/saints
log_info "Test 9/13: Verificar /api/saints (sin 500, permite vacío)"
if ! check_saints; then
  log_error "Fallo en verificación de saints"
fi

# 10. Verificar efemerides status
log_info "Test 10/13: Verificar GET /api/efemerides/status"
if ! check_efemerides_status; then
  log_error "Fallo en verificación de efemerides status"
fi

# 11. Verificar efemerides del día actual
log_info "Test 11/13: Verificar GET /api/efemerides (del día actual)"
if ! check_efemerides_today; then
  log_error "Fallo en verificación de efemerides del día"
fi

# 12. Subir archivo JSON de efemérides
log_info "Test 12/13: Subir archivo JSON de efemérides"
TEST_EFEMERIDES_JSON=$(create_test_efemerides_json)
if ! upload_efemerides_json "$TEST_EFEMERIDES_JSON"; then
  log_error "Fallo en subida de JSON de efemerides"
fi

# 13. Verificar que overlay tiene historicalEvents habilitado
log_info "Test 13/13: Verificar overlay tiene historicalEvents habilitado"
# Esperar un poco para que el config se actualice
sleep 1
if ! check_overlay_has_historical; then
  log_error "Fallo en verificación de historicalEvents en overlay"
fi

# 14. Verificar overlay en /api/config
log_info "Test 14/14: Verificar overlay en /api/config"
if ! check_overlay_config; then
  log_error "Fallo en verificación de overlay config"
fi

# Resumen
log_info "=========================================="
if [[ $ERRORS -eq 0 ]]; then
  log_success "Todos los smoke tests E2E v23 pasaron correctamente (14/14)"
  exit 0
else
  log_error "Smoke tests E2E v23 fallaron: ${ERRORS} error(es) de 14 tests"
  exit 1
fi


