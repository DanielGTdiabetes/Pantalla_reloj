# Plantilla de Reporte de Smoke Tests v23

**Fecha:** YYYY-MM-DD  
**Ejecutor:** Nombre del ejecutor  
**Entorno:** Ubuntu 24.04, usuario: dani  
**SHA:** commit hash  

---

## Resultado General

- **Total tests:** 5
- **Pasados:** X/5
- **Fallidos:** Y/5
- **Resultado:** ✅ PASS / ❌ FAIL

---

## Test 1: Health 200

**Comando:**
```bash
curl -sS http://127.0.0.1:8081/api/health
```

**Esperado:** HTTP 200, `{"status":"ok"}`

**Actual:**
```json
{
  "status": "ok",
  "timestamp": "2025-01-XX..."
}
```

**Resultado:** ✅ PASS / ❌ FAIL

**Notas:** (Opcional)

---

## Test 2: ICS Upload

**Comando:**
```bash
curl -X POST \
  -F "file=@test_calendar.ics" \
  -F "filename=test_calendar.ics" \
  http://127.0.0.1:8081/api/config/upload/ics
```

**Esperado:** HTTP 200

**Actual:**
```
HTTP 200
{"message": "ICS file uploaded successfully"}
```

**Resultado:** ✅ PASS / ❌ FAIL

**Notas:** (Opcional)

---

## Test 3: Activate Layers

**Comando:**
```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"layers":{"flights":{"enabled":true},"ships":{"enabled":true}}}' \
  http://127.0.0.1:8081/api/config
```

**Esperado:** HTTP 200

**Actual:**
```
HTTP 200
```

**Resultado:** ✅ PASS / ❌ FAIL

**Notas:** (Opcional)

---

## Test 4: Calendar Events >= 1

**Comando:**
```bash
curl http://127.0.0.1:8081/api/calendar/events
```

**Esperado:** HTTP 200, >= 1 evento

**Actual:**
```json
[
  {
    "uid": "test-event-001@v23.local",
    "summary": "Test Event v23",
    "start": "2025-01-01T10:00:00Z",
    ...
  }
]
```

**Resultado:** ✅ PASS / ❌ FAIL

**Notas:** (Opcional)

---

## Test 5: Calendar Status OK

**Comando:**
```bash
curl http://127.0.0.1:8081/api/calendar/status
```

**Esperado:** HTTP 200, `{"status":"ok"}`

**Actual:**
```json
{
  "status": "ok"
}
```

**Resultado:** ✅ PASS / ❌ FAIL

**Notas:** (Opcional)

---

## Resumen de Fallos

(Completar si hay fallos)

| Test | Descripción del Fallo | Archivo/Componente |
|---|---|---|
| X | Descripción | Componente afectado |

---

## Acciones Recomendadas

1. (Acción 1 si hay fallos)
2. (Acción 2 si hay fallos)

---

## Logs Relevantes

```bash
# Agregar logs relevantes aquí
journalctl -u pantalla-dash-backend@dani -n 100
```

---

## Firmas

- **Ejecutor:** Nombre, Fecha
- **Revisión:** Nombre, Fecha
- **Aprobación Release:** Nombre, Fecha

