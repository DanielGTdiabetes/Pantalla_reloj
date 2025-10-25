#!/usr/bin/env bash
set -euo pipefail

export DISPLAY=:0
export XAUTHORITY=/var/lib/pantalla-reloj/.Xauthority

if [[ -z "${XDG_RUNTIME_DIR:-}" ]]; then
  uid="$(id -u)"
  export XDG_RUNTIME_DIR="/run/user/${uid}"
fi

if [[ ! -r "$XAUTHORITY" ]]; then
  printf '[ERROR] XAUTHORITY not readable at %s\n' "$XAUTHORITY" >&2
  exit 1
fi

printf 'DISPLAY=%s\n' "$DISPLAY"
printf 'XAUTHORITY=%s\n' "$XAUTHORITY"
printf 'XDG_RUNTIME_DIR=%s\n' "$XDG_RUNTIME_DIR"
