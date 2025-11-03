# A3 TODO - Frontend Rotador

**Owner:** A3 Frontend Rotador Developer  
**Dependencias:** A1 (backend core), A2 (calendar)  
**Branch:** `feature/A3-frontend-rotator`  
**PR Target:** `release/v23`

---

## Objetivo

Implementar y estabilizar el rotador de paneles frontend:
- Rotador con 6 paneles funcionando
- Iconos full-color renderizando
- Control de radar AEMET en UI

---

## Entregables

### 1. Rotador de Paneles
- [ ] Implementar rotación automática entre 6 paneles:
  - Hora/fecha
  - Clima actual
  - Clima semanal
  - Efemérides
  - Santoral
  - Calendario ICS
- [ ] Configurar intervalos de rotación configurables
- [ ] Test: verificar que todos los paneles se muestran correctamente
- [ ] Test: verificar transiciones suaves

### 2. Iconos Full-Color
- [ ] Verificar que iconos de `dash-ui/public/icons/` se cargan correctamente:
  - astronomy (12 archivos SVG)
  - harvest (24 archivos SVG)
  - misc (3 archivos SVG)
  - moon (5 archivos SVG)
  - weather (27 archivos SVG)
- [ ] Test: verificar que iconos renderizan en 1920×480
- [ ] Implementar fallback si iconos faltan
- [ ] Validar que no hay errores de carga

### 3. Control Radar AEMET
- [ ] Agregar toggle radar AEMET en `/config`
- [ ] Validar que el toggle activa/desactiva radar
- [ ] Test: verificar que los cambios persisten
- [ ] Verificar integración con backend

### 4. Optimización UI
- [ ] Verificar que no hay memory leaks
- [ ] Implementar debounce en rotaciones
- [ ] Implementar lazy loading de paneles
- [ ] Validar responsividad en 1920×480

---

## Tests de Aceptación

```bash
# Test 1: Build sin warnings
cd dash-ui && npm run build
# Esperado: Build exitoso, sin warnings

# Test 2: Tests pasan
npm test
# Esperado: Todos los tests pasan

# Test 3: Rotador muestra 6 paneles
# Manual: Abrir / en navegador, verificar rotación
# Esperado: 6 paneles diferentes se muestran

# Test 4: Iconos renderizan
# Manual: Verificar que iconos se muestran correctamente
# Esperado: Iconos full-color visibles

# Test 5: Control AEMET funciona
# Manual: Toggle radar en /config, verificar persistencia
# Esperado: Radar se activa/desactiva correctamente
```

---

## Comandos de Verificación

```bash
# Build
cd dash-ui && npm run build

# Tests
npm test

# Dev server
npm run dev

# Verificar iconos
ls -la public/icons/*/*.svg

# Linter
npm run lint
```

---

## Reporte Final

Generar `reports/agent-3.json` con:

```json
{
  "agent": "agent-3",
  "branch": "feature/A3-frontend-rotator",
  "prs": ["https://github.com/.../pull/..."],
  "changed_files": [
    "dash-ui/src/components/Rotator.tsx",
    "dash-ui/src/modules/",
    "dash-ui/public/icons/",
    "dash-ui/src/pages/ConfigPage.tsx"
  ],
  "tests_ok": true,
  "manual_checks_ok": true,
  "api_health": {
    "ok": true,
    "status_code": 200
  },
  "config_persists": true,
  "verification_commands": [
    "npm run build",
    "npm test",
    "npm run lint"
  ],
  "verification_outputs": {
    "build": "built in ... with no warnings",
    "test": "... passed in ...s",
    "lint": "No linting errors"
  },
  "health_check_curl": "{\"status\":\"ok\",...}",
  "compatibility_explanation": "Los cambios son compatibles porque: 1) El rotador es una funcionalidad nueva que no rompe componentes existentes, 2) Los iconos son aditivos y no modifican lógica, 3) El control AEMET es una extensión de /config."
}
```

---

## Criterios de Aceptación

- [x] `npm run build` sin warnings
- [x] `npm test` pasa 100%
- [x] Rotador muestra 6 paneles correctamente
- [x] Iconos full-color renderizan
- [x] Control AEMET toggle funciona
- [x] UI responsiva en 1920×480
- [x] No memory leaks detectados

---

**Estado:** Pending  
**Última actualización:** 2025-01-XX

