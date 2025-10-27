#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

SUDO_BIN="sudo"
if [[ ${EUID:-$(id -u)} -eq 0 ]]; then
  SUDO_BIN=""
fi

log() { printf '%s\n' "$*"; }
log_error() { printf '[verify][ERROR] %s\n' "$*" >&2; }

check_paths_for_trailing_slashes() {
  local -a search_paths=()

  [[ -d "$REPO_ROOT/deploy/nginx" ]] && search_paths+=("$REPO_ROOT/deploy/nginx")
  [[ -d "$REPO_ROOT/etc/nginx" ]] && search_paths+=("$REPO_ROOT/etc/nginx")
  [[ -f "$REPO_ROOT/scripts/install.sh" ]] && search_paths+=("$REPO_ROOT/scripts/install.sh")
  [[ -f "$REPO_ROOT/scripts/update.sh" ]] && search_paths+=("$REPO_ROOT/scripts/update.sh")

  if (( ${#search_paths[@]} == 0 )); then
    return
  fi

  local pattern='location[[:space:]]+/api/|proxy_pass[[:space:]]+http://127\.0\.0\.1:8081/'
  local matches
  matches="$(grep -R -n -E "$pattern" "${search_paths[@]}" 2>/dev/null || true)"

  if [[ -n "$matches" ]]; then
    log_error "Se detectaron ubicaciones /api con barra final o proxy_pass a 127.0.0.1:8081/ en el repositorio"
    printf '%s\n' "$matches" >&2
    exit 1
  fi
}

check_runtime_trailing_slashes() {
  local runtime_paths=(
    /etc/nginx/sites-available/pantalla-reloj.conf
    /etc/nginx/sites-enabled/pantalla-reloj.conf
  )

  for path in "${runtime_paths[@]}"; do
    if [[ -f "$path" ]]; then
      if grep -Eq 'location[[:space:]]+/api/' "$path" || \
         grep -Eq 'proxy_pass[[:space:]]+http://127\.0\.0\.1:8081/' "$path"; then
        log_error "El archivo $path contiene una definición /api con barra final"
        exit 1
      fi
    fi
  done
}

check_endpoint() {
  local path="$1"
  local label="$2"
  local print_body="${3:-0}"

  log "[verify] ${label}"

  local body_file err_file
  body_file="$(mktemp)"
  err_file="$(mktemp)"

  set +e
  local http_code
  http_code=$(curl -sS -o "$body_file" -w '%{http_code}' "http://127.0.0.1${path}" 2>"$err_file")
  local curl_status=$?
  set -e

  if (( curl_status != 0 )); then
    log_error "curl falló para ${path}"
    cat "$err_file" >&2
    rm -f "$body_file" "$err_file"
    exit 1
  fi

  if [[ "$http_code" != "200" ]]; then
    log_error "${path} devolvió HTTP ${http_code}"
    cat "$body_file" >&2
    rm -f "$body_file" "$err_file"
    exit 1
  fi

  if [[ "$print_body" == "1" ]]; then
    head -c 200 "$body_file"
    printf '\n'
  fi

  rm -f "$body_file" "$err_file"
}

check_paths_for_trailing_slashes
check_runtime_trailing_slashes

if ! command -v nginx >/dev/null 2>&1; then
  log_error "nginx no está instalado"
  exit 1
fi

log "[verify] nginx -t"
if [[ -n "$SUDO_BIN" ]]; then
  $SUDO_BIN nginx -t
else
  nginx -t
fi

check_endpoint "/api/health" "/api/health (nginx)"
check_endpoint "/api/config" "/api/config (nginx)" 1
