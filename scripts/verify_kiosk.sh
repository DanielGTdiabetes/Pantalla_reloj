#!/usr/bin/env bash
set -euo pipefail

DISPLAY="${DISPLAY:-:0}"
XAUTHORITY="${XAUTHORITY:-}" 
if [[ -z "$XAUTHORITY" ]]; then
  if [[ -n "${VERIFY_USER:-}" ]]; then
    XAUTHORITY="/home/${VERIFY_USER}/.Xauthority"
  elif [[ -n "${SUDO_USER:-}" ]]; then
    XAUTHORITY="/home/${SUDO_USER}/.Xauthority"
  else
    XAUTHORITY="/home/${USER}/.Xauthority"
  fi
fi

wmctrl_output=""
wmctrl_status=1
if command -v wmctrl >/dev/null 2>&1; then
  if wmctrl_output=$(DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" wmctrl -lx 2>/dev/null); then
    wmctrl_status=0
  else
    wmctrl_status=$?
  fi
fi

match_line=""
match_class=""
match_title=""
if [[ $wmctrl_status -eq 0 ]]; then
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    local_class="$(printf '%s\n' "$line" | awk '{print $4}')"
    local_class_lc="${local_class,,}"
    if [[ "$local_class_lc" == *pantalla-kiosk* ]]; then
      match_line="$line"
      match_class="$local_class"
      match_title="$(printf '%s\n' "$line" | awk '{ $1=""; $2=""; $3=""; $4=""; sub(/^ +/, ""); print }')"
      break
    fi
  done <<<"$wmctrl_output"
fi

active_summary="desconocida"
if command -v xprop >/dev/null 2>&1; then
  active_wid="$(DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" xprop -root _NET_ACTIVE_WINDOW 2>/dev/null | awk -F'# ' 'NF>1 {print $2}' | awk '{print $1}')"
  if [[ -n "$active_wid" ]]; then
    active_class_raw="$(DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" xprop -id "$active_wid" WM_CLASS 2>/dev/null | awk -F' = ' 'NF>1 {print $2}')"
    active_title_raw="$(DISPLAY="$DISPLAY" XAUTHORITY="$XAUTHORITY" xprop -id "$active_wid" _NET_WM_NAME 2>/dev/null | awk -F' = ' 'NF>1 {print $2}')"
    active_summary="id=${active_wid}" 
    if [[ -n "$active_class_raw" ]]; then
      active_summary+=" WM_CLASS=${active_class_raw}"
    fi
    if [[ -n "$active_title_raw" ]]; then
      active_summary+=" _NET_WM_NAME=${active_title_raw}"
    fi
  fi
fi

if [[ -n "$match_line" ]]; then
  echo "OK ventana Chromium (pantalla-kiosk) detectada"
  echo "    WM_CLASS=${match_class}"
  echo "    TITLE=${match_title}"
  exit 0
fi

echo "WARN ventana Chromium no detectada (última ventana activa: ${active_summary})"
if [[ $wmctrl_status -ne 0 ]]; then
  echo "    wmctrl -lx no disponible o falló (status=${wmctrl_status})"
fi
exit 1
