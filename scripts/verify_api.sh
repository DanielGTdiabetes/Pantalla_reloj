#!/usr/bin/env bash
set -e

echo "[verify] nginx -t"
sudo nginx -t

echo "[verify] /api/health (nginx)"
curl -sS -D - http://127.0.0.1/api/health -o /dev/null

echo "[verify] /api/config (nginx)"
curl -sS http://127.0.0.1/api/config | head -c 200
printf '\n'
