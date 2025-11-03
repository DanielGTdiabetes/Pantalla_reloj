#!/usr/bin/env bash
set -euo pipefail

log_info() { printf '[verify-startup] %s\n' "$*"; }
log_error() { printf '[verify-startup][ERROR] %s\n' "$*" >&2; }
log_success() { printf '[verify-startup][OK] %s\n' "$*"; }

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log_error "Comando requerido no encontrado: $1"
    exit 1
  fi
}

require_cmd systemctl
require_cmd curl
require_cmd python3

# Determinar usuario del servicio
RUN_USER="${1:-${VERIFY_USER:-${SUDO_USER:-${USER:-}}}}"
if [[ -z "${RUN_USER:-}" ]]; then
  log_error "No se pudo determinar el usuario del servicio"
  exit 1
fi

# Contador de errores
ERRORS=0

# Servicios a verificar
XORG_UNIT="pantalla-xorg.service"
OPENBOX_UNIT="pantalla-openbox@${RUN_USER}.service"
KIOSK_UNIT="pantalla-kiosk@${RUN_USER}.service"
KIOSK_CHROMIUM_UNIT="pantalla-kiosk-chromium@${RUN_USER}.service"
BACKEND_UNIT="pantalla-dash-backend@${RUN_USER}.service"
NGINX_UNIT="nginx.service"
MOSQUITTO_UNIT="mosquitto.service"

API_BASE="${API_BASE:-http://127.0.0.1:8081}"
CONFIG_FILE="${CONFIG_FILE:-/var/lib/pantalla-reloj/config.json}"

# Función para verificar servicio systemd
check_service() {
  local unit="$1"
  local description="${2:-$unit}"
  
  if ! systemctl is-active --quiet "$unit" 2>/dev/null; then
    log_error "Servicio ${description} no está activo"
    log_error "Estado: $(systemctl is-active "$unit" 2>&1 || echo 'unknown')"
    ((ERRORS++)) || true
    return 1
  fi
  
  log_success "Servicio ${description} está activo"
  return 0
}

# Función para verificar endpoint HTTP
check_http_200() {
  local url="$1"
  local description="${2:-$url}"
  
  local status
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

# Función para verificar health endpoint con status=ok
check_health_ok() {
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

# Función para verificar lectura/escritura de config.json
check_config_file() {
  local config_path="$1"
  
  # Verificar que el archivo existe
  if [[ ! -f "$config_path" ]]; then
    log_error "Archivo de configuración no existe: ${config_path}"
    ((ERRORS++)) || true
    return 1
  fi
  
  log_success "Archivo de configuración existe: ${config_path}"
  
  # Verificar que es JSON válido
  if ! python3 -c 'import json, sys
try:
    with open(sys.argv[1], "r") as f:
        json.load(f)
except Exception as exc:
    print(f"invalid-json:{exc}", file=sys.stderr)
    sys.exit(1)
' "$config_path" 2>&1; then
    log_error "Archivo de configuración no es JSON válido: ${config_path}"
    ((ERRORS++)) || true
    return 1
  fi
  
  log_success "Archivo de configuración es JSON válido"
  
  # Verificar permisos de lectura (usuario del servicio)
  if [[ -n "$RUN_USER" ]]; then
    if ! sudo -u "$RUN_USER" test -r "$config_path" 2>/dev/null; then
      log_error "Usuario ${RUN_USER} no puede leer ${config_path}"
      ((ERRORS++)) || true
      return 1
    fi
    log_success "Usuario ${RUN_USER} puede leer ${config_path}"
    
    # Verificar permisos de escritura (usuario del servicio)
    if ! sudo -u "$RUN_USER" test -w "$config_path" 2>/dev/null; then
      log_error "Usuario ${RUN_USER} no puede escribir ${config_path}"
      ((ERRORS++)) || true
      return 1
    fi
    log_success "Usuario ${RUN_USER} puede escribir ${config_path}"
  fi
  
  return 0
}

# Función para verificar timezone en health
check_timezone() {
  local url="$1"
  
  local timezone
  local timezone_config
  
  # Obtener timezone de /api/health
  if ! timezone=$(python3 -c 'import json, sys, urllib.request
url = sys.argv[1]
try:
    with urllib.request.urlopen(url, timeout=5) as resp:
        if resp.getcode() != 200:
            sys.exit(1)
        body = json.loads(resp.read().decode("utf-8"))
        print(body.get("timezone", ""))
except Exception:
    print("", file=sys.stderr)
    sys.exit(1)
' "$url" 2>&1); then
    log_error "Fallo al obtener timezone de ${url}"
    ((ERRORS++)) || true
    return 1
  fi
  
  if [[ -z "$timezone" ]]; then
    log_error "Timezone no está presente en /api/health"
    ((ERRORS++)) || true
    return 1
  fi
  
  log_success "Timezone en /api/health: ${timezone}"
  
  # Obtener timezone de config.json para comparar
  if [[ -f "$CONFIG_FILE" ]]; then
    if ! timezone_config=$(python3 -c 'import json, sys
try:
    with open(sys.argv[1], "r") as f:
        config = json.load(f)
    # Buscar en display.timezone (v2) o display.timezone (v1)
    if isinstance(config, dict):
        if "display" in config and isinstance(config["display"], dict):
            tz = config["display"].get("timezone")
            if tz:
                print(tz)
                sys.exit(0)
    print("", file=sys.stderr)
except Exception:
    print("", file=sys.stderr)
' "$CONFIG_FILE" 2>&1); then
      log_warn "No se pudo leer timezone de config.json para comparar"
    else
      if [[ -n "$timezone_config" ]]; then
        if [[ "$timezone" == "$timezone_config" ]]; then
          log_success "Timezone coincide entre /api/health y config.json: ${timezone}"
        else
          log_error "Timezone no coincide: /api/health=${timezone}, config.json=${timezone_config}"
          ((ERRORS++)) || true
          return 1
        fi
      fi
    fi
  fi
  
  return 0
}

# Función para verificar calendar events con TZ
check_calendar_timezone() {
  local url="$1"
  
  local response
  local has_events
  
  # Obtener eventos de calendario
  if ! response=$(curl -sf "$url" 2>&1); then
    log_error "Fallo al obtener eventos de calendario desde ${url}"
    ((ERRORS++)) || true
    return 1
  fi
  
  # Verificar que es JSON válido y tiene estructura correcta
  if ! has_events=$(python3 -c 'import json, sys
try:
    data = json.load(sys.stdin)
    if isinstance(data, list):
        has_events = len(data) > 0
    elif isinstance(data, dict):
        has_events = "events" in data and len(data.get("events", [])) > 0
    else:
        has_events = False
    print("yes" if has_events else "no")
except Exception:
    print("no")
' <<< "$response" 2>&1); then
    log_error "Fallo al parsear eventos de calendario"
    ((ERRORS++)) || true
    return 1
  fi
  
  if [[ "$has_events" == "yes" ]]; then
    log_success "Eventos de calendario disponibles (>= 1 evento)"
  else
    log_info "Eventos de calendario: vacío (permitido si no hay eventos configurados)"
  fi
  
  return 0
}

# Función para verificar Xorg
check_xorg() {
  log_info "Verificando Xorg..."
  
  # Verificar servicio
  if ! check_service "$XORG_UNIT" "Xorg"; then
    return 1
  fi
  
  # Verificar que DISPLAY está disponible
  if ! sudo -u "$RUN_USER" env DISPLAY=:0 xdpyinfo >/dev/null 2>&1; then
    log_error "DISPLAY=:0 no está disponible o XAUTHORITY no está configurado"
    ((ERRORS++)) || true
    return 1
  fi
  
  log_success "DISPLAY=:0 está disponible"
  return 0
}

# Función para verificar Openbox
check_openbox() {
  log_info "Verificando Openbox..."
  
  if ! check_service "$OPENBOX_UNIT" "Openbox"; then
    return 1
  fi
  
  return 0
}

# Función para verificar Kiosk
check_kiosk() {
  log_info "Verificando Kiosk Browser..."
  
  # Verificar uno de los servicios kiosk (prioridad: kiosk@, luego kiosk-chromium@)
  local kiosk_active=0
  
  if systemctl is-active --quiet "$KIOSK_UNIT" 2>/dev/null; then
    log_success "Servicio ${KIOSK_UNIT} está activo"
    kiosk_active=1
  elif systemctl is-active --quiet "$KIOSK_CHROMIUM_UNIT" 2>/dev/null; then
    log_success "Servicio ${KIOSK_CHROMIUM_UNIT} está activo"
    kiosk_active=1
  else
    log_error "Ningún servicio kiosk está activo (${KIOSK_UNIT} o ${KIOSK_CHROMIUM_UNIT})"
    ((ERRORS++)) || true
    return 1
  fi
  
  return 0
}

# Función para verificar Nginx
check_nginx() {
  log_info "Verificando Nginx..."
  
  if ! check_service "$NGINX_UNIT" "Nginx"; then
    return 1
  fi
  
  # Verificar que nginx -t pasa
  if ! nginx -t >/dev/null 2>&1; then
    log_error "nginx -t falló: configuración de Nginx inválida"
    ((ERRORS++)) || true
    return 1
  fi
  
  log_success "Nginx configuración válida (nginx -t OK)"
  
  # Verificar que responde
  if ! check_http_200 "http://127.0.0.1/ui-healthz" "Nginx ui-healthz"; then
    return 1
  fi
  
  return 0
}

# Función para verificar Backend
check_backend() {
  log_info "Verificando Backend..."
  
  if ! check_service "$BACKEND_UNIT" "Backend"; then
    return 1
  fi
  
  # Verificar health endpoint
  if ! check_health_ok "${API_BASE}/api/health" "Backend health directo"; then
    return 1
  fi
  
  # Verificar health vía Nginx
  if ! check_health_ok "http://127.0.0.1/api/health" "Backend health vía Nginx"; then
    return 1
  fi
  
  return 0
}

# Función para verificar MQTT (opcional)
check_mqtt() {
  log_info "Verificando MQTT (opcional)..."
  
  # Solo verificar si el servicio está presente (no es requerido)
  if systemctl list-units --type=service --all 2>/dev/null | grep -q "^${MOSQUITTO_UNIT}"; then
    if systemctl is-active --quiet "$MOSQUITTO_UNIT" 2>/dev/null; then
      log_success "MQTT (Mosquitto) está activo (opcional)"
    else
      log_info "MQTT (Mosquitto) presente pero no activo (opcional, se activará si se configura Blitzortung)"
    fi
  else
    log_info "MQTT (Mosquitto) no está instalado (opcional, necesario solo para Blitzortung)"
  fi
  
  return 0
}

# Función principal de verificación
main() {
  log_info "=========================================="
  log_info "Iniciando verificación de arranque completa..."
  log_info "Usuario del servicio: ${RUN_USER}"
  log_info "=========================================="
  
  # 1. Verificar Xorg
  log_info ""
  log_info "=== 1/8: Verificar Xorg ==="
  check_xorg || log_error "Fallo en verificación de Xorg"
  
  # 2. Verificar Openbox
  log_info ""
  log_info "=== 2/8: Verificar Openbox ==="
  check_openbox || log_error "Fallo en verificación de Openbox"
  
  # 3. Verificar Kiosk Browser
  log_info ""
  log_info "=== 3/8: Verificar Kiosk Browser ==="
  check_kiosk || log_error "Fallo en verificación de Kiosk"
  
  # 4. Verificar Nginx
  log_info ""
  log_info "=== 4/8: Verificar Nginx ==="
  check_nginx || log_error "Fallo en verificación de Nginx"
  
  # 5. Verificar Backend
  log_info ""
  log_info "=== 5/8: Verificar Backend ==="
  check_backend || log_error "Fallo en verificación de Backend"
  
  # 6. Verificar MQTT (opcional)
  log_info ""
  log_info "=== 6/8: Verificar MQTT (opcional) ==="
  check_mqtt
  
  # 7. Verificar lectura/escritura de config.json
  log_info ""
  log_info "=== 7/8: Verificar lectura/escritura de config.json ==="
  check_config_file "$CONFIG_FILE" || log_error "Fallo en verificación de config.json"
  
  # 8. Verificar TZ reflejado en /api/health y /api/calendar/events
  log_info ""
  log_info "=== 8/8: Verificar TZ reflejado en /api/health y calendario ==="
  check_timezone "${API_BASE}/api/health" || log_error "Fallo en verificación de timezone"
  check_calendar_timezone "${API_BASE}/api/calendar/events" || log_error "Fallo en verificación de calendar events"
  
  # Resumen
  log_info ""
  log_info "=========================================="
  if [[ $ERRORS -eq 0 ]]; then
    log_success "Todas las verificaciones de arranque pasaron correctamente"
    exit 0
  else
    log_error "Verificaciones de arranque fallaron: ${ERRORS} error(es)"
    exit 1
  fi
}

# Ejecutar verificación principal
main

