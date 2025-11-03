# A1 TODO - Backend Core

**Owner:** A1 Backend Core Developer  
**Dependencias:** Ninguna  
**Branch:** `feature/A1-backend-config`  
**PR Target:** `release/v23`

---

## Objetivo

Garantizar que el backend base esté estable y funcional, con especial énfasis en:
- Persistencia de `/api/config` sin rechazos
- Servicios systemd robustos
- Instalación idempotente
- Dependencias completas en venv

---

## Entregables

### 1. `/api/config` Persistente
- [ ] Validar que `POST /api/config` usa escrituras atómicas
- [ ] Verificar que no hay race conditions en write
- [ ] Test: hacer 10 writes consecutivos y verificar que todos persisten
- [ ] Test: verificar atomicidad con `write_config_atomic()` en `backend/config_store.py`

### 2. Servicios systemd Estables
- [ ] Verificar que `pantalla-dash-backend@dani` arranca sin errores
- [ ] Validar que no hay usuario hardcodeado (usar `@.service`)
- [ ] Revisar logs de systemd: `journalctl -u pantalla-dash-backend@dani -n 100`
- [ ] Asegurar que el servicio reinicia correctamente si falla
- [ ] Verificar que `pantalla-backend-launch` maneja errores correctamente

### 3. Instalación Idempotente
- [ ] Ejecutar `install.sh` 3 veces consecutivas sin errores
- [ ] Verificar que no hay errores de archivos ya existentes
- [ ] Validar que permisos se restauran correctamente
- [ ] Verificar que directorios se crean solo si no existen

### 4. Dependencias en venv
- [ ] Verificar que `python-multipart` está en `requirements.txt`
- [ ] Verificar que `python-multipart` importa correctamente: `python -c "import multipart"`
- [ ] Validar que todas las dependencias de `backend/requirements.txt` están instaladas
- [ ] Ejecutar `pip list` y verificar lista completa

### 5. Logs Claros
- [ ] Revisar logs de arranque del backend
- [ ] Validar que los logs incluyen timestamps
- [ ] Verificar que los niveles de log son apropiados (INFO, WARNING, ERROR)
- [ ] Asegurar que no hay logs de DEBUG en producción

---

## Tests de Aceptación

```bash
# Test 1: /api/health funciona
curl -sS http://127.0.0.1:8081/api/health
# Esperado: HTTP 200, {"status":"ok"}

# Test 2: pytest pasa
cd backend && pytest tests/ -v
# Esperado: Todos los tests pasan

# Test 3: systemd activo
systemctl status pantalla-dash-backend@dani
# Esperado: active (running)

# Test 4: python-multipart importa
python3 -c "import multipart; print('OK')"
# Esperado: OK

# Test 5: /api/config persiste
curl -X POST -H "Content-Type: application/json" \
  -d '{"layers":{"test":"value"}}' \
  http://127.0.0.1:8081/api/config
# Esperado: HTTP 200

curl http://127.0.0.1:8081/api/config | grep -q "test"
# Esperado: HTTP 200, contiene "test"
```

---

## Comandos de Verificación

```bash
# Verificar instalación
sudo ./scripts/install.sh

# Verificar servicios
systemctl status pantalla-dash-backend@dani
journalctl -u pantalla-dash-backend@dani -n 50

# Verificar venv
source /opt/pantalla/backend/.venv/bin/activate
pip list | grep python-multipart
python -c "import multipart; print('OK')"

# Tests
pytest backend/tests/ -v

# Health check
curl -sS http://127.0.0.1:8081/api/health
```

---

## Reporte Final

Generar `reports/agent-1.json` con:

```json
{
  "agent": "agent-1",
  "branch": "feature/A1-backend-config",
  "prs": ["https://github.com/.../pull/..."],
  "changed_files": [
    "backend/config_store.py",
    "backend/main.py",
    "scripts/install.sh",
    "backend/requirements.txt"
  ],
  "tests_ok": true,
  "manual_checks_ok": true,
  "api_health": {
    "ok": true,
    "status_code": 200,
    "response_body": "{\"status\":\"ok\",...}"
  },
  "config_persists": true,
  "verification_commands": [
    "pytest backend/tests/ -v",
    "curl -sS http://127.0.0.1:8081/api/health",
    "systemctl status pantalla-dash-backend@dani"
  ],
  "verification_outputs": {
    "pytest": "... passed: XX in Y.Ys ...",
    "curl": "{\"status\":\"ok\",...}",
    "systemctl": "Active: active (running)"
  },
  "health_check_curl": "{\"status\":\"ok\",\"timestamp\":\"...\"}",
  "compatibility_explanation": "Los cambios son compatibles porque: 1) Se usan escrituras atómicas para /api/config, 2) Los servicios systemd usan @.service para múltiples usuarios, 3) La instalación verifica dependencias antes de arrancar."
}
```

---

## Criterios de Aceptación

- [x] `pytest backend/tests/ -v` pasa 100%
- [x] `curl -sS http://127.0.0.1:8081/api/health` retorna HTTP 200, status=ok
- [x] `POST /api/config` persiste correctamente
- [x] `systemctl status pantalla-dash-backend@dani` activo
- [x] `python-multipart` instalado y funcional
- [x] `install.sh` ejecutable múltiples veces sin errores
- [x] Logs claros y legibles

---

**Estado:** Pending  
**Última actualización:** 2025-01-XX

