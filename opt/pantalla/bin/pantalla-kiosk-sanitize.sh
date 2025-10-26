#!/usr/bin/env bash
set -euo pipefail

: "${DISPLAY:=:0}"
: "${XAUTHORITY:=/var/lib/pantalla-reloj/.Xauthority}"

DELAY=0
TIMEOUT=8
POLL_INTERVAL=0.4
WM_CLASS="epiphany.epiphany"
LOG_FILE="/var/log/pantalla/kiosk-sanitize.log"
XDOTOOL_KEY="F11"

log() {
  local ts
  ts="$(date -Is)"
  printf '%s %s\n' "$ts" "$*" >>"$LOG_FILE"
}

usage() {
  cat <<USAGE
Usage: ${0##*/} [--delay SECONDS] [--timeout SECONDS] [--wm-class WMCLASS] [--log FILE]
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --delay)
      DELAY="$2"
      shift 2
      ;;
    --timeout)
      TIMEOUT="$2"
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

[[ -n "$LOG_FILE" ]] || {
  echo "Log file path required" >&2
  exit 1
}

install -d -m 0755 "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"

sleep "$DELAY" 2>/dev/null || sleep 1

if ! command -v wmctrl >/dev/null 2>&1; then
  log "wmctrl-missing"
  exit 0
fi

if [[ ! "$TIMEOUT" =~ ^[0-9]+$ ]]; then
  TIMEOUT="${TIMEOUT%%.*}"
fi
if [[ ! "$TIMEOUT" =~ ^[0-9]+$ ]]; then
  TIMEOUT=0
fi
TIMEOUT=$((TIMEOUT))

normalize_wid() {
  local wid="$1"
  wid="${wid,,}"
  if [[ "$wid" != 0x* ]]; then
    printf '0x%x' "$((16#$wid))"
  else
    printf '%s' "$wid"
  fi
}

declare -gA WINDOW_INFO=()
declare -ga WINDOW_ORDER=()
declare -ga STACKING_IDS=()

read_windows() {
  WINDOW_INFO=()
  WINDOW_ORDER=()
  local line wid cls
  while IFS= read -r line; do
    wid="${line%% *}"
    cls="$(printf '%s' "$line" | awk '{print $3}')"
    if [[ "$cls" == "$WM_CLASS" ]]; then
      wid="$(normalize_wid "$wid")"
      WINDOW_INFO["$wid"]="$line"
      WINDOW_ORDER+=("$wid")
    fi
  done < <(wmctrl -lx 2>/dev/null || true)
}

stacking_primary=""
select_primary_from_stacking() {
  local stacking raw token wid
  stacking_primary=""
  STACKING_IDS=()
  stacking=$(xprop -root _NET_CLIENT_LIST_STACKING 2>/dev/null || true)
  if [[ "$stacking" == *_NET_CLIENT_LIST_STACKING* ]]; then
    raw="${stacking#*_NET_CLIENT_LIST_STACKING(WINDOW): window id # }"
    raw="${raw//,/ }"
    for token in $raw; do
      [[ "$token" =~ 0x[0-9a-fA-F]+ ]] || continue
      wid="$(normalize_wid "$token")"
      STACKING_IDS+=("$wid")
    done
    for (( idx=${#STACKING_IDS[@]}-1; idx>=0; idx-- )); do
      wid="${STACKING_IDS[idx]}"
      if [[ -n "${WINDOW_INFO[$wid]:-}" ]]; then
        stacking_primary="$wid"
        return
      fi
    done
  fi
}

wait_for_window() {
  local deadline=$((SECONDS + TIMEOUT))
  if (( TIMEOUT <= 0 )); then
    read_windows
    return $(( ${#WINDOW_INFO[@]} == 0 ))
  fi
  while (( SECONDS < deadline )); do
    read_windows
    if (( ${#WINDOW_INFO[@]} > 0 )); then
      return 0
    fi
    sleep "$POLL_INTERVAL" 2>/dev/null || sleep 1
  done
  return 1
}

if ! wait_for_window; then
  log "no-window-found timeout=${TIMEOUT}s wmclass=$WM_CLASS"
  exit 0
fi

STACKING_IDS=()
select_primary_from_stacking
primary="${stacking_primary:-${WINDOW_ORDER[-1]}}"
if [[ -z "$primary" ]]; then
  primary="${WINDOW_ORDER[0]}"
fi

log "windows-detected count=${#WINDOW_INFO[@]} primary=${primary}"

for wid in "${WINDOW_ORDER[@]}"; do
  [[ "$wid" == "$primary" ]] && continue
  if wmctrl -i -c "$wid" >/dev/null 2>&1; then
    log "closed-duplicate id=$wid"
  else
    log "close-failed id=$wid"
  fi
  sleep 0.1
done

if ! wmctrl -i -r "$primary" -b add,fullscreen >/dev/null 2>&1; then
  log "fullscreen-failed id=$primary"
  if command -v xdotool >/dev/null 2>&1; then
    if xdotool windowactivate --sync "$primary" key "$XDOTOOL_KEY" >/dev/null 2>&1; then
      log "xdotool-fullscreen id=$primary"
    else
      log "xdotool-failed id=$primary"
    fi
  fi
else
  log "fullscreen-applied id=$primary"
fi

if ! wmctrl -i -R "$primary" >/dev/null 2>&1; then
  log "raise-failed id=$primary"
fi

if ! wmctrl -i -a "$primary" >/dev/null 2>&1; then
  log "focus-failed id=$primary"
else
  log "focus-applied id=$primary"
fi

active=$(xprop -root _NET_ACTIVE_WINDOW 2>/dev/null | awk -F'# ' 'NF>1 {print $2}' | awk '{print $1}' | tr 'A-F' 'a-f')
if [[ -n "$active" && "$active" != "$primary" ]]; then
  if wmctrl -i -a "$primary" >/dev/null 2>&1; then
    log "active-corrected from=$active to=$primary"
  else
    log "active-correction-failed from=$active to=$primary"
  fi
fi

if xprop -id "$primary" _NET_WM_STATE 2>/dev/null | grep -q '_NET_WM_STATE_FULLSCREEN'; then
  log "state-fullscreen id=$primary"
else
  log "state-not-fullscreen id=$primary"
fi

if wmctrl -lx >/dev/null 2>&1; then
  while IFS= read -r line; do
    log "wmctrl ${line}"
  done < <(wmctrl -lx 2>/dev/null || true)
fi

exit 0
