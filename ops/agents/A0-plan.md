# A0 Plan de Orquestación v23 - Pantalla_reloj

**Versión:** 23.0  
**Target Platform:** Ubuntu 24.04 LTS + 8.8" 1920×480  
**Fecha de Inicio:** 2025-01-XX  
**Owner:** A0 Orquestador  

---

## 1. Alcance v23

### 1.1 Backend
- **Config persistente:** `/api/config` guarda sin rechazos, usando escrituras atómicas
- **ICS Uploader estable:** Uploader de archivos ICS funcionando y validado
- **Calendar ICS por defecto:** Calendario ICS por defecto funcionando
- **Dependencias:** Todas las dependencias como `python-multipart` instaladas en venv

### 1.2 Frontend
- **Rotador de paneles:** Sistema rotador completo (hora, clima actual + semanal, efemérides, santoral, calendario ICS)
- **Iconos full-color:** Paquete de iconos completo implementado
- **Control radar AEMET:** Integración completa de control de radar AEMET

### 1.3 Runtime
- **Servicios systemd estables:** `pantalla-dash-backend@dani` funcionando correctamente
- **Instalación idempotente:** Script de instalación puede ejecutarse múltiples veces sin errores
- **Logs claros:** Sistema de logging mejorado y estructurado

### 1.4 Proveedores
- **AEMET:** Radar + CAP funcionando
- **OpenSky:** OAuth2 implementado y estable
- **AIS:** Integración de barcos operativa

### 1.5 QA
- **Smoke tests:** `smoke_v23.sh` pasa completo (5/5 tests)
- **Documentación:** README/CHANGELOG actualizados
- **UX:** Paquete de iconos, mapeo y pruebas visuales completas

---

## 2. Riesgos Identificados

| ID | Riesgo | Probabilidad | Impacto | Mitigación | Owner |
|---|---|---|---|---|---|
| R1 | Usuario hardcodeado en systemd servicios | Alta | Crítico | Usar `@.service` con parámetros dinámicos | A1 |
| R2 | `python-multipart` no instalado en venv | Media | Alto | Verificar en `install.sh` + tests | A1 |
| R3 | ICS uploader inestable con archivos grandes | Media | Medio | Validar tamaño < 2MB + manejo de errores | A2 |
| R4 | Iconos full-color no se renderizan correctamente | Baja | Medio | Tests visuales + fallback a iconos simples | A3 |
| R5 | Radar AEMET no carga tiles | Media | Alto | Verificar credenciales + caché + endpoints | A4 |
| R6 | Rotador de paneles bloquea UI | Baja | Alto | Implementar debounce + lazy loading | A3 |
| R7 | Smoke tests fallan en entorno limpio | Media | Alto | Crear entorno Docker para tests repetibles | A7 |
| R8 | Dependencias faltantes en venv | Media | Crítico | Checklist de dependencias en `install.sh` | A1 |

---

## 3. Hitos

| Hito | Fecha Objetivo | DoD | Owner |
|---|---|---|---|
| H1: Backend estable | D+3 | `/api/config` persiste, ICS uploader OK, smoke 1-3 pasan | A1, A2 |
| H2: Frontend rotador | D+7 | Rotador muestra 6 paneles, iconos renderizan, smoke 4 pasa | A3 |
| H3: Proveedores integrados | D+10 | AEMET/OpenSky/AIS funcionando, smoke 5 pasa | A4, A5 |
| H4: Systemd robusto | D+12 | Instalación idempotente, logs claros, todos los servicios OK | A1 |
| H5: Smoke completo | D+15 | `smoke_v23.sh` 5/5, documentación actualizada | A7 |
| H6: Release | D+20 | PR merged a `main`, changelog actualizado, tag creado | A0 |

---

## 4. Definition of Done por Equipo

### 4.1 Backend (A1, A2)
- ✅ Todos los tests unitarios pasan (`pytest backend/tests/ -v`)
- ✅ `/api/config` GET/PATCH funcionan sin errores
- ✅ ICS uploader valida y guarda archivos correctamente
- ✅ Calendar ICS por defecto retorna eventos
- ✅ Todas las dependencias en `requirements.txt` instaladas
- ✅ `/api/health` retorna `{"status": "ok"}`
- ✅ `python-multipart` instalado y verificado

### 4.2 Frontend (A3)
- ✅ Rotador muestra 6 paneles: hora, clima, efemérides, santoral, calendario, clima semanal
- ✅ Iconos full-color renderizan correctamente
- ✅ Control radar AEMET habilitado/deshabilitado funciona
- ✅ Build de producción sin warnings (`npm run build`)
- ✅ UI responsiva en 1920×480
- ✅ No hay memory leaks detectados

### 4.3 Proveedores (A4, A5, A6)
- ✅ AEMET: Radar + CAP devuelven datos válidos
- ✅ OpenSky: OAuth2 funcionando, autenticación estable
- ✅ AIS: Barcos se muestran en mapa
- ✅ Rate limiting implementado
- ✅ Manejo de errores robusto (fallbacks, retries)

### 4.4 Runtime (A1, A7)
- ✅ `pantalla-dash-backend@dani` arranca sin errores
- ✅ Instalación idempotente: `install.sh` ejecutable múltiples veces
- ✅ Logs estructurados y legibles
- ✅ Permisos de archivos correctos
- ✅ `uninstall.sh` limpia completamente

### 4.5 QA (A7)
- ✅ `smoke_v23.sh` pasa 5/5 tests
- ✅ README actualizado con instrucciones v23
- ✅ CHANGELOG documenta cambios v23
- ✅ Pruebas visuales documentadas

---

## 5. Matriz de Owners

| Agente | Nombre | Responsabilidad | PRs Esperados | Comandos de Verificación |
|---|---|---|---|---|
| A0 | Orquestador | Coordinación, planificación, merge final | - | `python -m agents.coordinator.main reports/ -o informe.json` |
| A1 | Backend Core | `/api/config` persistente, systemd, venv | 1-2 | `pytest backend/tests/ -v; curl -sS http://127.0.0.1:8081/api/health` |
| A2 | ICS & Calendar | ICS uploader, calendar por defecto | 1 | `./scripts/smoke_v23.sh dani` (tests 2-4) |
| A3 | Frontend Rotador | Rotador paneles, iconos, control radar | 1-2 | `npm run build; npm test` |
| A4 | AEMET Provider | Radar + CAP, integración backend | 1 | `curl http://127.0.0.1:8081/api/aemet/*` |
| A5 | OpenSky Provider | OAuth2, autenticación | 1 | Tests de autenticación + rate limiting |
| A6 | AIS Provider | Barcos AIS, integración | 1 | Verificar barcos en mapa |
| A7 | QA & Docs | Smoke tests, README, CHANGELOG | 1 | `./scripts/smoke_v23.sh dani` (completo) |

---

## 6. Estrategia de Ramas y PRs

### 6.1 Estructura de Ramas
```
main (producción)
└── release/v23 (umbrella branch)
    ├── feature/A1-backend-config (backend core)
    ├── feature/A2-ics-calendar (ICS + calendar)
    ├── feature/A3-frontend-rotator (frontend rotador + iconos)
    ├── feature/A4-aemet (AEMET provider)
    ├── feature/A5-opensky (OpenSky OAuth2)
    ├── feature/A6-ais (AIS provider)
    └── feature/A7-qa-docs (tests + documentación)
```

### 6.2 Política de Merge
- **Merge de ramas hijas a `release/v23`:** PR squash + 1 reviewer aprobado
- **Merge de `release/v23` a `main`:** Solo tras smoke completo (5/5) + aprobación A0
- **Tags:** `v23.0`, `v23.1` (hotfixes)

### 6.3 Etiquetas de PR
- `backend`, `frontend`, `providers`, `runtime`, `qa`
- `breaking-change`, `bugfix`, `enhancement`
- `ready-for-merge`, `needs-review`, `wip`

---

## 7. Dependencias entre Agentes

```
A1 (Backend Core)
├── A2 (ICS & Calendar) [depende de A1]
├── A4 (AEMET) [depende de A1]
├── A5 (OpenSky) [depende de A1]
└── A6 (AIS) [depende de A1]

A3 (Frontend Rotador)
├── A2 [depende de endpoints calendar]
├── A4 [depende de endpoints AEMET]
└── A7 [depende de todos] [es el último]

A7 (QA & Docs)
└── Todos [integra todo y valida]
```

**Orden de merge sugerido:** A1 → A5 → A2 → A4 → A6 → A3 → A7

---

## 8. Reportes Esperados

Cada agente generará un reporte en formato JSON (`reports/agent-N.json`) con:
- Comandos de verificación ejecutados
- Salidas de curl/pytest/build
- Explicación de compatibilidad
- Lista de archivos modificados
- PRs creados

El coordinador (A0) validará todos los reportes antes de aprobar merges.

---

## 9. Checklist de Aceptación A0

- [ ] `ops/agents/A0-plan.md` existe y está completo
- [ ] `ops/trackers/v23.yml` existe con todos los sub-items
- [ ] Todas las ramas hijas creadas: `feature/A1-*` a `feature/A7-*`
- [ ] PRs iniciales creados para cada agente
- [ ] Plantilla de reporte smoke disponible
- [ ] Checklist de publicación disponible
- [ ] TODOs para A1-A7 creados en `ops/agents/`
- [ ] `release/v23` branch creada y protegida
- [ ] README actualizado con referencia a v23
- [ ] CHANGELOG preparado para v23

---

## 10. Comunicación y Sincronización

- **Daily standup:** A0 revisa progreso diariamente
- **Reportes:** Cada agente reporta diariamente su estado
- **Blockers:** Notificar inmediatamente a A0 si hay bloqueadores
- **Merge conflictos:** Resolver en orden de dependencias (A1 primero)

---

**Última actualización:** 2025-01-XX  
**Estado:** 🟢 Plan listo para ejecución

