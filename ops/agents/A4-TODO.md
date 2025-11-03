# A4 TODO - AEMET Provider

**Owner:** A4 AEMET Provider Developer  
**Dependencias:** A1 (backend core)  
**Branch:** `feature/A4-aemet`  
**PR Target:** `release/v23`

---

## Objetivo

Implementar integración completa con AEMET:
- Radar + CAP funcionando
- Endpoints de validación
- Manejo seguro de credenciales

---

## Entregables

### 1. Endpoints AEMET
- [ ] `GET /api/aemet/test_key` valida API key
- [ ] `GET /api/aemet/radar` devuelve tiles válidos
- [ ] `GET /api/aemet/cap` devuelve GeoJSON válido de avisos
- [ ] Test: verificar que los endpoints funcionan con credenciales válidas
- [ ] Test: verificar manejo de errores con credenciales inválidas

### 2. Manejo de Credenciales
- [ ] Validar que API key se almacena de forma segura
- [ ] Verificar que no se expone en `/api/config`
- [ ] Implementar `has_api_key` y `api_key_last4` en respuestas
- [ ] Test: verificar que las credenciales persisten

### 3. Integración con Cine Focus
- [ ] Verificar que los datos de radar se usan en máscaras de foco
- [ ] Validar que CAP se integra en `cine_focus.mode = "both"`
- [ ] Test: verificar que las máscaras se generan correctamente

### 4. Rate Limiting y Fallbacks
- [ ] Implementar rate limiting adecuado
- [ ] Implementar fallbacks en caso de error
- [ ] Validar manejo de timeouts
- [ ] Test: verificar que fallbacks no rompen UI

---

## Tests de Aceptación

```bash
# Test 1: Validar API key
curl http://127.0.0.1:8081/api/aemet/test_key
# Esperado: HTTP 200, {"ok":true/false}

# Test 2: Obtener radar
curl http://127.0.0.1:8081/api/aemet/radar
# Esperado: HTTP 200, tiles válidos

# Test 3: Obtener CAP
curl http://127.0.0.1:8081/api/aemet/cap
# Esperado: HTTP 200, GeoJSON válido

# Test 4: Manejo de error
# Invalidar API key
curl http://127.0.0.1:8081/api/aemet/test_key
# Esperado: HTTP 401 o 403

# Test 5: Cine focus con AEMET
# Activar cine_focus con mode="both"
# Verificar que máscaras se generan
curl http://127.0.0.1:8081/api/layers/flights?focus=1
# Esperado: HTTP 200, máscaras generadas
```

---

## Comandos de Verificación

```bash
# Validar API key
curl http://127.0.0.1:8081/api/aemet/test_key | jq

# Obtener radar
curl http://127.0.0.1:8081/api/aemet/radar | jq

# Obtener CAP
curl http://127.0.0.1:8081/api/aemet/cap | jq

# Verificar integración con focus_masks
python3 -c "
from backend.focus_masks import build_focus_mask
mask = build_focus_mask(mode='both', ...)
print(mask)
"

# Logs
journalctl -u pantalla-dash-backend@dani -n 50 | grep AEMET
```

---

## Reporte Final

Generar `reports/agent-4.json` con:

```json
{
  "agent": "agent-4",
  "branch": "feature/A4-aemet",
  "prs": ["https://github.com/.../pull/..."],
  "changed_files": [
    "backend/main.py",
    "backend/focus_masks.py",
    "backend/models.py",
    "backend/services/aemet_service.py"
  ],
  "tests_ok": true,
  "manual_checks_ok": true,
  "api_health": {
    "ok": true,
    "status_code": 200
  },
  "config_persists": true,
  "verification_commands": [
    "curl http://127.0.0.1:8081/api/aemet/test_key",
    "curl http://127.0.0.1:8081/api/aemet/radar",
    "curl http://127.0.0.1:8081/api/aemet/cap"
  ],
  "verification_outputs": {
    "test_key": "{\"ok\":true}",
    "radar": "{\"tiles\":[...]}",
    "cap": "{\"features\":[...]}"
  },
  "health_check_curl": "{\"status\":\"ok\",...}",
  "compatibility_explanation": "Los cambios son compatibles porque: 1) Los endpoints AEMET son nuevos y no rompen funcionalidad existente, 2) Las máscaras de foco usan datos AEMET de forma opcional, 3) El manejo de credenciales sigue el patrón existente."
}
```

---

## Criterios de Aceptación

- [x] `GET /api/aemet/test_key` valida API key correctamente
- [x] `GET /api/aemet/radar` devuelve tiles válidos
- [x] `GET /api/aemet/cap` devuelve GeoJSON válido
- [x] Rate limiting implementado
- [x] Fallbacks en caso de error
- [x] Integración con cine focus funciona

---

**Estado:** Pending  
**Última actualización:** 2025-01-XX

