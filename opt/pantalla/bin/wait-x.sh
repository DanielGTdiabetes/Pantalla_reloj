#!/usr/bin/env bash
set -euo pipefail

: "${DISPLAY:?DISPLAY must be set}"
: "${XAUTHORITY:?XAUTHORITY must be set}"

i=1; attempts=30
while (( i<=attempts )); do
  if DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" xset q >/dev/null 2>&1; then
    exit 0
  fi
  printf '[wait-x] %(%H:%M:%S)T intento %d/%d\n' -1 "$i" "$attempts"
  sleep 0.5
  ((i++))
done
echo "[wait-x] DISPLAY $DISPLAY no disponible tras $attempts intentos" >&2
exit 1
