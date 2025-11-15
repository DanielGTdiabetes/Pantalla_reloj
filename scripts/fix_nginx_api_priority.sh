#!/bin/bash
# Script para corregir la prioridad de /api/ sobre regex de archivos estáticos en nginx
# Ejecutar en el servidor Linux con: bash scripts/fix_nginx_api_priority.sh

set -e

NGINX_CONF="/etc/nginx/sites-available/pantalla-reloj.conf"
REPO_CONF="deploy/nginx/pantalla-reloj.conf"

echo "=== Paso 1: Actualizando configuración de nginx ==="

# Verificar si el archivo del sistema existe
if [ ! -f "$NGINX_CONF" ]; then
    echo "ERROR: No se encuentra $NGINX_CONF"
    echo "Por favor, copia el archivo desde el repositorio primero:"
    echo "  sudo cp $REPO_CONF $NGINX_CONF"
    exit 1
fi

# Hacer backup
sudo cp "$NGINX_CONF" "${NGINX_CONF}.bak.$(date +%Y%m%d_%H%M%S)"
echo "✓ Backup creado: ${NGINX_CONF}.bak.*"

# Actualizar location /api a location ^~ /api/
sudo sed -i 's|^  location /api {|  location ^~ /api/ {|' "$NGINX_CONF"
echo "✓ Configuración actualizada: location ^~ /api/"

echo
echo "=== Paso 2: Validando configuración de nginx ==="
if sudo nginx -t; then
    echo "✓ Configuración de nginx válida"
else
    echo "✗ ERROR: La configuración de nginx tiene errores"
    echo "Restaurando backup..."
    sudo cp "${NGINX_CONF}.bak."* "$NGINX_CONF"
    exit 1
fi

echo
echo "=== Paso 3: Recargando nginx ==="
if sudo systemctl reload nginx; then
    echo "✓ Nginx recargado correctamente"
else
    echo "✗ ERROR: No se pudo recargar nginx"
    exit 1
fi

echo
echo "=== Paso 4: Verificando endpoint de tiles ==="
TS=1763138400

echo "== Backend directo (8081) =="
curl -sS -i "http://127.0.0.1:8081/api/global/satellite/tiles/$TS/0/0/0.png" | sed -n '1,8p'

echo
echo "== Pasando por nginx (80) =="
RESPONSE=$(curl -sS -i "http://127.0.0.1/api/global/satellite/tiles/$TS/0/0/0.png" | sed -n '1,8p')
echo "$RESPONSE"

if echo "$RESPONSE" | grep -q "HTTP/1.1 200 OK"; then
    echo "✓ SUCCESS: El endpoint funciona correctamente a través de nginx"
else
    echo "✗ ERROR: El endpoint no responde correctamente"
    exit 1
fi

echo
echo "=== Resumen ==="
echo "✓ Configuración actualizada: location ^~ /api/"
echo "✓ Nginx validado y recargado"
echo "✓ Endpoint de tiles verificado"
echo
echo "Próximos pasos:"
echo "1. Abre http://192.168.0.234/ en el navegador"
echo "2. Verifica que la UI carga correctamente"
echo "3. En DevTools → Network, filtra por 'satellite/tiles'"
echo "4. Confirma que las peticiones responden con status 200"

