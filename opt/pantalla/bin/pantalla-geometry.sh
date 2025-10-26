#!/usr/bin/env bash
set -euo pipefail

OUTPUT="HDMI-1"
MODE="480x1920"
FRAMEBUFFER="480x1920"
ROTATE="left"
WAIT_X="/opt/pantalla/bin/wait-x.sh"
LOG_FILE="/var/log/pantalla/geometry.log"
DISABLE_DPMS=1
WAIT_FOR_X=0

usage() {
  cat <<USAGE
Usage: ${0##*/} [--output NAME] [--mode WxH] [--framebuffer WxH] [--rotate left|right|normal|inverted] \
                 [--log FILE] [--no-dpms] [--wait]
USAGE
}

log() {
  local ts msg
  ts="$(date -Is)"
  msg="$*"
  install -d -m 0755 "$(dirname "$LOG_FILE")" >/dev/null 2>&1 || true
  printf '%s %s\n' "$ts" "$msg" >>"$LOG_FILE"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      OUTPUT="$2"
      shift 2
      ;;
    --mode)
      MODE="$2"
      shift 2
      ;;
    --framebuffer|--fb)
      FRAMEBUFFER="$2"
      shift 2
      ;;
    --rotate)
      ROTATE="$2"
      shift 2
      ;;
    --log)
      LOG_FILE="$2"
      shift 2
      ;;
    --no-dpms)
      DISABLE_DPMS=0
      shift
      ;;
    --wait)
      WAIT_FOR_X=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

: "${DISPLAY:?DISPLAY must be set}"
: "${XAUTHORITY:?XAUTHORITY must be set}"

if ! command -v xrandr >/dev/null 2>&1; then
  log "xrandr-missing"
  exit 0
fi

if (( DISABLE_DPMS )) && ! command -v xset >/dev/null 2>&1; then
  log "xset-missing"
  DISABLE_DPMS=0
fi

if (( WAIT_FOR_X )); then
  if [[ -x "$WAIT_X" ]]; then
    log "waiting-for-x display=$DISPLAY"
    if ! DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" "$WAIT_X" >/dev/null 2>&1; then
      log "wait-x failed display=$DISPLAY"
    fi
  else
    log "wait-x-missing path=$WAIT_X"
  fi
fi

run_xrandr() {
  local desc
  desc="$1"
  shift
  local output status
  output=$(DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" xrandr "$@" 2>&1) || status=$?
  status=${status:-0}
  if (( status != 0 )); then
    log "xrandr-error step=${desc} status=${status} output=${output//$'\n'/ }"
  else
    if [[ -n "$output" ]]; then
      log "xrandr-step step=${desc} output=${output//$'\n'/ }"
    else
      log "xrandr-step step=${desc} status=ok"
    fi
  fi
  printf '%s' "$output"
  return "$status"
}

log "geometry-start output=$OUTPUT mode=$MODE fb=$FRAMEBUFFER rotate=$ROTATE"

if ! run_xrandr "mode" --output "$OUTPUT" --mode "$MODE" --rotate "$ROTATE" --primary --pos 0x0; then
  log "mode-error"
fi

sleep 0.3

if ! run_xrandr "framebuffer" --fb "$FRAMEBUFFER"; then
  log "framebuffer-error"
fi

sleep 0.2

if (( DISABLE_DPMS )); then
  if DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" xset -dpms >/dev/null 2>&1; then
    log "dpms=off"
  else
    log "dpms-error action=-dpms"
  fi
  if DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" xset s off >/dev/null 2>&1; then
    log "screensaver=off"
  else
    log "screensaver-error action=off"
  fi
  if DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" xset s noblank >/dev/null 2>&1; then
    log "screensaver=noblank"
  else
    log "screensaver-error action=noblank"
  fi
fi

if xrandr_state=$(DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" xrandr --query 2>/dev/null); then
  while IFS= read -r line; do
    log "xrandr-query ${line}"
  done <<<"$xrandr_state"
else
  log "xrandr-query-error"
fi

log "geometry-complete"
