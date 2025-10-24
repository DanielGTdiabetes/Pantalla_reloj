#!/usr/bin/env bash
set -euo pipefail

loginctl enable-linger dani || true
systemctl --user daemon-reload
systemctl --user enable --now pantalla-dash-backend@dani pantalla-ui.service blitz_ws_client.service

sudo systemctl restart nginx mosquitto

curl -sf http://127.0.0.1:8081/api/health && echo "✅ Backend OK"
mosquitto_pub -h 127.0.0.1 -t 'test/topic' -m 'ping' -r
mosquitto_sub -h 127.0.0.1 -t 'test/topic' -C 1 -W 2 | grep ping
