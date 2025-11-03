# A7 TODO - QA & Docs

**Owner:** A7 QA & Docs Developer  
**Dependencias:** A1, A2, A3, A4, A5, A6 (todos los agentes)  
**Branch:** `feature/A7-qa-docs`  
**PR Target:** `release/v23`

---

## Objetivo

Validar completamente la versión 23:
- Smoke tests completos (5/5)
- Documentación actualizada
- Guía de pruebas visuales

---

## Entregables

### 1. Smoke Tests Completos
- [ ] Ejecutar `./scripts/smoke_v23.sh dani` y verificar 5/5 tests pasan
- [ ] Test 1: Health 200
- [ ] Test 2: ICS Upload
- [ ] Test 3: Activate Layers
- [ ] Test 4: Calendar Events >= 1
- [ ] Test 5: Calendar Status OK
- [ ] Documentar resultados

### 2. README Actualizado
- [ ] Actualizar README con cambios v23
- [ ] Documentar nuevas funcionalidades
- [ ] Actualizar instrucciones de instalación
- [ ] Documentar configuración de ICS
- [ ] Documentar proveedores (AEMET, OpenSky, AIS)

### 3. CHANGELOG Actualizado
- [ ] Agregar entrada v23 al CHANGELOG
- [ ] Listar todas las funcionalidades nuevas
- [ ] Documentar bugfixes
- [ ] Documentar breaking changes (si los hay)
- [ ] Verificar formato y consistencia

### 4. Guía de Pruebas Visuales
- [ ] Crear guía de pruebas visuales
- [ ] Documentar cómo probar cada panel del rotador
- [ ] Documentar cómo probar iconos
- [ ] Documentar cómo probar radar AEMET
- [ ] Documentar cómo probar configuración

### 5. Reporte Final de QA
- [ ] Generar reporte final de QA
- [ ] Documentar todos los tests ejecutados
- [ ] Documentar resultados
- [ ] Identificar issues conocidos
- [ ] Aprobar para release

---

## Tests de Aceptación

```bash
# Test 1: Smoke tests completos
./scripts/smoke_v23.sh dani
# Esperado: 5/5 tests pasan, exit code 0

# Test 2: README actualizado
grep -q "v23" README.md
# Esperado: Salida contiene "v23"

# Test 3: CHANGELOG actualizado
grep -A 50 "## v23" CHANGELOG.md
# Esperado: CHANGELOG tiene entrada v23 con detalles

# Test 4: Guía de pruebas visuales
ls ops/agents/A7-viz-guide.md
# Esperado: Archivo existe

# Test 5: Reporte final
ls reports/informe_final_v23.json
# Esperado: Archivo existe
```

---

## Comandos de Verificación

```bash
# Ejecutar smoke tests
./scripts/smoke_v23.sh dani

# Verificar README
grep -i "v23" README.md

# Verificar CHANGELOG
head -100 CHANGELOG.md | grep "## v23"

# Ejecutar tests completos
cd backend && pytest tests/ -v
cd ../dash-ui && npm test

# Verificar documentación
ls -la README.md CHANGELOG.md ops/agents/*.md
```

---

## Reporte Final

Generar `reports/agent-7.json` con:

```json
{
  "agent": "agent-7",
  "branch": "feature/A7-qa-docs",
  "prs": ["https://github.com/.../pull/..."],
  "changed_files": [
    "README.md",
    "CHANGELOG.md",
    "ops/agents/A7-viz-guide.md",
    "scripts/smoke_v23.sh"
  ],
  "tests_ok": true,
  "manual_checks_ok": true,
  "api_health": {
    "ok": true,
    "status_code": 200
  },
  "config_persists": true,
  "verification_commands": [
    "./scripts/smoke_v23.sh dani",
    "pytest backend/tests/ -v",
    "npm test"
  ],
  "verification_outputs": {
    "smoke": "[smoke][OK] Todos los smoke tests E2E v23 pasaron correctamente",
    "pytest": "... passed: XX in Y.Ys ...",
    "npm_test": "... passed in ...s"
  },
  "health_check_curl": "{\"status\":\"ok\",...}",
  "compatibility_explanation": "Los cambios son compatibles porque: 1) La documentación no afecta funcionalidad, 2) Los smoke tests validan integración completa, 3) No hay breaking changes en v23."
}
```

---

## Criterios de Aceptación

- [x] `./scripts/smoke_v23.sh dani` pasa 5/5 tests
- [x] README actualizado con v23
- [x] CHANGELOG tiene entrada v23 completa
- [x] Guía de pruebas visuales disponible
- [x] Reporte final de QA generado
- [x] Aprobación para release

---

**Estado:** Pending  
**Última actualización:** 2025-01-XX

