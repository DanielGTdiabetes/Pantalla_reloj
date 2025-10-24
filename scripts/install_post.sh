#!/usr/bin/env bash
set -euo pipefail

log(){ printf "\033[1;34m[INFO]\033[0m %s\n" "$*"; }
warn(){ printf "\033[1;33m[WARN]\033[0m %s\n" "$*"; }
err(){ printf "\033[1;31m[ERR ]\033[0m %s\n" "$*" >&2; }

target_user="${1:-${SUDO_USER:-${USER}}}"

wait_for_http() {
  local host="$1"
  local port="$2"
  local path="$3"
  local timeout="${4:-30}"
  local start
  start=$(date +%s)
  local delay=2
  local code=""
  while true; do
    code=$(curl -s -o /dev/null -w "%{http_code}" "http://${host}:${port}${path}" || true)
    if [[ "$code" == "200" ]]; then
      return 0
    fi
    local now
    now=$(date +%s)
    if (( now - start >= timeout )); then
      warn "No se obtuvo 200 en http://${host}:${port}${path} tras ${timeout}s (último código: ${code:-N/A})"
      return 1
    fi
    sleep "$delay"
    if (( delay < 5 )); then
      delay=$((delay + 1))
    fi
  done
}

as_root() {
  if [[ $(id -u) -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

log "Habilitando linger para ${target_user}…"
if ! as_root loginctl enable-linger "$target_user"; then
  warn "No se pudo habilitar linger para ${target_user} (posible falta de systemd)"
fi

SYSTEMD_USER_AVAILABLE=1
if ! systemctl --user show-environment >/dev/null 2>&1; then
  SYSTEMD_USER_AVAILABLE=0
  warn "systemd --user no disponible en esta sesión; omitiendo unidades de usuario"
fi

if (( SYSTEMD_USER_AVAILABLE )); then
  systemctl --user daemon-reload || warn "daemon-reload (usuario) falló"
  if systemctl --user list-unit-files pantalla-ui.service >/dev/null 2>&1; then
    systemctl --user enable --now pantalla-ui.service || warn "No se pudo activar pantalla-ui.service"
  else
    warn "Unidad pantalla-ui.service no encontrada en systemd --user"
  fi
  if systemctl --user list-unit-files blitz_mqtt_relay.service >/dev/null 2>&1; then
    systemctl --user enable --now blitz_mqtt_relay.service || warn "No se pudo activar blitz_mqtt_relay.service"
  else
    log "Unidad blitz_mqtt_relay.service no presente; se omite"
  fi
else
  warn "Sesión sin systemd --user; ejecuta este script tras iniciar sesión gráfica"
fi

log "Asegurando Mosquitto activo…"
if ! as_root systemctl enable --now mosquitto; then
  warn "No se pudo activar mosquitto (¿systemd disponible?)"
fi

BACKEND_READY=0
if wait_for_http 127.0.0.1 8081 /api/health 60; then
  BACKEND_READY=1
  log "Backend operativo en http://127.0.0.1:8081"
else
  warn "Backend no respondió 200 tras el tiempo de espera"
fi

if (( BACKEND_READY )); then
  log "Precargando endpoints principales…"
  curl -fsS http://127.0.0.1:8081/api/season/month >/dev/null || true
  curl -fsS http://127.0.0.1:8081/api/news/headlines >/dev/null || true
  curl -fsS http://127.0.0.1:8081/api/backgrounds/current >/dev/null || true
  RESP_WITH_CODE="$(curl -sS -w '\n%{http_code}' http://127.0.0.1:8081/api/config || true)"
  RESP_CODE="${RESP_WITH_CODE##*$'\n'}"
  RESP_BODY="${RESP_WITH_CODE%$'\n'*}"
  if [[ "$RESP_CODE" == "200" ]]; then
    if command -v jq >/dev/null 2>&1; then
      if echo "$RESP_BODY" | jq . >/dev/null 2>&1; then
        log "Configuración backend accesible"
      else
        warn "Respuesta /api/config no es JSON válido"
      fi
    else
      warn "jq no disponible; se omite validación de /api/config"
    fi
  else
    warn "/api/config devolvió ${RESP_CODE:-N/A}; se omite validación JSON"
  fi
else
  warn "Se omite la precarga de endpoints porque el backend no está listo"
fi

log "Resumen rápido:"
if (( BACKEND_READY )); then
  echo "  ✅ Backend accesible en 8081"
else
  echo "  ⚠️ Backend no respondió"
fi
if (( SYSTEMD_USER_AVAILABLE )); then
  if systemctl --user is-active pantalla-ui.service >/dev/null 2>&1; then
    echo "  ✅ UI (systemd --user) activa"
  else
    echo "  ⚠️ pantalla-ui.service no activa"
  fi
else
  echo "  ⚠️ systemd --user no disponible"
fi
if as_root systemctl is-active mosquitto >/dev/null 2>&1; then
  echo "  ✅ Mosquitto activo"
else
  echo "  ⚠️ Mosquitto no activo"
fi

log "install_post completado."
