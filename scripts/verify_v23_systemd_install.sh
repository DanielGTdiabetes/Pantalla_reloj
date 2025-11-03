#!/usr/bin/env bash
# Script de verificación para alineación systemd/installer v23
# Verifica que el backend arranca correctamente con StateDirectory y UMask
set -euo pipefail

USERNAME="${1:-dani}"
BACKEND_SERVICE="pantalla-dash-backend@${USERNAME}.service"
HEALTH_URL="http://127.0.0.1:8081/api/health"

log_info() { printf '[INFO] %s\n' "$*"; }
log_ok() { printf '[OK]   %s\n' "$*"; }
log_error() { printf '[ERROR] %s\n' "$*" >&2; }
log_warn() { printf '[WARN] %s\n' "$*"; }

log_info "Verificando instalación v23 para usuario: ${USERNAME}"

# 1. Verificar daemon-reload
log_info "1. Ejecutando systemctl daemon-reload..."
if systemctl daemon-reload; then
    log_ok "daemon-reload completado"
else
    log_error "daemon-reload falló"
    exit 1
fi

# 2. Verificar unit systemd
log_info "2. Verificando configuración de unit systemd..."
if ! systemctl cat "$BACKEND_SERVICE" >/dev/null 2>&1; then
    log_error "No se encuentra unit $BACKEND_SERVICE"
    exit 1
fi

if ! systemctl cat "$BACKEND_SERVICE" | grep -q 'StateDirectory=pantalla-reloj'; then
    log_error "StateDirectory=pantalla-reloj no encontrado en unit"
    exit 1
fi
log_ok "StateDirectory configurado"

if ! systemctl cat "$BACKEND_SERVICE" | grep -q 'UMask=0077'; then
    log_error "UMask=0077 no encontrado en unit"
    exit 1
fi
log_ok "UMask configurado"

# 3. Verificar directorios con permisos correctos
log_info "3. Verificando directorios..."
STATE_DIR="/var/lib/pantalla-reloj"
ICS_DIR="${STATE_DIR}/ics"

if [[ ! -d "$STATE_DIR" ]]; then
    log_error "Directorio $STATE_DIR no existe"
    exit 1
fi

# Verificar permisos del directorio principal
DIR_PERMS=$(stat -c '%a' "$STATE_DIR")
if [[ "$DIR_PERMS" != "700" ]]; then
    log_warn "Permisos de $STATE_DIR son $DIR_PERMS (esperado: 700)"
    log_warn "Esto es normal si se creó via tmpfiles.d antes de iniciar el servicio"
else
    log_ok "Permisos de $STATE_DIR: 700"
fi

# Verificar directorio ICS
if [[ ! -d "$ICS_DIR" ]]; then
    log_error "Directorio $ICS_DIR no existe"
    exit 1
fi
log_ok "Directorio ICS existe: $ICS_DIR"

ICS_PERMS=$(stat -c '%a' "$ICS_DIR")
if [[ "$ICS_PERMS" != "700" ]]; then
    log_warn "Permisos de $ICS_DIR son $ICS_PERMS (esperado: 700)"
else
    log_ok "Permisos de $ICS_DIR: 700"
fi

# Verificar archivo ICS semilla
ICS_FILE="${ICS_DIR}/personal.ics"
if [[ ! -f "$ICS_FILE" ]]; then
    log_warn "Archivo $ICS_FILE no existe"
else
    log_ok "Archivo ICS semilla existe: $ICS_FILE"
    FILE_PERMS=$(stat -c '%a' "$ICS_FILE")
    if [[ "$FILE_PERMS" != "644" ]]; then
        log_warn "Permisos de $ICS_FILE son $FILE_PERMS (esperado: 644)"
    else
        log_ok "Permisos de $ICS_FILE: 644"
    fi
fi

# 4. Verificar venv y dependencias
log_info "4. Verificando venv y dependencias..."
VENV_PATH="/opt/pantalla-reloj/backend/.venv"
if [[ ! -d "$VENV_PATH" ]]; then
    log_error "Venv no encontrado en $VENV_PATH"
    exit 1
fi
log_ok "Venv existe"

PYTHON_BIN="${VENV_PATH}/bin/python"
if [[ ! -x "$PYTHON_BIN" ]]; then
    log_error "Python del venv no es ejecutable"
    exit 1
fi

# Verificar dependencias críticas
MISSING_DEPS=()
"$PYTHON_BIN" -c "import fastapi" 2>/dev/null || MISSING_DEPS+=("fastapi")
"$PYTHON_BIN" -c "import uvicorn" 2>/dev/null || MISSING_DEPS+=("uvicorn")
"$PYTHON_BIN" -c "import multipart" 2>/dev/null || MISSING_DEPS+=("python-multipart")
"$PYTHON_BIN" -c "import icalendar" 2>/dev/null || MISSING_DEPS+=("icalendar")

if [[ ${#MISSING_DEPS[@]} -gt 0 ]]; then
    log_error "Dependencias faltantes: ${MISSING_DEPS[*]}"
    exit 1
fi
log_ok "Dependencias Python validadas"

# 5. Verificar launcher backend
log_info "5. Verificando launcher backend..."
LAUNCHER="/usr/local/bin/pantalla-backend-launch"
if [[ ! -x "$LAUNCHER" ]]; then
    log_error "Launcher no encontrado o no ejecutable: $LAUNCHER"
    exit 1
fi
log_ok "Launcher existe y es ejecutable"

# 6. Verificar que el backend está activo y reiniciarlo
log_info "6. Verificando estado del backend..."
if systemctl is-active --quiet "$BACKEND_SERVICE"; then
    log_ok "Backend está activo"
    log_info "Reiniciando backend para verificar arranque limpio..."
    if systemctl restart "$BACKEND_SERVICE"; then
        log_ok "Restart completado"
    else
        log_error "Restart falló"
        exit 1
    fi
else
    log_warn "Backend no está activo, iniciando..."
    if systemctl start "$BACKEND_SERVICE"; then
        log_ok "Backend iniciado"
    else
        log_error "No se pudo iniciar el backend"
        exit 1
    fi
fi

# 7. Esperar arranque y verificar health
log_info "7. Esperando arranque completo (2s)..."
sleep 2

log_info "Verificando /api/health..."
if ! curl -sfS "$HEALTH_URL" >/dev/null; then
    log_error "Backend no responde en $HEALTH_URL"
    log_warn "Estado del servicio:"
    systemctl --no-pager -l status "$BACKEND_SERVICE" | head -20 || true
    if [[ -f /tmp/backend-launch.log ]]; then
        log_warn "Últimos logs de /tmp/backend-launch.log:"
        tail -n 30 /tmp/backend-launch.log || true
    fi
    log_warn "Últimos logs de journalctl:"
    journalctl --no-pager -n 50 -u "$BACKEND_SERVICE" || true
    exit 1
fi
log_ok "Backend responde en /api/health"

# 8. Verificar payload de health con jq
log_info "8. Verificando payload de health..."
if ! command -v jq >/dev/null 2>&1; then
    log_warn "jq no disponible, omitiendo verificación de payload JSON"
else
    HEALTH_STATUS=$(curl -sfS "$HEALTH_URL" | jq -r '.status // empty')
    if [[ "$HEALTH_STATUS" != "ok" ]]; then
        log_warn "Health status es: $HEALTH_STATUS (esperado: ok)"
    else
        log_ok "Health status: ok"
    fi
    
    # Verificar que calendar esté presente en el payload
    CALENDAR_PROVIDER=$(curl -sfS "$HEALTH_URL" | jq -r '.calendar.provider // empty')
    if [[ -z "$CALENDAR_PROVIDER" ]]; then
        log_warn "Campo calendar.provider no presente en health response"
    else
        log_ok "Campo calendar presente con provider: $CALENDAR_PROVIDER"
    fi
fi

log_ok "Verificación completa"
log_info "Backend arrancado correctamente con StateDirectory y UMask 0077"

