#!/bin/bash
set -euo pipefail

STATUS=$(curl -fsS --max-time 3 http://127.0.0.1:8081/api/network/status 2>/dev/null || echo '{}')
CONNECTED=$(python3 - <<'PY'
import json, sys
try:
    data = json.loads(sys.stdin.read())
    connected = data.get('connected', False)
except Exception:
    connected = False
print('true' if connected else 'false')
PY
)

if [[ "$CONNECTED" == "true" ]]; then
  systemctl stop pantalla-ap.service || true
else
  systemctl start pantalla-ap.service || true
fi
