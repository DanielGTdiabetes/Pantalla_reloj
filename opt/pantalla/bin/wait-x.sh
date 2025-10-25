#!/usr/bin/env bash
set -euxo pipefail
: "${DISPLAY:?}"; : "${XAUTHORITY:?}"
for i in $(seq 1 30); do
  if DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" xset q >/dev/null 2>&1; then
    exit 0
  fi
  printf '[wait-x] %(%H:%M:%S)T intento %d/30\n' -1 "$i"
  sleep 0.5
done
echo "[wait-x] timeout esperando DISPLAY=$DISPLAY"
exit 1
