# Casos de Prueba E2E (End-to-End)

Este documento describe los casos de prueba end-to-end para Pantalla Reloj, incluyendo pruebas de backend (curl) y pruebas manuales de UI.

## Prerequisitos

- Backend ejecutándose en `http://127.0.0.1:8081`
- Nginx ejecutándose y configurado
- Variables de entorno configuradas:
  ```bash
  export API_BASE="http://127.0.0.1:8081"
  export API_BASE_PROXY="http://127.0.0.1"
  ```

## 1. Pruebas de Backend (cURL)

### 1.1 Health Check

```bash
# Health básico
curl -s "${API_BASE}/api/health" | jq .

# Health completo con status de proveedores
curl -s "${API_BASE}/api/health/full" | jq .

# Verificar que status=ok
curl -s "${API_BASE}/api/health" | jq -e '.status == "ok"'
```

**Resultado esperado:**
- `status: "ok"`
- `backend: "running"`
- `timezone` presente

### 1.2 Configuración

```bash
# Obtener configuración completa (sin secretos)
curl -s "${API_BASE}/api/config" | jq .

# Verificar que no hay secretos expuestos
curl -s "${API_BASE}/api/config" | jq '.secrets.maptiler.api_key' 
# Debe ser null o no existir

# Verificar que secrets.maptiler tiene metadatos
curl -s "${API_BASE}/api/config" | jq '.secrets.maptiler'
# Debe tener has_api_key y api_key_last4

# Guardar configuración de grupo (deep-merge)
curl -X PATCH "${API_BASE}/api/config/group/ui_map" \
  -H "Content-Type: application/json" \
  -d '{"provider": "maptiler_vector", "maptiler": {"style": "streets-v2"}}' | jq .

# Verificar que no se borraron otras claves
curl -s "${API_BASE}/api/config" | jq '.ui_map'
# Debe mantener todas las claves existentes
```

### 1.3 MapTiler Test

```bash
# Probar MapTiler (requiere styleUrl configurado)
curl -X POST "${API_BASE}/api/maptiler/test" \
  -H "Content-Type: application/json" \
  -d '{"styleUrl": "https://api.maptiler.com/maps/streets-v2/style.json?key=YOUR_KEY"}' | jq .
```

**Resultado esperado:**
- `ok: true` si la API key es válida
- `bytes: <número>` si el tile se descargó correctamente
- `error: <mensaje>` si falla

### 1.4 GIBS (Satélite) Test

```bash
# Probar GIBS
curl -X POST "${API_BASE}/api/global/satellite/test" | jq .

# Obtener frames disponibles
curl -s "${API_BASE}/api/global/satellite/frames" | jq .

# Obtener tile de ejemplo
curl -s "${API_BASE}/api/global/satellite/tiles/2/1/1.png" \
  -o /tmp/gibs-tile.png && file /tmp/gibs-tile.png
```

**Resultado esperado:**
- `ok: true`
- `frames_count: > 0` en frames
- Tile PNG válido

### 1.5 RainViewer (Radar) Test

```bash
# Probar RainViewer
curl -X POST "${API_BASE}/api/global/radar/test" | jq .

# Obtener frames disponibles
curl -s "${API_BASE}/api/global/radar/frames" | jq .

# Obtener tile de ejemplo
curl -s "${API_BASE}/api/global/radar/tiles/2/1/1.png" \
  -o /tmp/radar-tile.png && file /tmp/radar-tile.png
```

**Resultado esperado:**
- `ok: true`
- `frames_count: > 0` en frames
- Tile PNG válido

### 1.6 OpenSky Test

```bash
# Probar OAuth2 (requiere credenciales)
curl -X POST "${API_BASE}/api/opensky/test_oauth" \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "YOUR_CLIENT_ID",
    "client_secret": "YOUR_CLIENT_SECRET"
  }' | jq .

# Obtener muestra de vuelos
curl -s "${API_BASE}/api/opensky/sample" | jq .
```

**Resultado esperado:**
- `ok: true` si las credenciales son válidas
- `token_valid: true`
- `expires_in: <número>` en segundos
- `sample` con array de vuelos

### 1.7 AIS/Ships Test

```bash
# Probar AIS (requiere provider configurado)
curl -X POST "${API_BASE}/api/ais/test" \
  -H "Content-Type: application/json" \
  -d '{"provider": "aisstream"}' | jq .

# Probar AISStream
curl -X POST "${API_BASE}/api/ships/test" \
  -H "Content-Type: application/json" \
  -d '{"provider": "aisstream"}' | jq .
```

**Resultado esperado:**
- `ok: true` si la API key es válida
- `provider: "aisstream"` o el provider configurado

### 1.8 Blitzortung (Lightning) Test

```bash
# Probar MQTT
curl -X POST "${API_BASE}/api/lightning/test" \
  -H "Content-Type: application/json" \
  -d '{
    "mqtt_host": "127.0.0.1",
    "mqtt_port": 1883,
    "mqtt_topic": "blitzortung/1",
    "timeout_sec": 3
  }' | jq .

# Obtener últimos rayos
curl -s "${API_BASE}/api/lightning/last" | jq .

# Obtener estadísticas
curl -s "${API_BASE}/api/lightning/stats" | jq .
```

**Resultado esperado:**
- `ok: true` si MQTT está disponible
- `connected: true`
- `received: <número>` de rayos recibidos
- `latency_ms: <número>` en milisegundos

### 1.9 News Test

```bash
# Probar feeds RSS
curl -X POST "${API_BASE}/api/news/test" \
  -H "Content-Type: application/json" \
  -d '{
    "feeds": [
      "https://feeds.bbci.co.uk/news/rss.xml",
      "https://rss.nytimes.com/services/xml/rss/nyt/World.xml"
    ]
  }' | jq .

# Obtener muestra de noticias
curl -s "${API_BASE}/api/news/sample" | jq .
```

**Resultado esperado:**
- Array de resultados por feed
- `ok: true` para feeds válidos
- `error: <mensaje>` para feeds inválidos
- `items` con noticias parseadas

### 1.10 Calendar Test

```bash
# Probar calendario ICS
curl -X POST "${API_BASE}/api/calendar/test" \
  -H "Content-Type: application/json" \
  -d '{"source": "ics"}' | jq .

# Probar Google Calendar (requiere credenciales)
curl -X POST "${API_BASE}/api/calendar/test" \
  -H "Content-Type: application/json" \
  -d '{"source": "google"}' | jq .

# Obtener eventos
curl -s "${API_BASE}/api/calendar/events?from=2024-01-01&to=2024-01-31" | jq .

# Subir archivo ICS
curl -X POST "${API_BASE}/api/calendar/ics/upload" \
  -F "file=@/path/to/calendar.ics" | jq .
```

**Resultado esperado:**
- `ok: true` si el calendario es válido
- `source: "ics"` o `"google"`
- `count: <número>` de eventos encontrados
- `range_days: <número>` de días cubiertos

### 1.11 Historical Events Test

```bash
# Obtener efemérides históricas
curl -s "${API_BASE}/api/history?date=01-15&lang=es" | jq .

# Obtener efemérides de hoy
curl -s "${API_BASE}/api/history?lang=es" | jq .
```

**Resultado esperado:**
- `date: "01-15"` o fecha de hoy
- `count: <número>` de eventos
- `items: [<array>]` con eventos históricos

### 1.12 AEMET Test (Opcional)

```bash
# Probar AEMET (opcional, no bloqueante)
curl -X POST "${API_BASE}/api/aemet/test" \
  -H "Content-Type: application/json" \
  -d '{"api_key": "YOUR_AEMET_KEY"}' | jq .
```

**Resultado esperado:**
- `ok: true` si la API key es válida
- El sistema debe funcionar sin AEMET si falla

## 2. Pruebas de UI (Manual)

### 2.1 Configuración General

1. **Abrir `/config` en el navegador**
2. **Verificar que hay 3 bloques:**
   - Maps and Layers
   - Rotating Panel
   - Connectivity/Wi-Fi

3. **Verificar que cada bloque tiene:**
   - Botón "Guardar" independiente
   - Botones "Test" por proveedor

### 2.2 MapTiler V2

1. Ir a "Maps and Layers"
2. Seleccionar provider: "MapTiler Vector"
3. Configurar:
   - Style: `streets-v2`, `bright-v2`, o `dataviz-dark`
   - O usar URLs personalizadas en `maptiler.urls`
4. Click en "Test MapTiler"
5. **Verificar:**
   - Resultado muestra `ok: true`
   - Muestra bytes descargados
   - No hay errores

6. Click en "Guardar"
7. **Verificar:**
   - Mensaje de éxito
   - Configuración se guarda
   - No se borran otras claves del config

### 2.3 ICS Upload

1. Ir a "Rotating Panel" → "Calendar"
2. Seleccionar source: "ICS"
3. Seleccionar mode: "upload"
4. Click en "Choose File" y seleccionar archivo `.ics`
5. **Verificar:**
   - Barra de progreso aparece
   - Mensaje de éxito después de la subida
   - Muestra número de eventos encontrados
   - Archivo guardado se muestra

6. **Verificar que configuración anterior se preserva:**
   - Cambiar otros campos del calendario
   - Guardar
   - Verificar que `days_ahead` y otros campos se mantienen

### 2.4 Lightning Test

1. Ir a "Maps and Layers" → "Lightning"
2. Configurar MQTT:
   - Host: `127.0.0.1`
   - Port: `1883`
   - Topic: `blitzortung/1`
3. Click en "Test MQTT"
4. **Verificar:**
   - Resultado muestra `ok: true`
   - Muestra `connected: true`
   - Muestra rayos recibidos y latencia

5. Habilitar "Auto Storm Mode"
6. Configurar umbrales:
   - Threshold: `5` rayos
   - Radius: `50` km
7. Click en "Guardar"
8. **Verificar:**
   - Configuración se guarda
   - Modo tormenta se activa automáticamente si se cumplen los umbrales

### 2.5 Satélite y Radar

1. Ir a "Maps and Layers" → "Global Layers"
2. Habilitar "Satellite (GIBS)"
3. Click en "Test GIBS"
4. **Verificar:**
   - Resultado muestra `ok: true`
   - Muestra preview de tile si está disponible

5. Habilitar "Radar (RainViewer)"
6. Click en "Test RainViewer"
7. **Verificar:**
   - Resultado muestra `ok: true`
   - Muestra número de frames disponibles

8. **Verificar animación en el mapa:**
   - Ir a la vista principal del mapa
   - Verificar que las capas de satélite y radar se animan
   - Verificar que los frames avanzan según `frame_step`

### 2.6 Tests de Proveedores

Para cada proveedor en `/config`, verificar:

1. **Botón Test funciona:**
   - Click en "Test [Provider]"
   - Muestra resultado claro (éxito/error)
   - Muestra información relevante (API key status, eventos, etc.)

2. **Resultado es claro:**
   - Éxito: muestra información útil (token válido por X minutos, eventos encontrados, etc.)
   - Error: muestra mensaje de error claro y tips si están disponibles

3. **Guardar preserva configuración:**
   - Cambiar solo un campo del grupo
   - Guardar
   - Verificar que otros campos del grupo no se borran
   - Verificar que campos fuera del grupo no se borran

### 2.7 Deep-Merge Verification

1. **Crear configuración de prueba:**
   ```bash
   # Guardar config actual
   curl -s "${API_BASE}/api/config" > /tmp/config-before.json
   ```

2. **Modificar solo un sub-grupo:**
   ```bash
   curl -X PATCH "${API_BASE}/api/config/group/layers.flights" \
     -H "Content-Type: application/json" \
     -d '{"enabled": true, "refresh_seconds": 15}'
   ```

3. **Verificar que otras claves se mantienen:**
   ```bash
   curl -s "${API_BASE}/api/config" > /tmp/config-after.json
   diff <(jq -S '.layers.flights' /tmp/config-before.json) \
        <(jq -S '.layers.flights' /tmp/config-after.json)
   ```

4. **Verificar que no se borraron claves no presentes en el PATCH:**
   - `max_items_global` debe seguir presente
   - `rate_limit_per_min` debe seguir presente
   - Otros campos no modificados deben seguir presentes

## 3. Verificación de Regresiones

### 3.1 No Borrar Claves

**Prueba:**
1. Configurar completamente un grupo (ej: `layers.flights`)
2. Hacer PATCH solo con un subconjunto de campos
3. Verificar que campos no presentes en el PATCH se mantienen

**Resultado esperado:**
- Todos los campos originales se mantienen
- Solo los campos del PATCH se actualizan

### 3.2 Secrets No Expuestos

**Prueba:**
```bash
curl -s "${API_BASE}/api/config" | jq '.secrets'
```

**Resultado esperado:**
- No hay valores reales de API keys
- Solo metadatos: `has_api_key`, `api_key_last4`, etc.

### 3.3 MapTiler V2 URLs

**Prueba:**
1. Configurar MapTiler con style `streets-v2`
2. Verificar en el mapa que la URL generada es correcta
3. Verificar que el estilo se carga correctamente

**Resultado esperado:**
- URL contiene `streets-v2` o el estilo configurado
- Mapa se renderiza correctamente

### 3.4 AEMET No Bloqueante

**Prueba:**
1. No configurar AEMET o usar API key inválida
2. Verificar que el sistema funciona normalmente
3. Verificar que otros proveedores funcionan

**Resultado esperado:**
- Sistema funciona sin AEMET
- Otros proveedores no se ven afectados
- AEMET aparece como opcional en `/config`

## 4. Script de Verificación Automática

Crear script `scripts/verify_e2e.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:8081}"
ERRORS=0

test_endpoint() {
  local endpoint="$1"
  local description="$2"
  
  if curl -sf "${API_BASE}${endpoint}" >/dev/null; then
    echo "✓ ${description}"
  else
    echo "✗ ${description}"
    ((ERRORS++))
  fi
}

echo "=== E2E Tests ==="

test_endpoint "/api/health" "Health check"
test_endpoint "/api/config" "Config endpoint"
test_endpoint "/api/global/satellite/frames" "GIBS frames"
test_endpoint "/api/global/radar/frames" "RainViewer frames"

if [[ $ERRORS -eq 0 ]]; then
  echo "✓ All basic tests passed"
  exit 0
else
  echo "✗ ${ERRORS} test(s) failed"
  exit 1
fi
```

## 5. Checklist de Verificación

- [ ] Health check responde con `status=ok`
- [ ] Config endpoint no expone secretos
- [ ] PATCH hace deep-merge (no borra claves)
- [ ] Todos los tests de proveedores funcionan
- [ ] ICS upload funciona con progreso
- [ ] MapTiler v2 URLs correctas
- [ ] AEMET es opcional (no bloqueante)
- [ ] Lightning test funciona con MQTT
- [ ] Satélite y radar se animan en el mapa
- [ ] Modo tormenta se activa automáticamente
- [ ] Rotator incluye todos los paneles
- [ ] Logs rotativos funcionan
- [ ] Snapshots diarios de config funcionan

