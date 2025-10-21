#!/usr/bin/env bash
set -euo pipefail

USER_NAME="dani"
DISPLAY_NUM=":0"
SERVICE_PATH="/home/${USER_NAME}/.config/systemd/user/pantalla-cursor-hide.service"

sudo apt-get update
sudo apt-get install -y unclutter

if ! id -u "${USER_NAME}" >/dev/null 2>&1; then
  sudo useradd -m "${USER_NAME}"
fi

sudo -u "${USER_NAME}" mkdir -p "$(dirname "${SERVICE_PATH}")"

cat <<'SERVICE' | sudo -u "${USER_NAME}" tee "${SERVICE_PATH}" >/dev/null
[Unit]
Description=Pantalla - Hide mouse cursor on :0 (unclutter)
After=pantalla-openbox.service
Requires=pantalla-openbox.service

[Service]
Type=simple
Environment=DISPLAY=:0
ExecStart=/usr/bin/unclutter -idle 0 -root -noevents
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
SERVICE

sudo loginctl enable-linger "${USER_NAME}"
USER_ID="$(id -u "${USER_NAME}")"
export XDG_RUNTIME_DIR="/run/user/${USER_ID}"
sudo -u "${USER_NAME}" XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR}" systemctl --user daemon-reload
sudo -u "${USER_NAME}" XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR}" systemctl --user enable --now pantalla-cursor-hide.service

sudo -u "${USER_NAME}" XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR}" systemctl --user is-active pantalla-cursor-hide.service
pgrep -u "${USER_NAME}" -af unclutter
