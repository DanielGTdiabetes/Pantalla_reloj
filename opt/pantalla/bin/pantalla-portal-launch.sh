#!/usr/bin/env bash
set -euo pipefail

LOG_DIR=/var/log/pantalla
LOG_FILE="${LOG_DIR}/xdg-desktop-portal.log"
STATE_FILE=/var/lib/pantalla-reloj/state/session.env
CURRENT_UID="$(id -u)"
CURRENT_USER="$(id -un)"
DEFAULT_SHELL="$(getent passwd "${CURRENT_USER}" | awk -F: 'NR==1 {print $7}' | awk 'NF {print; exit}')"
DEFAULT_SHELL="${DEFAULT_SHELL:-/bin/bash}"
DEFAULT_RUNTIME_DIR="/run/user/${CURRENT_UID}"
RUNTIME_DIR="${XDG_RUNTIME_DIR:-$DEFAULT_RUNTIME_DIR}"
PORTAL_BIN=${PORTAL_BIN:-/usr/libexec/xdg-desktop-portal}
BACKEND_BIN=${BACKEND_BIN:-/usr/libexec/xdg-desktop-portal-gtk}
DEFAULT_DISPLAY=":0"
DEFAULT_XAUTH="/var/lib/pantalla-reloj/.Xauthority"
DEFAULT_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
DEFAULT_LANG="${LANG:-C.UTF-8}"

resolve_user_home() {
  local home
  if home=$(getent passwd "${CURRENT_UID}" | awk -F: 'NR==1 {print $6}'); then
    printf '%s' "${home:-/home/${CURRENT_USER}}"
    return
  fi
  printf '%s' "/home/${CURRENT_USER}"
}

cleanup_existing_processes() {
  if command -v pkill >/dev/null 2>&1; then
    for pattern in xdg-desktop-portal-gtk xdg-desktop-portal; do
      if pgrep -u "${CURRENT_UID}" -f "$pattern" >/dev/null 2>&1; then
        pkill -u "${CURRENT_UID}" -f "$pattern" >/dev/null 2>&1 && \
          log INFO "killed leftover ${pattern}" || \
          log WARN "failed-kill ${pattern}"
      fi
    done
  fi
}

log() {
  local level="$1" message="$2"
  local ts
  ts="$(date -Is)"
  install -d -m 0755 "$LOG_DIR" >/dev/null 2>&1 || true
  printf '%s [%s] %s\n' "$ts" "$level" "$message" >>"$LOG_FILE"
}

load_session_state() {
  if [[ -r "$STATE_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$STATE_FILE"
    return 0
  fi
  return 1
}

wait_for_session_state() {
  for _ in {1..20}; do
    if load_session_state; then
      return 0
    fi
    sleep 0.25
  done
  log WARN "session.env not found after waiting"
  return 1
}

ensure_runtime_dir() {
  install -d -m 0700 "$RUNTIME_DIR" >/dev/null 2>&1 || true
}

ensure_dbus_bus() {
  local bus_path="$RUNTIME_DIR/bus"
  if [[ -n "${DBUS_SESSION_BUS_ADDRESS:-}" ]]; then
    return 0
  fi
  if [[ -S "$bus_path" ]]; then
    export DBUS_SESSION_BUS_ADDRESS="unix:path=${bus_path}"
    return 0
  fi
  if command -v dbus-daemon >/dev/null 2>&1; then
    if address=$(dbus-daemon --session --fork --print-address --address="unix:path=${bus_path}" 2>/dev/null); then
      export DBUS_SESSION_BUS_ADDRESS="$address"
      log INFO "dbus-daemon forked for portal"
      return 0
    fi
  fi
  return 1
}

ensure_backend() {
  if [[ ! -x "$BACKEND_BIN" ]]; then
    log WARN "backend binary not executable: $BACKEND_BIN"
    return
  fi
  if pgrep -u "${CURRENT_UID}" -f "xdg-desktop-portal-gtk" >/dev/null 2>&1; then
    log INFO "backend already running"
    return
  fi
  log INFO "starting backend: $BACKEND_BIN"
  env -i \
    DISPLAY="${DISPLAY:-$DEFAULT_DISPLAY}" \
    XAUTHORITY="${XAUTHORITY:-$DEFAULT_XAUTH}" \
    XDG_RUNTIME_DIR="$RUNTIME_DIR" \
    HOME="${USER_HOME}" \
    USER="${CURRENT_USER}" \
    LOGNAME="${CURRENT_USER}" \
    SHELL="${DEFAULT_SHELL}" \
    PATH="$DEFAULT_PATH" \
    LANG="$DEFAULT_LANG" \
    LC_ALL="$DEFAULT_LANG" \
    DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-}" \
    XDG_CURRENT_DESKTOP="${XDG_CURRENT_DESKTOP:-Openbox}" \
    "$BACKEND_BIN" >>"$LOG_FILE" 2>&1 &
}

snapshot_processes() {
  local user
  user="${CURRENT_USER}"
  while IFS= read -r line; do
    log INFO "ps ${line}"
  done < <(ps -ef | awk -v user="$user" '$1 == user && /xdg-desktop-portal(-gtk)?/' )
}

main() {
  wait_for_session_state || true

  RUNTIME_DIR="${XDG_RUNTIME_DIR:-$RUNTIME_DIR}"
  ensure_runtime_dir
  log INFO "using runtime dir: $RUNTIME_DIR"

  : "${DISPLAY:=$DEFAULT_DISPLAY}"
  : "${XAUTHORITY:=$DEFAULT_XAUTH}"
  : "${XDG_RUNTIME_DIR:=$RUNTIME_DIR}"
  : "${USER_HOME:=$(resolve_user_home)}"

  ensure_dbus_bus || log WARN "dbus-daemon unavailable"

  if [[ ! -x "$PORTAL_BIN" ]]; then
    log ERROR "portal binary missing: $PORTAL_BIN"
    exit 1
  fi

  cleanup_existing_processes

  ensure_backend

  ( sleep 1.5; snapshot_processes ) &

  log INFO "launching portal: $PORTAL_BIN"
  exec env -i \
    DISPLAY="$DISPLAY" \
    XAUTHORITY="$XAUTHORITY" \
    XDG_RUNTIME_DIR="$RUNTIME_DIR" \
    HOME="$USER_HOME" \
    USER="${CURRENT_USER}" \
    LOGNAME="${CURRENT_USER}" \
    SHELL="${DEFAULT_SHELL}" \
    PATH="$DEFAULT_PATH" \
    LANG="$DEFAULT_LANG" \
    LC_ALL="$DEFAULT_LANG" \
    DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-}" \
    XDG_CURRENT_DESKTOP="${XDG_CURRENT_DESKTOP:-Openbox}" \
    "$PORTAL_BIN" >>"$LOG_FILE" 2>&1
}

main "$@"
