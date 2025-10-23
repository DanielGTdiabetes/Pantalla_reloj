#!/bin/bash
set -uo pipefail

API_URL="http://127.0.0.1/api/backgrounds/current"
ASSETS_DIR="/opt/dash/assets/backgrounds/auto"
LOG_PATH="/var/log/pantalla-dash/bg.log"
NGINX_URL_PREFIX="http://127.0.0.1"
BACKEND_URL_PREFIX="http://127.0.0.1:8081"
MIN_BYTES=50000

failures=()
outputs=()

run_maybe_sudo() {
  if command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    "$@"
  fi
}

record_failure() {
  failures+=("$1")
}

append_output() {
  outputs+=("$1")
}

api_response="$(curl -fsS "$API_URL" || true)"
if [[ -z "$api_response" ]]; then
  record_failure "API sin respuesta"
else
  append_output "API response: $api_response"
fi

background_url="$(python3 - <<'PY'
import json,sys
try:
    payload=json.loads(sys.stdin.read())
except Exception:
    print("", end="")
    sys.exit(0)
url=payload.get("url") if isinstance(payload, dict) else None
print(url or "", end="")
PY
<<<"$api_response")"

if [[ -z "$background_url" ]]; then
  record_failure "JSON sin campo url"
fi

strip_query="${background_url%%\?*}"
filename="${strip_query##*/}"
if [[ -z "$filename" ]]; then
  record_failure "No se pudo obtener nombre de archivo"
fi

check_headers() {
  local label="$1"
  local url="$2"
  local headers
  headers="$(curl -fsSI "$url" || true)"
  if [[ -z "$headers" ]]; then
    record_failure "${label}: sin respuesta"
    return
  fi
  local status
  status="$(printf '%s' "$headers" | head -n1)"
  if [[ "$status" != *"200"* ]]; then
    record_failure "${label}: estado inesperado -> $status"
  fi
  local ctype
  ctype="$(printf '%s' "$headers" | awk 'BEGIN{IGNORECASE=1}/^Content-Type:/ {print tolower($0)}' | tail -n1)"
  if [[ "$ctype" != *"image/webp"* ]]; then
    record_failure "${label}: Content-Type inesperado ($ctype)"
  fi
  local clen
  clen="$(printf '%s' "$headers" | awk 'BEGIN{IGNORECASE=1}/^Content-Length:/ {print $2}' | tail -n1)"
  if [[ -z "$clen" || "$clen" -le $MIN_BYTES ]]; then
    record_failure "${label}: Content-Length <= $MIN_BYTES"
  fi
  append_output "${label} headers:\n$headers"
}

if [[ -n "$background_url" ]]; then
  check_headers "nginx" "$NGINX_URL_PREFIX$background_url"
  check_headers "backend" "$BACKEND_URL_PREFIX$background_url"
fi

if [[ -n "$filename" ]]; then
  full_path="$ASSETS_DIR/$filename"
  if [[ -f "$full_path" ]]; then
    size="$(stat -c %s "$full_path")"
    mtime="$(stat -c %y "$full_path")"
    if [[ "$size" -le $MIN_BYTES ]]; then
      record_failure "Archivo $filename demasiado pequeño ($size bytes)"
    fi
    append_output "Archivo: $full_path ($size bytes, mtime $mtime)"
  else
    record_failure "Archivo $full_path no encontrado"
  fi
fi

log_tail="$(run_maybe_sudo tail -n 40 "$LOG_PATH" 2>/dev/null || true)"
if [[ -n "$log_tail" ]]; then
  if printf '%s' "$log_tail" | grep -E "ERROR|Traceback" >/dev/null 2>&1; then
    record_failure "Log contiene errores recientes"
  fi
  append_output "Log tail:\n$log_tail"
else
  record_failure "No se pudo leer $LOG_PATH"
fi

nginx_locations="$(run_maybe_sudo nginx -T 2>/dev/null | grep -n "location /backgrounds/auto/" || true)"
if [[ -z "$nginx_locations" ]]; then
  record_failure "Bloques location /backgrounds/auto/ no encontrados"
else
  append_output "Nginx locations:\n$nginx_locations"
fi

css_report="$(python3 - <<'PY'
import glob
import json
import re
from pathlib import Path

paths = glob.glob('/var/www/html/assets/*.css')
results = []
pattern = re.compile(r'rgba\([^)]*?([01]?(?:\.\d+)?)\)')
targets = {'glass', 'glass-light', 'glass-surface::after'}
for css_path in paths:
    text = Path(css_path).read_text(encoding='utf-8', errors='ignore')
    for selector in targets:
        for match in re.finditer(rf'{re.escape(selector)}[^{{]*{{([^}}]+)}}', text, re.MULTILINE | re.DOTALL):
            section = match.group(1)
            alphas = [float(a) for a in re.findall(r'rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)', section)]
            if not alphas:
                continue
            max_alpha = max(alphas)
            limit = 0.35 if selector != 'glass-surface::after' else 0.12
            if max_alpha > limit + 1e-6:
                results.append({'file': css_path, 'selector': selector, 'max_alpha': max_alpha, 'limit': limit})

print(json.dumps(results))
PY
)"
if [[ "$css_report" != "[]" ]]; then
  record_failure "CSS con alpha fuera de rango: $css_report"
else
  append_output "CSS overlay transparency verificada"
fi

if [[ ${#outputs[@]} -gt 0 ]]; then
  printf '%s\n\n' "${outputs[@]}"
fi

if [[ ${#failures[@]} -gt 0 ]]; then
  printf 'Resultado: FAIL\n' >&2
  printf '%s\n' "${failures[@]}" >&2
  exit 1
else
  printf 'Resultado: OK\n'
fi
