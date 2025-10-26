#!/usr/bin/env bash
set -euo pipefail

OUTPUT="HDMI-1"
MODE="480x1920"
FRAMEBUFFER="480x1920"
ROTATE="left"
WM_CLASS="epiphany.epiphany"
LOG_FILE="/var/log/pantalla/kiosk-watchdog.log"
GEOMETRY_SCRIPT="/opt/pantalla/bin/pantalla-geometry.sh"
SANITIZER="/opt/pantalla/bin/pantalla-kiosk-sanitize.sh"
SANITIZE_LOG="/var/log/pantalla/kiosk-sanitize.log"
WAIT_X="/opt/pantalla/bin/wait-x.sh"
DISABLE_FILE="${PANTALLA_WATCHDOG_DISABLE_FILE:-/var/lib/pantalla-reloj/state/disable-kiosk-watchdog}"

: "${DISPLAY:=:0}"
: "${XAUTHORITY:=/var/lib/pantalla-reloj/.Xauthority}"

install -d -m 0755 "$(dirname "$LOG_FILE")" >/dev/null 2>&1 || true

log() {
  local ts
  ts="$(date -Is)"
  printf '%s %s\n' "$ts" "$*" >>"$LOG_FILE"
}

if [[ -e "$DISABLE_FILE" ]]; then
  log "skip disable-file=${DISABLE_FILE}"
  exit 0
fi

if [[ -x "$WAIT_X" ]]; then
  DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" "$WAIT_X" >/dev/null 2>&1 || true
fi

for cmd in xrandr wmctrl xprop; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    log "dependency-missing cmd=${cmd}"
    exit 0
  fi
done

geometry_needs_fix=0
windows_need_fix=0

xrandr_output=$(DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" xrandr --query 2>/dev/null || echo "")
current_line=$(printf '%s\n' "$xrandr_output" | awk -v o="$OUTPUT" '$1==o && $2=="connected" {print $4}')
if [[ "$current_line" != "${MODE}+0+0" ]]; then
  geometry_needs_fix=1
  log "geometry-mismatch line=${current_line:-missing} expected=${MODE}+0+0"
fi

rotation_line=$(DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" xrandr --verbose --output "$OUTPUT" 2>/dev/null | awk -F': ' '/Rotation:/ {print $2; exit}' || true)
rotation_state="${rotation_line%% *}"
if [[ -n "$rotation_state" && "$rotation_state" != "$ROTATE" ]]; then
  geometry_needs_fix=1
  log "rotation-mismatch current=${rotation_state} expected=${ROTATE}"
fi

panning_state=$(DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" xrandr --verbose --output "$OUTPUT" 2>/dev/null | awk -F': ' '/Panning:/ {print $2; exit}' || true)
if [[ -n "$panning_state" && "$panning_state" != "0x0+0+0" ]]; then
  geometry_needs_fix=1
  log "geometry-panning-detected value=${panning_state}"
fi

mapfile -t windows < <(DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" wmctrl -lx 2>/dev/null | awk -v cls="$WM_CLASS" '$3 == cls {print $1}' || true)
count=${#windows[@]}

if (( count == 0 )); then
  windows_need_fix=1
  log "windows-missing class=${WM_CLASS}"
elif (( count > 1 )); then
  windows_need_fix=1
  log "windows-duplicates count=${count}"
else
  wid="${windows[0]}"
  if ! DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" xprop -id "$wid" _NET_WM_STATE 2>/dev/null | grep -q '_NET_WM_STATE_FULLSCREEN'; then
    windows_need_fix=1
    log "window-not-fullscreen id=${wid}"
  fi
  active=$(DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" xprop -root _NET_ACTIVE_WINDOW 2>/dev/null | awk -F'# ' 'NF>1 {print $2}' | awk '{print $1}')
  if [[ -n "$active" && "$active" != "$wid" ]]; then
    windows_need_fix=1
    log "window-not-active id=${wid} active=${active}"
  fi
fi

if (( geometry_needs_fix )); then
  if [[ -x "$GEOMETRY_SCRIPT" ]]; then
    DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" "$GEOMETRY_SCRIPT" >/dev/null 2>&1
    log "geometry-reapplied"
  else
    log "geometry-script-missing path=$GEOMETRY_SCRIPT"
  fi
fi

if (( windows_need_fix )); then
  if [[ -x "$SANITIZER" ]]; then
    "$SANITIZER" --delay 1 --wm-class "$WM_CLASS" --log "$SANITIZE_LOG" &
    log "sanitizer-invoked"
  else
    log "sanitizer-missing path=$SANITIZER"
  fi
fi

if (( ! geometry_needs_fix && ! windows_need_fix )); then
  log "watchdog-ok"
fi
