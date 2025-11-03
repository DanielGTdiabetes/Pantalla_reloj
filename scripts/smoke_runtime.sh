#!/usr/bin/env bash
set -euo pipefail

# Smoke tests mínimos de runtime post-arranque
# Valida: health 200, calendar/status, config_path correcto

BASE_URL="http://127.0.0.1:8081"
HEALTH_URL="${BASE_URL}/api/health"
CALENDAR_STATUS_URL="${BASE_URL}/api/calendar/status"
CONFIG_URL="${BASE_URL}/api/config"
EXPECTED_CONFIG_PATH="/var/lib/pantalla-reloj/config.json"
ICS_FILE="/var/lib/pantalla-reloj/ics/personal.ics"

log_info() { printf '[smoke] %s\n' "$*"; }
log_error() { printf '[smoke] ERROR: %s\n' "$*" >&2; }
log_ok() { printf '[smoke] OK: %s\n' "$*"; }

EXIT_CODE=0

# Test 1: Health endpoint retorna 200 y status="ok"
log_info "Test 1: Health endpoint"
if HEALTH_RESPONSE=$(curl -sfS --max-time 10 "$HEALTH_URL" 2>/dev/null); then
  if echo "$HEALTH_RESPONSE" | jq -e '.status == "ok"' >/dev/null 2>&1; then
    log_ok "Health endpoint responde con status=ok"
  else
    log_error "Health endpoint no retorna status=ok"
    echo "Respuesta: $HEALTH_RESPONSE"
    EXIT_CODE=1
  fi
else
  HTTP_CODE=$(curl -sfS -o /dev/null -w "%{http_code}" --max-time 10 "$HEALTH_URL" 2>/dev/null || echo "000")
  log_error "Health endpoint no responde (HTTP $HTTP_CODE)"
  EXIT_CODE=1
fi

# Test 2: Calendar status endpoint (si existe personal.ics o no)
log_info "Test 2: Calendar status endpoint"
if CALENDAR_RESPONSE=$(curl -sfS --max-time 10 "$CALENDAR_STATUS_URL" 2>/dev/null); then
  STATUS=$(echo "$CALENDAR_RESPONSE" | jq -r '.status' 2>/dev/null || echo "")
  if [[ "$STATUS" == "ok" ]] || [[ "$STATUS" == "empty" ]] || [[ "$STATUS" == "stale" ]]; then
    log_ok "Calendar status endpoint responde correctamente (status=$STATUS)"
  else
    # Verificar si hay error de proveedor (no debe haber)
    ERROR_MSG=$(echo "$CALENDAR_RESPONSE" | jq -r '.note // .last_error // ""' 2>/dev/null || echo "")
    if [[ -n "$ERROR_MSG" ]] && [[ "$ERROR_MSG" != "OK" ]]; then
      log_error "Calendar status tiene error: $ERROR_MSG"
      EXIT_CODE=1
    else
      log_ok "Calendar status endpoint responde (status=$STATUS)"
    fi
  fi
  
  # Si existe personal.ics, verificar que el endpoint lo detecta
  if [[ -f "$ICS_FILE" ]]; then
    ICS_PATH=$(echo "$CALENDAR_RESPONSE" | jq -r '.ics_path // ""' 2>/dev/null || echo "")
    if [[ -n "$ICS_PATH" ]]; then
      log_ok "Calendar status detecta ICS file ($ICS_PATH)"
    fi
  fi
else
  HTTP_CODE=$(curl -sfS -o /dev/null -w "%{http_code}" --max-time 10 "$CALENDAR_STATUS_URL" 2>/dev/null || echo "000")
  log_error "Calendar status endpoint no responde (HTTP $HTTP_CODE)"
  EXIT_CODE=1
fi

# Test 3: Config endpoint retorna config_path=/var/lib/pantalla-reloj/config.json
log_info "Test 3: Config endpoint - config_path"
if CONFIG_RESPONSE=$(curl -sfS --max-time 10 "$CONFIG_URL" 2>/dev/null); then
  CONFIG_PATH=$(echo "$CONFIG_RESPONSE" | jq -r '.config_path // ""' 2>/dev/null || echo "")
  if [[ "$CONFIG_PATH" == "$EXPECTED_CONFIG_PATH" ]]; then
    log_ok "Config endpoint retorna config_path correcto: $CONFIG_PATH"
  elif [[ -n "$CONFIG_PATH" ]]; then
    log_error "Config endpoint retorna config_path incorrecto: $CONFIG_PATH (esperado: $EXPECTED_CONFIG_PATH)"
    EXIT_CODE=1
  else
    log_error "Config endpoint no incluye config_path"
    EXIT_CODE=1
  fi
  
  # Verificar que no es "default" o "legacy"
  CONFIG_SOURCE=$(echo "$CONFIG_RESPONSE" | jq -r '.config_source // ""' 2>/dev/null || echo "")
  if [[ "$CONFIG_SOURCE" == "default" ]] || [[ "$CONFIG_SOURCE" == "legacy" ]]; then
    log_error "Config endpoint usa config_source legacy/default: $CONFIG_SOURCE"
    EXIT_CODE=1
  fi
else
  HTTP_CODE=$(curl -sfS -o /dev/null -w "%{http_code}" --max-time 10 "$CONFIG_URL" 2>/dev/null || echo "000")
  log_error "Config endpoint no responde (HTTP $HTTP_CODE)"
  EXIT_CODE=1
fi

# Resumen
if [[ $EXIT_CODE -eq 0 ]]; then
  log_ok "Todos los smoke tests pasaron"
  exit 0
else
  log_error "Algunos smoke tests fallaron"
  exit 1
fi

