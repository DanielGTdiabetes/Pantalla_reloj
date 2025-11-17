#!/bin/bash
# Script para limpiar la caché del kiosk Chromium
# Útil cuando el kiosk persiste con assets viejos o el mapa no carga correctamente
#
# Uso: sudo ./scripts/reset_kiosk_cache.sh [usuario]
#       Por defecto usa el usuario "dani"

set -euo pipefail

USER_NAME="${1:-dani}"
SERVICE_NAME="pantalla-kiosk-chrome@${USER_NAME}.service"

# Directorios de perfil y caché de Chromium
CHROMIUM_PROFILE_DIR="/var/lib/pantalla-reloj/state/chromium-kiosk"
CHROMIUM_HOME_DATA_DIR="/home/${USER_NAME}/.local/share/pantalla-reloj/chromium"
CHROMIUM_HOME_CACHE_DIR="/home/${USER_NAME}/.cache/pantalla-reloj/chromium"

echo "========================================="
echo "Limpieza de caché del kiosk Chromium"
echo "Usuario: ${USER_NAME}"
echo "========================================="
echo ""

# Verificar que el usuario existe
if ! id -u "${USER_NAME}" >/dev/null 2>&1; then
    echo "ERROR: El usuario '${USER_NAME}' no existe"
    exit 1
fi

# Detener el servicio del kiosk si está corriendo
if systemctl --user -M "${USER_NAME}@" is-active --quiet "${SERVICE_NAME}" 2>/dev/null || \
   systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null; then
    echo "Deteniendo servicio ${SERVICE_NAME}..."
    if systemctl --user -M "${USER_NAME}@" stop "${SERVICE_NAME}" 2>/dev/null; then
        echo "  ✓ Servicio detenido (user mode)"
    elif systemctl stop "${SERVICE_NAME}" 2>/dev/null; then
        echo "  ✓ Servicio detenido (system mode)"
    else
        echo "  ⚠ No se pudo detener el servicio (puede que no esté corriendo)"
    fi
    sleep 2
else
    echo "  ℹ El servicio ${SERVICE_NAME} no está corriendo"
fi

# Limpiar directorios de perfil y caché
echo ""
echo "Limpiando directorios de perfil y caché..."

CLEANED=0

if [ -d "${CHROMIUM_PROFILE_DIR}" ]; then
    echo "  Limpiando ${CHROMIUM_PROFILE_DIR}..."
    rm -rf "${CHROMIUM_PROFILE_DIR}"/*
    chown -R "${USER_NAME}:${USER_NAME}" "${CHROMIUM_PROFILE_DIR}" 2>/dev/null || true
    CLEANED=1
    echo "    ✓ Limpiado"
else
    echo "  ℹ ${CHROMIUM_PROFILE_DIR} no existe"
fi

if [ -d "${CHROMIUM_HOME_DATA_DIR}" ]; then
    echo "  Limpiando ${CHROMIUM_HOME_DATA_DIR}..."
    rm -rf "${CHROMIUM_HOME_DATA_DIR}"/*
    chown -R "${USER_NAME}:${USER_NAME}" "${CHROMIUM_HOME_DATA_DIR}" 2>/dev/null || true
    CLEANED=1
    echo "    ✓ Limpiado"
else
    echo "  ℹ ${CHROMIUM_HOME_DATA_DIR} no existe"
fi

if [ -d "${CHROMIUM_HOME_CACHE_DIR}" ]; then
    echo "  Limpiando ${CHROMIUM_HOME_CACHE_DIR}..."
    rm -rf "${CHROMIUM_HOME_CACHE_DIR}"/*
    chown -R "${USER_NAME}:${USER_NAME}" "${CHROMIUM_HOME_CACHE_DIR}" 2>/dev/null || true
    CLEANED=1
    echo "    ✓ Limpiado"
else
    echo "  ℹ ${CHROMIUM_HOME_CACHE_DIR} no existe"
fi

if [ $CLEANED -eq 0 ]; then
    echo "  ⚠ No se encontraron directorios de perfil/caché para limpiar"
fi

# Reiniciar el servicio del kiosk
echo ""
echo "Reiniciando servicio ${SERVICE_NAME}..."
if systemctl --user -M "${USER_NAME}@" start "${SERVICE_NAME}" 2>/dev/null; then
    echo "  ✓ Servicio reiniciado (user mode)"
elif systemctl start "${SERVICE_NAME}" 2>/dev/null; then
    echo "  ✓ Servicio reiniciado (system mode)"
else
    echo "  ⚠ No se pudo reiniciar el servicio automáticamente"
    echo "     Puedes iniciarlo manualmente con:"
    echo "     systemctl --user start ${SERVICE_NAME}"
    echo "     o"
    echo "     sudo systemctl start ${SERVICE_NAME}"
fi

echo ""
echo "========================================="
echo "Limpieza completada"
echo "========================================="
echo ""
echo "NOTA: Si el problema persiste, verifica:"
echo "  1. La API key de MapTiler está configurada correctamente en /config"
echo "  2. El styleUrl es válido (puedes probarlo con: POST /api/maps/test_maptiler)"
echo "  3. El backend está devolviendo styleUrl correcto (GET /api/config)"
echo ""

