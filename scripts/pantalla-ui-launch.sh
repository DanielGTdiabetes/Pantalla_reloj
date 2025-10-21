#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${DISPLAY:-}" ]]; then
  echo "pantalla-ui-launch: DISPLAY no está definido; ¿está Xorg en marcha?" >&2
  exit 1
fi

URL="${PANTALLA_UI_URL:-http://127.0.0.1/}"
WIDTH="${PANTALLA_UI_WIDTH:-1920}"
HEIGHT="${PANTALLA_UI_HEIGHT:-480}"
POSITION_X="${PANTALLA_UI_POS_X:-0}"
POSITION_Y="${PANTALLA_UI_POS_Y:-0}"

candidates=(/snap/bin/chromium chromium chromium-browser google-chrome-stable google-chrome)
CHROMIUM_BIN=""
for candidate in "${candidates[@]}"; do
  if command -v "$candidate" >/dev/null 2>&1; then
    CHROMIUM_BIN="$(command -v "$candidate")"
    break
  fi
done

if [[ -z "$CHROMIUM_BIN" ]]; then
  echo "pantalla-ui-launch: no se encontró un binario de Chromium compatible" >&2
  exit 1
fi

exec "$CHROMIUM_BIN" \
  --app="$URL" \
  --kiosk \
  --start-fullscreen \
  --window-size="${WIDTH},${HEIGHT}" \
  --window-position="${POSITION_X},${POSITION_Y}" \
  --no-first-run \
  --disable-session-crashed-bubble \
  --disable-infobars \
  --noerrdialogs \
  --check-for-update-interval=31536000
