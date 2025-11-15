#!/bin/bash
# Script para ejecutar vía SSH en el servidor
# Copia y pega estos comandos en tu sesión SSH, o ejecuta: bash <(cat scripts/fix_nginx_api_priority_ssh.sh)

set -e

NGINX_CONF="/etc/nginx/sites-available/pantalla-reloj.conf"

echo "=== Paso 1: Haciendo backup y actualizando configuración ==="

# Hacer backup
sudo cp "$NGINX_CONF" "${NGINX_CONF}.bak.$(date +%Y%m%d_%H%M%S)"
echo "✓ Backup creado"

# Actualizar location /api a location ^~ /api/
sudo sed -i 's|^  location /api {|  location ^~ /api/ {|' "$NGINX_CONF"
echo "✓ Configuración actualizada: location ^~ /api/"

# Mostrar el cambio
echo
echo "Cambio aplicado:"
sudo grep -A 12 "^  location ^~ /api/" "$NGINX_CONF" | head -13

echo
echo "=== Paso 2: Validando configuración de nginx ==="
if sudo nginx -t; then
    echo "✓ Configuración de nginx válida"
else
    echo "✗ ERROR: La configuración de nginx tiene errores"
    echo "Restaurando backup..."
    sudo cp "${NGINX_CONF}.bak."* "$NGINX_CONF" 2>/dev/null || true
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
RESPONSE=$(curl -sS -i "http://127.0.0.1/api/global/satellite/tiles/$TS/0/0/0.png" 2>&1)
echo "$RESPONSE" | sed -n '1,8p'

if echo "$RESPONSE" | grep -q "HTTP/1.1 200 OK"; then
    echo
    echo "✓ SUCCESS: El endpoint funciona correctamente a través de nginx"
    echo
    echo "=== Resumen ==="
    echo "✓ Configuración actualizada: location ^~ /api/"
    echo "✓ Nginx validado y recargado"
    echo "✓ Endpoint de tiles verificado (HTTP 200)"
else
    echo
    echo "✗ ERROR: El endpoint no responde correctamente"
    echo "Respuesta completa:"
    echo "$RESPONSE"
    exit 1
fi

