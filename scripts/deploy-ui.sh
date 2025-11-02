#!/bin/bash
# Script de deployment para dash-ui
# Copia dist/ a /var/www/html y valida que los archivos estén accesibles

set -e  # Salir si hay errores

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DASH_UI_DIR="$PROJECT_ROOT/dash-ui"
TARGET_DIR="/var/www/html"

echo "[deploy] Build de dash-ui..."
cd "$DASH_UI_DIR"
npm run build

if [ ! -d "$DASH_UI_DIR/dist" ]; then
    echo "[deploy] ERROR: dist/ no existe después del build"
    exit 1
fi

echo "[deploy] Copiando archivos a $TARGET_DIR..."
sudo cp -r "$DASH_UI_DIR/dist"/* "$TARGET_DIR/"

echo "[deploy] Verificando permisos..."
sudo chown -R www-data:www-data "$TARGET_DIR"
sudo chmod -R 755 "$TARGET_DIR"

echo "[deploy] Validando archivos SVG..."
VALIDATION_FAILED=0

# Verificar SVG de moon (5 archivos)
MOON_SVGS=("moon-0.svg" "moon-25.svg" "moon-50.svg" "moon-75.svg" "moon-100.svg")
for svg in "${MOON_SVGS[@]}"; do
    if [ ! -f "$TARGET_DIR/icons/moon/$svg" ]; then
        echo "[deploy] ERROR: Falta $TARGET_DIR/icons/moon/$svg"
        VALIDATION_FAILED=1
    fi
done

# Verificar SVG de harvest (10 archivos)
HARVEST_SVGS=("apple.svg" "beet.svg" "broccoli.svg" "carrot.svg" "chard.svg" "cherry.svg" "grapes.svg" "lettuce.svg" "pear.svg" "pumpkin.svg")
for svg in "${HARVEST_SVGS[@]}"; do
    if [ ! -f "$TARGET_DIR/icons/harvest/$svg" ]; then
        echo "[deploy] ERROR: Falta $TARGET_DIR/icons/harvest/$svg"
        VALIDATION_FAILED=1
    fi
done

if [ $VALIDATION_FAILED -eq 0 ]; then
    echo "[deploy] ✓ Todos los archivos SVG están presentes"
    echo "[deploy] ✓ ${#MOON_SVGS[@]} SVG de moon verificados"
    echo "[deploy] ✓ ${#HARVEST_SVGS[@]} SVG de harvest verificados"
else
    echo "[deploy] ERROR: Faltan algunos archivos SVG"
    exit 1
fi

echo "[deploy] Pruebas de acceso HTTP (requiere nginx corriendo)..."
if command -v curl &> /dev/null; then
    if curl -I -s http://127.0.0.1/icons/harvest/apple.svg | head -n 1 | grep -q "200"; then
        echo "[deploy] ✓ SVG de harvest accesible (HTTP 200)"
    else
        echo "[deploy] WARNING: No se pudo validar acceso HTTP a harvest SVG (nginx puede no estar corriendo)"
    fi
    
    if curl -I -s http://127.0.0.1/icons/moon/moon-50.svg | head -n 1 | grep -q "200"; then
        echo "[deploy] ✓ SVG de moon accesible (HTTP 200)"
    else
        echo "[deploy] WARNING: No se pudo validar acceso HTTP a moon SVG (nginx puede no estar corriendo)"
    fi
else
    echo "[deploy] WARNING: curl no disponible para validar acceso HTTP"
fi

echo "[deploy] ✓ Deployment completado exitosamente"