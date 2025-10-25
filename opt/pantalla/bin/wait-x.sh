#!/usr/bin/env bash
set -euxo pipefail

: "${DISPLAY:?DISPLAY must be set}"
: "${XAUTHORITY:?XAUTHORITY must be set}"

log() {
  printf '%(%H:%M:%S)T wait-x: %s\n' -1 "$*"
}

attempts=30
sleep_interval=0.5
last_error=""

for ((i=1; i<=attempts; i++)); do
  if output=$(xset q 2>&1); then
    log "DISPLAY ${DISPLAY} is ready (attempt ${i})"
    exit 0
  fi
  last_error="$output"
  log "Attempt ${i} failed; retrying after ${sleep_interval}s"
  sleep "${sleep_interval}"
done

log "Failed to reach DISPLAY ${DISPLAY} after ${attempts} attempts"
if [[ -n "${last_error}" ]]; then
  printf '%s\n' "${last_error}" >&2
fi
exit 1
