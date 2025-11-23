#!/bin/bash
# Script de diagnóstico para problemas con vuelos de OpenSky

echo "=== Diagnóstico de Vuelos OpenSky ==="
echo ""

# Verificar que el backend esté corriendo
echo "1. Verificando que el backend esté corriendo..."
if curl -s http://localhost:8000/healthz > /dev/null 2>&1; then
    echo "   ✓ Backend está corriendo"
else
    echo "   ✗ Backend no está corriendo o no responde"
    exit 1
fi

echo ""
echo "2. Verificando configuración..."
CONFIG_RESPONSE=$(curl -s http://localhost:8000/api/config)
OPENSKY_ENABLED=$(echo "$CONFIG_RESPONSE" | grep -o '"opensky"[^}]*"enabled":[^,}]*' | grep -o 'true\|false' | head -1)
FLIGHTS_ENABLED=$(echo "$CONFIG_RESPONSE" | grep -o '"flights"[^}]*"enabled":[^,}]*' | grep -o 'true\|false' | head -1)
FLIGHTS_PROVIDER=$(echo "$CONFIG_RESPONSE" | grep -o '"flights"[^}]*"provider":"[^"]*"' | grep -o '"[^"]*"' | tail -1 | tr -d '"')

echo "   OpenSky enabled: ${OPENSKY_ENABLED:-'no encontrado'}"
echo "   Flights enabled: ${FLIGHTS_ENABLED:-'no encontrado'}"
echo "   Flights provider: ${FLIGHTS_PROVIDER:-'no encontrado'}"

echo ""
echo "3. Probando endpoint /api/layers/flights..."
FLIGHTS_RESPONSE=$(curl -s http://localhost:8000/api/layers/flights)
FLIGHTS_COUNT=$(echo "$FLIGHTS_RESPONSE" | grep -o '"count":[0-9]*' | grep -o '[0-9]*' | head -1)
FLIGHTS_DISABLED=$(echo "$FLIGHTS_RESPONSE" | grep -o '"disabled":[^,}]*' | grep -o 'true\|false' | head -1)
FLIGHTS_STALE=$(echo "$FLIGHTS_RESPONSE" | grep -o '"stale":[^,}]*' | grep -o 'true\|false' | head -1)

echo "   Count: ${FLIGHTS_COUNT:-0}"
echo "   Disabled: ${FLIGHTS_DISABLED:-'no encontrado'}"
echo "   Stale: ${FLIGHTS_STALE:-'no encontrado'}"

if [ -n "$FLIGHTS_COUNT" ] && [ "$FLIGHTS_COUNT" -gt 0 ]; then
    echo "   ✓ El endpoint devuelve $FLIGHTS_COUNT vuelos"
else
    echo "   ✗ El endpoint no devuelve vuelos o está vacío"
    echo ""
    echo "   Respuesta completa:"
    echo "$FLIGHTS_RESPONSE" | head -20
fi

echo ""
echo "4. Verificando estado de OpenSky..."
OPENSKY_STATUS=$(curl -s http://localhost:8000/api/layers/flights/test)
echo "$OPENSKY_STATUS" | head -30

echo ""
echo "=== Fin del diagnóstico ==="

