#!/usr/bin/env bash
set -uo pipefail

DELAY=4
WM_CLASS="org.gnome.Epiphany.WebApp_PantallaReloj"
LOG_FILE="/var/log/pantalla/kiosk-sanitize.log"

log() {
  local ts
  ts="$(date -Is)"
  printf '%s %s\n' "$ts" "$*" >>"$LOG_FILE"
}

usage() {
  cat <<USAGE
Usage: pantalla-kiosk-sanitize.sh [--delay SECONDS] [--wm-class WMCLASS] [--log FILE]
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --delay)
      DELAY="$2"
      shift 2
      ;;
    --wm-class)
      WM_CLASS="$2"
      shift 2
      ;;
    --log)
      LOG_FILE="$2"
      shift 2
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

if [[ -z "$LOG_FILE" ]]; then
  echo "Log file path required" >&2
  exit 1
fi

install -d -m 0755 "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"

sleep "$DELAY" 2>/dev/null || sleep 4

wmctrl -lx >/dev/null 2>&1 || {
  log "wmctrl no disponible"
  exit 0
}

mapfile -t windows < <(wmctrl -lx | awk -v cls="$WM_CLASS" '$3 == cls {print $1":"$0}')
count=${#windows[@]}

if (( count == 0 )); then
  log "sin-ventanas wmclass=$WM_CLASS"
  exit 0
fi

primary="${windows[0]%%:*}"

if (( count > 1 )); then
  for ((i = 1; i < count; i++)); do
    wid="${windows[i]%%:*}"
    if wmctrl -i -c "$wid" >/dev/null 2>&1; then
      log "cerrada-duplicada id=$wid"
    else
      log "error-cerrar id=$wid"
    fi
  done
fi

if wmctrl -i -r "$primary" -b add,fullscreen >/dev/null 2>&1; then
  log "fullscreen id=$primary"
else
  log "error-fullscreen id=$primary"
fi

if wmctrl -i -a "$primary" >/dev/null 2>&1; then
  log "focus id=$primary"
else
  log "error-focus id=$primary"
fi

exit 0
