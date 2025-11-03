# A5 TODO - OpenSky Provider

**Owner:** A5 OpenSky Provider Developer  
**Dependencias:** A1 (backend core)  
**Branch:** `feature/A5-opensky`  
**PR Target:** `release/v23`

---

## Objetivo

Implementar OAuth2 para OpenSky y asegurar autenticación estable:
- OAuth2 funcionando
- Autenticación persistente
- Rate limiting implementado

---

## Entregables

### 1. OAuth2 Flow
- [ ] Implementar flow completo de OAuth2 con OpenSky
- [ ] Validar que los tokens se obtienen correctamente
- [ ] Test: verificar que autenticación funciona
- [ ] Implementar refresh de tokens automático

### 2. Persistencia de Autenticación
- [ ] Validar que la autenticación persiste entre requests
- [ ] Implementar almacenamiento seguro de tokens
- [ ] Test: verificar que no se pierde autenticación tras reinicio
- [ ] Validar que los tokens se refrescan antes de expirar

### 3. Rate Limiting
- [ ] Implementar rate limit de 6 req/min según especificación
- [ ] Validar que el rate limiter funciona correctamente
- [ ] Test: verificar que excede rate limit retorna error apropiado
- [ ] Implementar backoff exponencial si rate limit excedido

### 4. Manejo de Errores
- [ ] Implementar fallbacks en caso de error
- [ ] Validar manejo de timeouts
- [ ] Test: verificar que errores no rompen UI
- [ ] Implementar logging claro de errores

---

## Tests de Aceptación

```bash
# Test 1: OAuth2 flow funciona
# Configurar credenciales OpenSky
# Ejecutar flujo de autenticación
curl http://127.0.0.1:8081/api/layers/flights
# Esperado: HTTP 200, datos de vuelos

# Test 2: Autenticación persiste
# Hacer múltiples requests
curl http://127.0.0.1:8081/api/layers/flights
curl http://127.0.0.1:8081/api/layers/flights
curl http://127.0.0.1:8081/api/layers/flights
# Esperado: Todos HTTP 200

# Test 3: Rate limiting funciona
# Hacer 7+ requests en < 1 minuto
# Esperado: Request 7+ retorna rate limit error

# Test 4: Tokens refresh automático
# Esperar hasta que token expire
# Hacer request
# Esperado: Token se refresca automáticamente

# Test 5: Fallbacks en error
# Invalidar credenciales
curl http://127.0.0.1:8081/api/layers/flights
# Esperado: Error manejado gracefully
```

---

## Comandos de Verificación

```bash
# Verificar OAuth2
curl http://127.0.0.1:8081/api/layers/flights | jq

# Verificar rate limiting
for i in {1..10}; do curl http://127.0.0.1:8081/api/layers/flights; sleep 5; done

# Verificar autenticación
journalctl -u pantalla-dash-backend@dani -n 50 | grep OpenSky

# Verificar tokens
curl http://127.0.0.1:8081/api/config | jq '.layers.flights.opensky'
```

---

## Reporte Final

Generar `reports/agent-5.json` con:

```json
{
  "agent": "agent-5",
  "branch": "feature/A5-opensky",
  "prs": ["https://github.com/.../pull/..."],
  "changed_files": [
    "backend/main.py",
    "backend/services/opensky_auth.py",
    "backend/services/opensky_client.py",
    "backend/services/opensky_service.py",
    "backend/rate_limiter.py"
  ],
  "tests_ok": true,
  "manual_checks_ok": true,
  "api_health": {
    "ok": true,
    "status_code": 200
  },
  "config_persists": true,
  "verification_commands": [
    "curl http://127.0.0.1:8081/api/layers/flights",
    "journalctl -u pantalla-dash-backend@dani | grep OpenSky"
  ],
  "verification_outputs": {
    "flights": "{\"flights\":[...]}",
    "auth": "Successfully authenticated"
  },
  "health_check_curl": "{\"status\":\"ok\",...}",
  "compatibility_explanation": "Los cambios son compatibles porque: 1) OAuth2 es una mejora de autenticación que no rompe API existente, 2) El rate limiting es transparente al usuario, 3) Los fallbacks mantienen funcionalidad básica."
}
```

---

## Criterios de Aceptación

- [x] OAuth2 flow funciona correctamente
- [x] Autenticación persiste entre requests
- [x] Rate limit 6 req/min implementado
- [x] Tokens refresh automático funciona
- [x] Fallbacks en caso de error
- [x] Logs claros de autenticación

---

**Estado:** Pending  
**Última actualización:** 2025-01-XX

