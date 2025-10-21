# Pantalla Openbox User Service Setup

This document summarizes the steps executed in the development container to provision an Openbox session as a user service for `dani`.  The procedure mirrors the production target (Ubuntu 24.04 with systemd as PID 1), but note that the container lacks a running systemd instance, so service activation commands return the expected D-Bus connection errors.

## Steps

1. Enabled lingering for the user so the user service can remain active outside of login sessions:
   ```bash
   sudo loginctl enable-linger dani
   ```
   In the container environment this fails with `System has not been booted with systemd as init system (PID 1)` because systemd is not PID 1.

2. Created the user configuration directory and placed the Openbox unit file at `/home/dani/.config/systemd/user/pantalla-openbox.service` with the following contents:
   ```ini
   [Unit]
   Description=Pantalla - Openbox session on :0
   After=default.target
   Wants=default.target

   [Service]
   Type=simple
   Environment=DISPLAY=:0
   ExecStart=/usr/bin/openbox-session
   Restart=always
   RestartSec=2

   [Install]
   WantedBy=default.target
   ```

3. Attempted to reload the user daemon and enable/start the unit:
   ```bash
   sudo -u dani XDG_RUNTIME_DIR=/run/user/$(id -u dani) systemctl --user daemon-reload
   sudo -u dani XDG_RUNTIME_DIR=/run/user/$(id -u dani) systemctl --user enable --now pantalla-openbox.service
   ```
   Both commands fail with `Failed to connect to bus: No such file or directory` because the user systemd instance cannot start without a running system instance.

## Verification Attempts

The verification commands also fail for the same reason:

```bash
sudo -u dani XDG_RUNTIME_DIR=/run/user/$(id -u dani) systemctl --user is-active pantalla-openbox.service
sudo -u dani XDG_RUNTIME_DIR=/run/user/$(id -u dani) systemctl --user status pantalla-openbox.service --no-pager -l | sed -n '1,80p'
pgrep -u dani -af openbox
```

Running these commands on the target host that boots with systemd should succeed and report the service as active with an `openbox-session` process owned by `dani`.
