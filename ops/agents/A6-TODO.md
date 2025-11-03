# A6 TODO - AIS Provider

**Owner:** A6 AIS Provider Developer  
**Dependencias:** A1 (backend core)  
**Branch:** `feature/A6-ais`  
**PR Target:** `release/v23`

---

## Objetivo

Implementar integración completa con AIS:
- Barcos mostrados en mapa
- Actualización en tiempo real
- Rate limiting implementado

---

## Entregables

### 1. Integración AIS Operativa
- [ ] Validar que `GET /api/layers/ships` devuelve barcos válidos
- [ ] Test: verificar que los datos se parsean correctamente
- [ ] Implementar actualización cada 10s según especificación
- [ ] Validar que los barcos se muestran en mapa correctamente

### 2. Actualización en Tiempo Real
- [ ] Implementar polling de datos AIS
- [ ] Validar que la actualización ocurre cada 10s
- [ ] Test: verificar que no hay memory leaks
- [ ] Optimizar para reducir carga de red

### 3. Rate Limiting y Fallbacks
- [ ] Implementar rate limit adecuado
- [ ] Implementar fallbacks en caso de error
- [ ] Validar manejo de timeouts
- [ ] Test: verificar que fallbacks no rompen UI

### 4. Integración con Mapa
- [ ] Verificar que barcos se renderizan en GeoScopeMap
- [ ] Validar estilos y colores de barcos
- [ ] Test: verificar que la visualización es correcta
- [ ] Optimizar renderizado de muchos barcos

---

## Tests de Aceptación

```bash
# Test 1: Barcos se obtienen
curl http://127.0.0.1:8081/api/layers/ships | jq
# Esperado: HTTP 200, array de barcos

# Test 2: Actualización cada 10s funciona
# Hacer 3 requests con 12s de diferencia
curl http://127.0.0.1:8081/api/layers/ships | jq 'length'
sleep 12
curl http://127.0.0.1:8081/api/layers/ships | jq 'length'
sleep 12
curl http://127.0.0.1:8081/api/layers/ships | jq 'length'
# Esperado: Datos diferentes o más actualizados

# Test 3: Barcos se renderizan en mapa
# Manual: Abrir / en navegador, verificar que barcos se muestran
# Esperado: Barcos visibles en mapa

# Test 4: Rate limiting funciona
# Hacer múltiples requests rápidamente
# Esperado: Rate limiting aplicado

# Test 5: Fallbacks en error
# Invalidar configuración AIS
curl http://127.0.0.1:8081/api/layers/ships
# Esperado: Error manejado gracefully
```

---

## Comandos de Verificación

```bash
# Verificar barcos
curl http://127.0.0.1:8081/api/layers/ships | jq

# Verificar actualización
watch -n 2 'curl -s http://127.0.0.1:8081/api/layers/ships | jq "length"'

# Verificar rate limiting
for i in {1..10}; do curl http://127.0.0.1:8081/api/layers/ships; sleep 1; done

# Verificar logs
journalctl -u pantalla-dash-backend@dani -n 50 | grep AIS

# Verificar configuración
curl http://127.0.0.1:8081/api/config | jq '.layers.ships'
```

---

## Reporte Final

Generar `reports/agent-6.json` con:

```json
{
  "agent": "agent-6",
  "branch": "feature/A6-ais",
  "prs": ["https://github.com/.../pull/..."],
  "changed_files": [
    "backend/main.py",
    "backend/services/ships_service.py",
    "backend/layer_providers.py"
  ],
  "tests_ok": true,
  "manual_checks_ok": true,
  "api_health": {
    "ok": true,
    "status_code": 200
  },
  "config_persists": true,
  "verification_commands": [
    "curl http://127.0.0.1:8081/api/layers/ships",
    "journalctl -u pantalla-dash-backend@dani | grep AIS"
  ],
  "verification_outputs": {
    "ships": "{\"ships\":[...]}",
    "update": "Ships updated successfully"
  },
  "health_check_curl": "{\"status\":\"ok\",...}",
  "compatibility_explanation": "Los cambios son compatibles porque: 1) La integración AIS es nueva y no rompe funcionalidad existente, 2) Los barcos se renderizan independientemente de otras capas, 3) Los fallbacks mantienen funcionalidad básica."
}
```

---

## Criterios de Aceptación

- [x] `GET /api/layers/ships` devuelve barcos válidos
- [x] Barcos se renderizan en mapa
- [x] Actualización cada 10s funciona
- [x] Rate limiting implementado
- [x] Fallbacks en caso de error
- [x] No memory leaks detectados

---

**Estado:** Pending  
**Última actualización:** 2025-01-XX

