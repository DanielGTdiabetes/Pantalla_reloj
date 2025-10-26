#!/usr/bin/env bash
set -uo pipefail

FIRST_DELAY=1.5
SECOND_DELAY=5
WM_CLASS="org.gnome.Epiphany.WebApp_PantallaReloj"
LOG_FILE="/var/log/pantalla/kiosk-sanitize.log"

log() {
  local ts
  ts="$(date -Is)"
  printf '%s %s\n' "$ts" "$*" >>"$LOG_FILE"
}

usage() {
  cat <<USAGE
Usage: pantalla-kiosk-sanitize.sh [--first-delay SECONDS] [--second-delay SECONDS] [--wm-class WMCLASS] [--log FILE]
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --first-delay)
      FIRST_DELAY="$2"
      shift 2
      ;;
    --second-delay)
      SECOND_DELAY="$2"
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

sanitize_once() {
  local attempt="$1"

  wmctrl -lx >/dev/null 2>&1 || {
    log "wmctrl no disponible"
    return 0
  }

  mapfile -t windows < <(wmctrl -lx | awk -v cls="$WM_CLASS" '$3 == cls {print $1":"$0}')
  local count=${#windows[@]}

  if (( count == 0 )); then
    log "sin-ventanas attempt=$attempt wmclass=$WM_CLASS"
    return 0
  fi

  local primary="${windows[count-1]%%:*}"

  if (( count > 1 )); then
    for ((i = 0; i < count - 1; i++)); do
      local wid="${windows[i]%%:*}"
      if wmctrl -i -c "$wid" >/dev/null 2>&1; then
        log "cerrada-duplicada attempt=$attempt id=$wid"
      else
        log "error-cerrar attempt=$attempt id=$wid"
      fi
    done
  fi

  if wmctrl -i -r "$primary" -b add,fullscreen >/dev/null 2>&1; then
    log "fullscreen attempt=$attempt id=$primary"
  else
    log "error-fullscreen attempt=$attempt id=$primary"
  fi

  if wmctrl -i -R "$primary" >/dev/null 2>&1; then
    log "raise attempt=$attempt id=$primary"
  else
    log "error-raise attempt=$attempt id=$primary"
  fi

  if wmctrl -i -a "$primary" >/dev/null 2>&1; then
    log "focus attempt=$attempt id=$primary"
  else
    log "error-focus attempt=$attempt id=$primary"
  fi
}

sleep "$FIRST_DELAY" 2>/dev/null || sleep 2
sanitize_once 1

second_wait=$(awk -v second="$SECOND_DELAY" -v first="$FIRST_DELAY" 'BEGIN {d=second-first; if (d < 0) d = 0; printf "%s", d}')
if [[ -n "$second_wait" && "$second_wait" != "0" ]]; then
  sleep "$second_wait" 2>/dev/null || sleep 3
  sanitize_once 2
fi

if wmctrl -lx >/dev/null 2>&1; then
  while IFS= read -r line; do
    log "wmctrl ${line}"
  done < <(wmctrl -lx)
fi

exit 0
