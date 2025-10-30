#!/usr/bin/env bash
set -euo pipefail

TARGET_USER="${1:-dani}"
SVC="pantalla-kiosk-chromium@${TARGET_USER}.service"

echo "== Environment del servicio =="
if ! systemctl show "$SVC" -p Environment; then
  echo "(systemctl show falló para ${SVC})" >&2
fi

echo
echo "== Proceso Chromium =="
mapfile -t pids < <(pgrep -u "$TARGET_USER" -f 'chromium.*--app=' 2>/dev/null || true)
if (( ${#pids[@]} > 0 )); then
  for pid in "${pids[@]}"; do
    echo "PID: $pid"
    if [[ -r "/proc/${pid}/cmdline" ]]; then
      echo "-- cmdline --"
      tr '\0' ' ' <"/proc/${pid}/cmdline"
      echo
    fi
    if [[ -r "/proc/${pid}/environ" ]]; then
      echo "-- environ --"
      tr '\0' '\n' <"/proc/${pid}/environ" | sort | sed -n '1,80p'
    fi
    echo
  done
else
  echo "No se encontró proceso Chromium del kiosk para ${TARGET_USER}."
fi

echo "== Logs [diagnostics:auto-pan] (20s) =="
if ! timeout 20s journalctl -u "$SVC" -f --no-pager | grep --line-buffered 'diagnostics:auto-pan'; then
  echo "(No se encontraron logs recientes de diagnostics:auto-pan)"
fi
echo "== Fin diagnóstico =="
