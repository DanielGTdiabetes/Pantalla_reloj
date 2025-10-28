#!/usr/bin/env bash
set -euo pipefail

SCRIPT_NAME="verify_kiosk"

log() {
  printf '[%s] %s\n' "$SCRIPT_NAME" "$*"
}

warn() {
  printf '[%s][WARN] %s\n' "$SCRIPT_NAME" "$*" >&2
}

err() {
  printf '[%s][ERROR] %s\n' "$SCRIPT_NAME" "$*" >&2
}

usage() {
  cat <<'USAGE'
Pantalla reloj quick kiosk verifier

Usage:
  verify_kiosk.sh [options]

Options:
  --skip-gpu-check        Skip the temporary WebGL check window.
  --skip-window-check     Skip geometry/state checks (useful in headless CI).
  --gpu-wait <seconds>    Wait time before sampling the GPU check window (default: 6).
  --gpu-url <url>         Override gpu-check URL (default: http://127.0.0.1/gpu-check.html).
  -h, --help              Show this message.
USAGE
}

GPU_CHECK=1
WINDOW_CHECK=1
GPU_WAIT=6
GPU_URL="http://127.0.0.1/gpu-check.html"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-gpu-check)
      GPU_CHECK=0
      shift
      ;;
    --skip-window-check)
      WINDOW_CHECK=0
      shift
      ;;
    --gpu-wait)
      GPU_WAIT="$2"
      shift 2
      ;;
    --gpu-url)
      GPU_URL="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      err "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

: "${KIOSK_USER:=${USER:-$(id -un)}}"
: "${DISPLAY:=:0}"
: "${XAUTHORITY:=/home/${KIOSK_USER}/.Xauthority}"

LAUNCHER="/usr/local/bin/pantalla-kiosk-chromium"
if [[ ! -x "$LAUNCHER" ]]; then
  err "Launcher ${LAUNCHER} no encontrado o no ejecutable"
  exit 1
fi

CHROMIUM_BIN="$($LAUNCHER --print-bin 2>/dev/null || true)"
if [[ -z "$CHROMIUM_BIN" ]]; then
  err "No se pudo resolver el binario de Chromium via launcher"
  exit 1
fi

log "Chromium binario resuelto: ${CHROMIUM_BIN}"

cleanup_gpu_check() {
  local profile_dir="$1" cache_dir="$2"
  if [[ -n "$profile_dir" && -d "$profile_dir" ]]; then
    rm -rf "$profile_dir"
  fi
  if [[ -n "$cache_dir" && -d "$cache_dir" ]]; then
    rm -rf "$cache_dir"
  fi
}

run_gpu_check() {
  local profile_dir cache_dir app_pid window_id title status="unknown"
  profile_dir=$(mktemp -d /tmp/pantalla-gpu-profile.XXXXXX)
  cache_dir=$(mktemp -d /tmp/pantalla-gpu-cache.XXXXXX)
  trap 'cleanup_gpu_check "$profile_dir" "$cache_dir"' EXIT

  local ts
  ts="$(date +%s)"
  log "Lanzando verificación WebGL temporal (${GPU_WAIT}s)"

  DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" "$CHROMIUM_BIN" \
    --class=pantalla-gpu-check \
    --app="${GPU_URL}?t=${ts}" \
    --no-first-run --no-default-browser-check \
    --disable-session-crashed-bubble --noerrdialogs \
    --user-data-dir="$profile_dir" \
    --disk-cache-dir="$cache_dir" \
    --autoplay-policy=no-user-gesture-required \
    --test-type \
    --enable-logging=stderr \
    --allow-insecure-localhost \
    --ignore-gpu-blocklist \
    --remote-debugging-port=0 \
    >/tmp/pantalla-gpu-check.log 2>&1 &
  app_pid=$!

  sleep "$GPU_WAIT"

  if command -v wmctrl >/dev/null 2>&1; then
    local wm_output
    wm_output=$(DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" wmctrl -lx 2>/dev/null || true)
    window_id=$(awk '/pantalla-gpu-check/{print $1; exit}' <<<"$wm_output")
    if [[ -n "$window_id" ]]; then
      if command -v xprop >/dev/null 2>&1; then
        title=$(DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" xprop -id "$window_id" WM_NAME 2>/dev/null || true)
        status=$(sed -n 's/^WM_NAME(STRING) = "\(.*\)"/\1/p' <<<"$title" | awk '{print tolower($0)}')
      else
        warn "xprop no disponible para leer el título del chequeo GPU"
      fi
    else
      warn "No se detectó ventana de chequeo GPU"
    fi
  else
    warn "wmctrl no disponible; se omite lectura de ventana GPU"
  fi

  if [[ -n "$app_pid" ]]; then
    if ps -p "$app_pid" >/dev/null 2>&1; then
      kill "$app_pid" >/dev/null 2>&1 || true
      sleep 1
    fi
  fi
  pkill -f "$profile_dir" >/dev/null 2>&1 || true
  rm -f /tmp/pantalla-gpu-check.log >/dev/null 2>&1 || true

  trap - EXIT
  cleanup_gpu_check "$profile_dir" "$cache_dir"

  if [[ "$status" == *"ok"* ]]; then
    log "Chequeo WebGL: OK (${status})"
    return 0
  fi

  warn "Chequeo WebGL no confirmó soporte (status='${status:-desconocido}')"
  return 1
}

check_window_state() {
  if ! command -v wmctrl >/dev/null 2>&1; then
    warn "wmctrl no disponible; se omite verificación de ventana"
    return 1
  fi

  local wm_output window_id geometry state_output width height
  wm_output=$(DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" wmctrl -lx 2>/dev/null || true)
  if [[ -z "$wm_output" ]]; then
    warn "wmctrl no devolvió ventanas"
    return 1
  fi
  window_id=$(awk '/pantalla-kiosk/{print $1; exit}' <<<"$wm_output")
  if [[ -z "$window_id" ]]; then
    warn "No se encontró ventana con clase pantalla-kiosk"
    return 1
  fi

  log "Ventana kiosk detectada: ${window_id}"

  if command -v xwininfo >/dev/null 2>&1; then
    geometry=$(DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" xwininfo -id "$window_id" 2>/dev/null || true)
    width=$(awk '/Width:/{print $2}' <<<"$geometry" | head -n1)
    height=$(awk '/Height:/{print $2}' <<<"$geometry" | head -n1)
    if [[ -n "$width" && -n "$height" ]]; then
      log "Geometría: ${width}x${height}"
    fi
  else
    warn "xwininfo no disponible"
  fi

  if command -v xprop >/dev/null 2>&1; then
    state_output=$(DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" xprop -id "$window_id" _NET_WM_STATE 2>/dev/null || true)
    if grep -Eq 'FULLSCREEN' <<<"$state_output"; then
      log "Estado: FULLSCREEN detectado"
    else
      warn "FULLSCREEN no presente en _NET_WM_STATE"
    fi
    if grep -Eq 'ABOVE' <<<"$state_output"; then
      log "Estado: ABOVE detectado"
    else
      warn "ABOVE no presente en _NET_WM_STATE"
    fi
  else
    warn "xprop no disponible"
  fi

  return 0
}

if [[ $WINDOW_CHECK -eq 1 ]]; then
  check_window_state || warn "Verificación de ventana incompleta"
fi

if [[ $GPU_CHECK -eq 1 ]]; then
  if ! run_gpu_check; then
    warn "Considere crear /var/lib/pantalla-reloj/state/.force-swiftshader para forzar SwiftShader"
  fi
fi

log "Verificación finalizada"
