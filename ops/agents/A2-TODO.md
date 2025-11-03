# A2 TODO - ICS & Calendar

**Owner:** A2 ICS & Calendar Developer  
**Dependencias:** A1 (backend core)  
**Branch:** `feature/A2-ics-calendar`  
**PR Target:** `release/v23`

---

## Objetivo

Implementar y estabilizar la funcionalidad de calendario ICS:
- ICS uploader estable
- Calendar ICS por defecto funcionando
- Endpoints de validación y estado

---

## Entregables

### 1. ICS Uploader Estable
- [ ] Validar que `POST /api/config/upload/ics` acepta archivos .ics
- [ ] Verificar que valida tamaño < 2MB
- [ ] Test: subir archivo ICS válido y verificar que se guarda
- [ ] Test: subir archivo inválido y verificar manejo de error
- [ ] Validar que el archivo se guarda en ubicación segura

### 2. Calendar ICS por Defecto
- [ ] Configurar calendar ICS por defecto en `backend/default_config.json`
- [ ] Verificar que `GET /api/calendar/events` retorna eventos del ICS por defecto
- [ ] Test: verificar que se cargan eventos sin configuración manual
- [ ] Validar que el formato ICS (RFC 5545) se parsea correctamente

### 3. Endpoints de Calendar
- [ ] `GET /api/calendar/events` retorna eventos del ICS
- [ ] `GET /api/calendar/status` retorna `{"status":"ok"}` si funciona
- [ ] Validar manejo de errores en todos los endpoints
- [ ] Verificar que los eventos incluyen UID, DTSTART, DTEND, SUMMARY

### 4. Validación y Manejo de Errores
- [ ] Validar formato ICS (BEGIN:VCALENDAR, VEVENT, etc.)
- [ ] Manejar errores de archivo corrupto
- [ ] Manejar errores de red (si ICS es URL remota)
- [ ] Logs claros de errores

---

## Tests de Aceptación

```bash
# Test 1: ICS Upload funciona
curl -X POST \
  -F "file=@test_calendar.ics" \
  -F "filename=test_calendar.ics" \
  http://127.0.0.1:8081/api/config/upload/ics
# Esperado: HTTP 200

# Test 2: Calendar Events retorna eventos
curl http://127.0.0.1:8081/api/calendar/events
# Esperado: HTTP 200, array de eventos

# Test 3: Calendar Status OK
curl http://127.0.0.1:8081/api/calendar/status
# Esperado: HTTP 200, {"status":"ok"}

# Test 4: Manejo de error en upload inválido
curl -X POST \
  -F "file=@invalid.ics" \
  -F "filename=invalid.ics" \
  http://127.0.0.1:8081/api/config/upload/ics
# Esperado: HTTP 400 o 422

# Test 5: ICS por defecto funciona
# Configurar ICS por defecto en default_config.json
# GET /api/calendar/events debe retornar eventos
curl http://127.0.0.1:8081/api/calendar/events | jq 'length'
# Esperado: >= 1
```

---

## Archivo ICS de Prueba

Crear `test_calendar.ics`:

```ics
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Calendar v23//EN
BEGIN:VEVENT
UID:test-event-001@v23.local
DTSTART:20250101T100000Z
DTEND:20250101T110000Z
SUMMARY:Test Event v23
DESCRIPTION:Smoke test event for v23
LOCATION:Test Location
END:VEVENT
END:VCALENDAR
```

---

## Comandos de Verificación

```bash
# Verificar ICS upload
curl -X POST -F "file=@test_calendar.ics" -F "filename=test_calendar.ics" \
  http://127.0.0.1:8081/api/config/upload/ics

# Verificar calendar events
curl http://127.0.0.1:8081/api/calendar/events | jq

# Verificar calendar status
curl http://127.0.0.1:8081/api/calendar/status | jq

# Smoke tests específicos
./scripts/smoke_v23.sh dani  # Tests 2, 3, 4 deben pasar
```

---

## Reporte Final

Generar `reports/agent-2.json` con:

```json
{
  "agent": "agent-2",
  "branch": "feature/A2-ics-calendar",
  "prs": ["https://github.com/.../pull/..."],
  "changed_files": [
    "backend/data_sources_ics.py",
    "backend/main.py",
    "backend/default_config.json",
    "backend/models.py"
  ],
  "tests_ok": true,
  "manual_checks_ok": true,
  "api_health": {
    "ok": true,
    "status_code": 200
  },
  "config_persists": true,
  "verification_commands": [
    "./scripts/smoke_v23.sh dani  # tests 2-4"
  ],
  "verification_outputs": {
    "smoke_test_2": "[smoke][OK] ICS subido correctamente → HTTP 200",
    "smoke_test_3": "[smoke][OK] Layers activados → HTTP 200",
    "smoke_test_4": "[smoke][OK] Eventos de calendario: X >= 1"
  },
  "health_check_curl": "{\"status\":\"ok\",...}",
  "compatibility_explanation": "Los cambios son compatibles porque: 1) Los endpoints ICS son nuevos y no rompen funcionalidad existente, 2) El calendar ICS por defecto es una opción adicional, 3) Los modelos de datos se mantienen compatibles."
}
```

---

## Criterios de Aceptación

- [x] `POST /api/config/upload/ics` acepta archivos .ics válidos
- [x] `GET /api/calendar/events` retorna >= 1 evento
- [x] `GET /api/calendar/status` retorna `{"status":"ok"}`
- [x] Validación de tamaño < 2MB funciona
- [x] Manejo de errores robusto
- [x] Calendar ICS por defecto carga eventos
- [x] Smoke tests 2-4 pasan

---

**Estado:** Pending  
**Última actualización:** 2025-01-XX

