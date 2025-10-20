#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ $EUID -ne 0 ]]; then
  exec sudo -E bash "$0" "$@"
fi

"$SCRIPT_DIR/scripts/install.sh" --non-interactive "$@"
