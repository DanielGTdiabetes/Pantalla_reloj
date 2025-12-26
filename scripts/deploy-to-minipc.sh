#!/bin/bash
# Script para desplegar al mini PC desde Linux/WSL/GitBash
# Uso: ./scripts/deploy-to-minipc.sh [IP_MINIPC] [USUARIO]
# Ejemplo: ./scripts/deploy-to-minipc.sh 192.168.0.235 dani

MINIPC_IP="${1:-192.168.0.235}"
MINIPC_USER="${2:-dani}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$PROJECT_ROOT/smart-display/dist"

echo "[deploy] Desplegando al mini PC $MINIPC_IP como usuario $MINIPC_USER"
echo "[deploy] Directorio dist: $DIST_DIR"

# Verificar que existe el directorio dist
if [ ! -d "$DIST_DIR" ]; then
    echo "[deploy] ERROR: El directorio dist no existe. Ejecuta primero: npm run build en smart-display"
    exit 1
fi

echo ""
echo "[deploy] Copiando frontend (smart-display/dist) al mini PC..."
scp -r "$DIST_DIR/"* "$MINIPC_USER@$MINIPC_IP:/tmp/pantalla-dist/"

echo ""
echo "[deploy] Instalando archivos en /var/www/html..."
ssh "$MINIPC_USER@$MINIPC_IP" "sudo mkdir -p /tmp/pantalla-dist && sudo cp -r /tmp/pantalla-dist/* /var/www/html/ && sudo chown -R www-data:www-data /var/www/html && rm -rf /tmp/pantalla-dist"

echo ""
echo "[deploy] Copiando backend completo..."
scp -r "$PROJECT_ROOT/backend/"* "$MINIPC_USER@$MINIPC_IP:/tmp/pantalla-backend/"

echo ""
echo "[deploy] Instalando backend..."
ssh "$MINIPC_USER@$MINIPC_IP" "sudo cp -r /tmp/pantalla-backend/* /opt/pantalla-reloj/backend/ && sudo rm -rf /tmp/pantalla-backend"

echo ""
echo "[deploy] Reiniciando servicios..."
ssh "$MINIPC_USER@$MINIPC_IP" "sudo systemctl restart pantalla-dash-backend@$MINIPC_USER || sudo systemctl restart pantalla-dash-backend@dani"

echo ""
echo "[deploy] ========================================"
echo "[deploy] Despliegue completado!"
echo "[deploy] ========================================"
echo ""
