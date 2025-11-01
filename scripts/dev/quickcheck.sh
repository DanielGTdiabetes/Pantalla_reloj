#!/usr/bin/env bash
set -euo pipefail

BASE="${BASE:-http://localhost:8081}"

echo "[1] Schema secrets"
curl -sS "$BASE/api/config/schema" | jq '.secrets | map(.key)'

echo "[2] AEMET test (GET)"
curl -sS "$BASE/api/aemet/test" | jq .

echo "[3] OpenSky status"
curl -sS "$BASE/api/opensky/status" | jq '{token_valid, expires_in, configured_poll, effective_poll}'

echo "[4] Health (integrations.ships)"
curl -sS "$BASE/api/health/full" | jq '.integrations.ships'

echo "Done."


