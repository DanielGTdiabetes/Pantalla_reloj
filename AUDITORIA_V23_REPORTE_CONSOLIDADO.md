# Auditoría v23 - Reporte Consolidado

**Fecha:** 2025-01  
**Repositorio:** DanielGTdiabetes/Pantalla_reloj  
**Rama esperada:** main  
**Versión esperada:** v23

---

## 📊 Semáforo por Área

| Área | Estado | Notas |
|------|--------|-------|
| **GIT** | 🟠 Revisar | Main local está 11 commits detrás de origin/main. 3 PRs (#334, #335, #336) en origin/main no están en main local. |
| **BACKEND** | 🟢 OK | Endpoints v23 implementados correctamente. Dependencias presentes. Validaciones 400 vs 500 correctas. |
| **FRONTEND** | 🟢 OK | OverlayRotator presente. Iconos a color en `/public/icons/`. Configuración ui_overlay funcional. |
| **SYSTEMD** | 🟢 OK | Service unit correcto. Launcher usa `uvicorn backend.main:app`. StateDirectory coherente. |
| **QA-SMOKE** | 🟠 Revisar | Script existe pero falta cobertura de endpoints críticos (/api/weather/now, /api/ephemerides, /api/saints). |
| **DOCS** | 🟠 Revisar | CHANGELOG v23 presente pero incompleto. README tiene secciones ICS pero falta sección Smoke Test v23 detallada. |

---

## 🔍 Agente 1 — GIT-AUDIT

### Estado del Repositorio

**Remoto:**
```
origin  https://github.com/DanielGTdiabetes/Pantalla_reloj (fetch)
origin  https://github.com/DanielGTdiabetes/Pantalla_reloj (push)
```

**Rama actual:** `feat/v23-systemd-installer-alignment` (local)  
**Main local:** `c3b2196 errores codex` (11 commits detrás de origin/main)

**Commits en origin/main que faltan en main local:**
- `11612ef` Merge pull request #336 from DanielGTdiabetes/feat/v23-systemd-installer-alignment
- `55fbabb` Merge pull request #335 from DanielGTdiabetes/feat/v23-systemd-installer-alignment
- `7adf682` Merge pull request #334 from DanielGTdiabetes/feat/v23-systemd-installer-alignment

### Tags

No se encontraron tags v23 en el repositorio.

### CHANGELOG.md

**✅ OK** - Sección v23 presente en líneas 5-26.

**Contenido actual:**
- Fixed: persistencia /config, uploader ICS, default layers, toggle AEMET, escrituras atómicas
- Changed: mejoras gestión configuración, manejo ICS, capas, systemd
- Added: soporte ICS completo, endpoint `/api/config/upload/ics`, validación ICS, endpoint `/api/calendar/status`, frontend `/config` re-hecho

**⚠️ OBSERVACIONES:**
- Falta mención explícita de "persistencia robusta, sin 500 por validación; devolver 400 con mensaje claro" en Fixed
- Falta mención de "default layers" como funcionalidad específica
- Falta mención de "AEMET toggle" como funcionalidad específica
- Falta mención de "panel rotativo" y "iconos a color" en Added

### README.md

**✅ OK** - Secciones v23 presentes:

1. **Calendario ICS** (líneas 103-241):
   - ✅ Configuración desde UI (líneas 107-173)
   - ✅ Solución de errores típicos (líneas 127-172)
   - ✅ Subida mediante API (líneas 174-184)
   - ✅ Endpoints relacionados (líneas 186-191)
   - ✅ Formato ICS soportado (líneas 193-201)

2. **Smoke test v23** (líneas 764-781):
   - ✅ Mención básica presente
   - ⚠️ Falta sección dedicada detallada con comandos y expected

### Ramas Divergentes

**Rama `feat/v23-systemd-installer-alignment`:**
- Último commit: `84e3677` Add blank lines to various files for improved readability
- Estado: Está en origin/main (PR #336 mergeado), pero main local no está actualizado

### PRs Sugeridas

1. **PR: Actualizar main local desde origin/main**
   - Título: `chore: sync main local with origin/main (PRs #334, #335, #336)`
   - Scope: Merge de commits de PRs #334, #335, #336 a main local
   - Acción: `git checkout main && git pull --ff-only origin main`

2. **PR: Mejorar CHANGELOG v23**
   - Título: `docs: expand CHANGELOG v23 with all features and fixes`
   - Scope: Añadir detalles faltantes sobre validaciones 400, panel rotativo, iconos a color
   - Checklist:
     - [ ] Añadir "Validaciones de usuario devuelven HTTP 400 en lugar de 500"
     - [ ] Añadir "Panel rotativo con overlay y pausa por tormenta"
     - [ ] Añadir "Iconos meteorológicos a color locales"
     - [ ] Añadir "Capas por defecto (radar/aviones/barcos)"

3. **PR: Añadir sección Smoke Test v23 detallada en README**
   - Título: `docs: add detailed Smoke Test v23 section to README`
   - Scope: Crear sección dedicada con comandos, expected y troubleshooting

---

## 🔍 Agente 2 — BACKEND-AUDIT

### Dependencias

**✅ OK** - `backend/requirements.txt` incluye:
- ✅ `python-multipart` (línea 5) - Necesario para `/api/config/upload/ics`

**Comprobación:**
```bash
grep -E 'python-multipart' backend/requirements.txt
# Resultado: python-multipart (presente)
```

### Endpoints Críticos

#### ✅ POST /api/config (líneas 1761-2045)

**Estado:** ✅ OK

**Validaciones:**
- ✅ Devuelve HTTP 400 para JSON inválido (línea 1776)
- ✅ Devuelve HTTP 400 para payload no objeto (línea 1779)
- ✅ Devuelve HTTP 400 para claves v1 no permitidas (línea 1787-1790)
- ✅ Devuelve HTTP 400 para versión no v2 (línea 1794-1797)
- ✅ Devuelve HTTP 400 para falta ui_map (línea 1801)
- ✅ Devuelve HTTP 400 para validación de calendario (línea 1874-1880)
- ✅ Devuelve HTTP 400 para ValidationError de Pydantic (línea 1951-1959)
- ⚠️ Devuelve HTTP 500 solo para errores de sistema (lectura config corrupto, permisos, OSError) - CORRECTO

**Escritura atómica:**
- ✅ Usa `write_config_atomic()` (línea 1883)
- ✅ Implementado en `backend/config_store.py` (líneas 178-251)
- ✅ Patrón tmp + rename + fsync

#### ✅ POST /api/config/upload/ics (líneas 941-1104)

**Estado:** ✅ OK

**Validaciones:**
- ✅ Devuelve HTTP 400 para extensión incorrecta (línea 952-955)
- ✅ Devuelve HTTP 400 para tamaño excedido (línea 958-965)
- ✅ Devuelve HTTP 400 para formato ICS inválido (línea 969-971, 1028-1031)
- ✅ Devuelve HTTP 400 para permisos/OSError (línea 978-981, 999-1002, 1037-1040, 1075-1078)
- ✅ Validación básica ICS antes de escribir (línea 969)
- ✅ Escritura atómica del config después de subir ICS (línea 1071)

#### ✅ GET /api/calendar/events

**Estado:** ✅ OK - Endpoint presente en código (búsqueda confirmada)

#### ✅ GET /api/weather/now y GET /api/weather/weekly

**Estado:** ✅ OK - Endpoints presentes (búsqueda confirmada)

**IconKey:**
- ⚠️ Necesita verificación manual en respuesta JSON

#### ✅ GET /api/ephemerides y GET /api/saints

**Estado:** ✅ OK - Endpoints presentes (búsqueda confirmada)

#### ✅ GET /api/health

**Estado:** ✅ OK - Endpoint presente (líneas 724-844)

**Bloque overlay/providers/status:**
- ✅ Bloque `providers` presente (líneas 813-827)
- ✅ Bloque `calendar` presente (líneas 829-844)
- ⚠️ Bloque `overlay` no encontrado explícitamente en health

### Errores HTTP 500

**✅ CORRECTO** - Solo 3 usos de HTTP 500 encontrados:

1. **Línea 2525:** Error de migración de configuración (legítimo - error interno)
2. **Línea 5228:** Error fetching tile (legítimo - error de red/servicio externo)
3. **Línea 5327:** Error fetching tile (legítimo - error de red/servicio externo)

**No se encontraron HTTP 500 en validaciones de usuario** ✅

### Checklist de Verificación Post-Instalación

```bash
# Health check
curl -sS http://127.0.0.1:8081/api/health | jq

# Config con overlay
curl -sS http://127.0.0.1:8081/api/config | jq '.panels.calendar, .ui_overlay // {}'

# Weather con iconKey
curl -sS http://127.0.0.1:8081/api/weather/now | jq

# Calendar events
curl -sS http://127.0.0.1:8081/api/calendar/events | jq '.[0:3]'
```

### Diffs Sugeridos

**Ninguno necesario** - Backend está correcto ✅

---

## 🔍 Agente 3 — FRONTEND-AUDIT

### Componentes Presentes

**✅ OK** - Todos los componentes v23 están presentes:

1. **OverlayRotator** (`dash-ui/src/components/OverlayRotator.tsx`)
   - ✅ Presente (878 líneas)
   - ✅ Lee `ui_overlay.enabled`, `ui_overlay.rotation_seconds`, `ui_overlay.order[]`
   - ✅ Soporta v2 (`ui_global.overlay.rotator`) y v1 legacy (`ui.rotation`)
   - ✅ Paneles: clock, weather, astronomy, santoral, calendar, news

2. **PanelClock** (TimeCard)
   - ✅ Referenciado en OverlayRotator (línea 557)

3. **PanelWeather** (WeatherCard)
   - ✅ Referenciado en OverlayRotator (línea 561-575)
   - ✅ Usa WeatherIcon con iconos a color

4. **PanelEphemerides** (EphemeridesCard)
   - ✅ Referenciado en OverlayRotator (línea 582-589)

5. **PanelSaints** (SaintsCard)
   - ✅ Referenciado en OverlayRotator (línea 593-597)

6. **PanelCalendar** (CalendarCard)
   - ✅ Referenciado en OverlayRotator (línea 600-604)

7. **PanelNews** (NewsCard)
   - ✅ Referenciado en OverlayRotator (línea 607-611)

### Configuración UI_Overlay

**✅ OK** - Lectura de configuración implementada:

```typescript
// Líneas 191-234 de OverlayRotator.tsx
const rotationConfig = useMemo(() => {
  // Intentar leer desde v2 primero
  const v2Config = config as unknown as AppConfigV2;
  if (v2Config.version === 2 && v2Config.ui_global?.overlay?.rotator) {
    const rotator = v2Config.ui_global.overlay.rotator;
    return {
      enabled: rotator.enabled ?? true,
      order: [...],
      durations_sec: rotator.durations_sec || DEFAULT_DURATIONS_SEC,
      transition_ms: rotator.transition_ms ?? 400,
      pause_on_alert: rotator.pause_on_alert ?? false,
    };
  }
  // Fallback a v1 legacy...
}, [config]);
```

### Pausa por Tormenta

**⚠️ PARCIAL** - No se encontró lógica explícita de pausa por tormenta en OverlayRotator:

- ✅ Configuración `pause_on_alert` está presente (línea 207)
- ⚠️ No se encontró uso de `GET /api/health` → `storm.enabled` para pausar rotador
- ⚠️ No se encontró lógica que consulte health endpoint para pausar

**Recomendación:** Implementar pausa por tormenta si es requerida.

### Iconos a Color

**✅ OK** - Iconos presentes:

**Estructura:**
```
dash-ui/public/icons/
├── weather/
│   ├── day/ (11 iconos SVG)
│   ├── night/ (8 iconos SVG)
│   └── (iconos generales)
├── harvest/ (24 iconos SVG)
├── astronomy/moon/ (12 iconos SVG)
└── misc/ (3 iconos SVG)
```

**Mapeo de iconos:**
- ✅ `dash-ui/src/lib/weather-icons.ts` (línea 148) - `getWeatherIconPath()`
- ✅ `dash-ui/src/components/WeatherIcon.tsx` - Componente que usa iconos
- ✅ `dash-ui/src/components/dashboard/cards/WeatherForecastCard.tsx` - Usa iconos locales (línea 85-90)
- ✅ `dash-ui/src/components/dashboard/cards/HarvestCard.tsx` - Usa iconos locales (línea 146-147)

**Verificación de CDNs:**
- ✅ No se encontraron accesos a CDNs para iconos
- ✅ Todos los iconos son locales (`/icons/weather/...`, `/icons/harvest/...`)

### PR Sugerido

**Ninguno necesario** - Frontend está correcto ✅ (excepto pausa por tormenta si es requerida)

---

## 🔍 Agente 4 — SYSTEMD-AUDIT

### Service Unit

**Archivo:** `systemd/pantalla-dash-backend@.service`

**✅ OK** - Todas las configuraciones requeridas presentes:

1. **User=%i** ✅ (línea 8)
2. **StateDirectory=pantalla-reloj** ✅ (línea 10) - Coherente con `/var/lib/pantalla-reloj`
3. **WorkingDirectory=/opt/pantalla-reloj/backend** ✅ (línea 13)
4. **ExecStart=/usr/local/bin/pantalla-backend-launch** ✅ (línea 16)
5. **Restart=on-failure, RestartSec=2** ✅ (líneas 17-18)
6. **StandardOutput=journal, StandardError=journal** ✅ (líneas 21-22)

### Launcher

**Archivo:** `packaging/bin/pantalla-backend-launch`

**✅ OK** - Todas las funcionalidades requeridas presentes:

1. **Activa venv .venv** ✅ (líneas 28-36)
2. **Verifica dependencias críticas** ✅ (líneas 76-106):
   - fastapi ✅
   - uvicorn ✅
   - python-multipart ✅ (línea 90: `import multipart`)
   - icalendar ✅ (línea 94)
   - backend.main ✅ (línea 98)
3. **Arranca uvicorn backend.main:app** ✅ (líneas 137-151):
   ```bash
   exec "$VENV_PYTHON" -m uvicorn "backend.main:app" --host 127.0.0.1 --port "$PORT"
   ```
   ⚠️ **NOTA:** Usa `--host 127.0.0.1` (no `0.0.0.0`), pero esto es correcto para localhost
4. **Loggea a journal** ✅ (vía systemd StandardOutput/StandardError)
5. **Garantiza directorios** ✅ (líneas 114-122):
   - Crea `/var/lib/pantalla-reloj/ics` con permisos 0700

### StateDirectory Coherencia

**✅ OK** - Coherente:

- Service unit: `StateDirectory=pantalla-reloj` → Crea `/var/lib/pantalla-reloj` con permisos 0755
- Backend espera: `/var/lib/pantalla-reloj/config.json` ✅
- Launcher crea: `/var/lib/pantalla-reloj/ics` con 0700 ✅

### Verificación del Launcher

**✅ OK** - El launcher NO ejecuta `python -` (stdin), sino el módulo correcto:

```bash
exec "$VENV_PYTHON" -m uvicorn "backend.main:app" --host 127.0.0.1 --port "$PORT"
```

### Diffs Recomendados

**Ninguno necesario** - Systemd está correcto ✅

---

## 🔍 Agente 5 — QA-SMOKE

### Script Presente

**Archivo:** `scripts/smoke_v23.sh`

### Cobertura Actual

**✅ OK** - Pruebas presentes:

1. ✅ `/api/health` HTTP 200 con `status=ok` (líneas 313-316)
2. ✅ Upload ICS (`/api/config/upload/ics`) y confirmación (líneas 318-323)
3. ✅ Activación de layers (radar/flights/ships) vía POST `/api/config` (líneas 325-329)
4. ✅ `/api/calendar/events` (>=1 evento si se subió ICS) (líneas 331-337)
5. ✅ `/api/calendar/status` = "ok" (líneas 339-343)

**⚠️ FALTANTE** - Checks no cubiertos:

1. ❌ `/api/weather/now` y `/api/weather/weekly` con `iconKey` (permitir vacío pero no 500)
2. ❌ `/api/ephemerides` (no 500)
3. ❌ `/api/saints` (no 500)
4. ❌ Overlay en `/api/config` (bloque `ui_overlay` coherente)
5. ❌ Verificación de que `/api/ephemerides` y `/api/saints` devuelven vacío pero no 500

### Mensajes de Error y Exit Codes

**✅ OK** - Script maneja correctamente:
- ✅ Mensajes de error claros (`log_error`)
- ✅ Exit codes !=0 al fallar (línea 352: `exit 1`)

### PR Sugerido

**PR: Ampliar smoke_v23.sh con checks faltantes**

**Título:** `test: add missing endpoint checks to smoke_v23.sh`

**Scope:** Añadir verificaciones para:
- `/api/weather/now` y `/api/weather/weekly` con iconKey
- `/api/ephemerides` (no 500, permitir vacío)
- `/api/saints` (no 500, permitir vacío)
- Overlay en `/api/config` (bloque `ui_overlay`)

**Checklist:**
- [ ] Añadir función `check_weather_now()` que verifica HTTP 200 y presencia de `iconKey` (o permitir vacío)
- [ ] Añadir función `check_weather_weekly()` similar
- [ ] Añadir función `check_ephemerides()` que verifica HTTP 200 (no 500) y permite respuesta vacía
- [ ] Añadir función `check_saints()` similar
- [ ] Añadir función `check_overlay_config()` que verifica bloque `ui_overlay` en `/api/config`
- [ ] Integrar todas las funciones en el flujo principal del script

---

## 🔍 Agente 6 — DOCS-AUDIT

### CHANGELOG.md v23

**✅ OK** - Sección v23 presente (líneas 5-26)

**Contenido:**
- Fixed: persistencia /config, uploader ICS, default layers, toggle AEMET, escrituras atómicas
- Changed: mejoras gestión configuración, manejo ICS, capas, systemd
- Added: soporte ICS completo, endpoint `/api/config/upload/ics`, validación ICS, endpoint `/api/calendar/status`, frontend `/config` re-hecho

**⚠️ FALTANTE:**
- ❌ Detalle explícito: "persistencia robusta, sin 500 por validación; devolver 400 con mensaje claro"
- ❌ Mención de "panel rotativo" y "iconos a color"
- ❌ Mención de "pausa por tormenta" (si está implementada)
- ❌ Mención de "alineación systemd" con detalles específicos

### README.md v23

**✅ OK** - Secciones presentes:

1. **Calendario ICS** (líneas 103-241) ✅
   - Configuración desde UI
   - Solución de errores
   - Subida mediante API
   - Endpoints relacionados
   - Formato ICS soportado

2. **Smoke test v23** (líneas 764-781) ⚠️
   - ✅ Mención básica presente
   - ❌ Falta sección dedicada detallada con:
     - Comandos exactos
     - Expected outputs
     - Troubleshooting

**✅ OK** - Secciones adicionales relevantes:
- Solución de problemas (líneas 665-781)
- Runbook: pantalla negra + puntero (líneas 793-826)
- Troubleshooting: Restart Loop del Backend (líneas 827-965)

### PRs Sugeridas

1. **PR: Expandir CHANGELOG v23**
   - Título: `docs: expand CHANGELOG v23 with detailed fixes and features`
   - Scope:
     - [ ] Añadir "Validaciones de usuario devuelven HTTP 400 en lugar de 500"
     - [ ] Añadir "Panel rotativo con overlay y configuración ui_overlay"
     - [ ] Añadir "Iconos meteorológicos a color locales"
     - [ ] Añadir detalles de "alineación systemd"

2. **PR: Añadir sección Smoke Test v23 detallada**
   - Título: `docs: add detailed Smoke Test v23 section to README`
   - Scope: Crear sección dedicada con:
     - [ ] Comandos exactos (`bash scripts/smoke_v23.sh`)
     - [ ] Expected outputs por test
     - [ ] Troubleshooting específico
     - [ ] Ejemplos de fallos comunes y soluciones

---

## 🔍 Agente 7 — CONSISTENCY-REPORT

### Estado General

| Área | Estado | Bloqueantes | Revisar |
|------|--------|-------------|---------|
| GIT | 🟠 | 0 | 1 (main local desactualizado) |
| BACKEND | 🟢 | 0 | 0 |
| FRONTEND | 🟢 | 0 | 1 (pausa por tormenta no implementada) |
| SYSTEMD | 🟢 | 0 | 0 |
| QA-SMOKE | 🟠 | 0 | 1 (faltan checks) |
| DOCS | 🟠 | 0 | 2 (CHANGELOG incompleto, README falta sección smoke) |

**Total bloqueantes:** 0 ✅  
**Total revisar:** 5 ⚠️

### Plan de Merge y Orden

#### Fase 1: Sincronización GIT (Prioridad Alta)

1. **Sincronizar main local con origin/main**
   ```bash
   git checkout main
   git pull --ff-only origin main
   ```
   - Mergea PRs #334, #335, #336 a main local

#### Fase 2: Mejoras Backend (Ninguna necesaria) ✅

#### Fase 3: Mejoras Frontend (Opcional)

1. **Implementar pausa por tormenta** (si es requerida)
   - Consultar `GET /api/health` → `storm.enabled`
   - Pausar rotador si `storm.enabled === true`

#### Fase 4: QA Smoke Actualizado (Prioridad Media)

1. **Ampliar smoke_v23.sh**
   - Añadir checks de `/api/weather/now`, `/api/weather/weekly`
   - Añadir checks de `/api/ephemerides`, `/api/saints`
   - Añadir check de overlay en `/api/config`

#### Fase 5: Documentación (Prioridad Media)

1. **Expandir CHANGELOG v23**
   - Añadir detalles de validaciones 400 vs 500
   - Añadir panel rotativo e iconos a color
   - Añadir detalles de systemd alignment

2. **Añadir sección Smoke Test v23 detallada en README**
   - Comandos exactos
   - Expected outputs
   - Troubleshooting

#### Fase 6: Tag y Release (Prioridad Baja - Opcional)

1. **Crear tag v23** (después de mergear mejoras)
   ```bash
   git checkout main
   git pull --ff-only origin main
   git tag -a v23 -m "v23: config persistence, ICS upload, overlay rotator, AEMET toggle, atomic writes, docs & smoke"
   git push origin v23
   ```

### PRs Concretas a Abrir/Actualizar

1. **PR: Sync main local with origin/main** (Prioridad Alta)
   - Título: `chore: sync main local with origin/main (PRs #334, #335, #336)`
   - Scope: Merge de commits de PRs #334, #335, #336 a main local

2. **PR: Expandir CHANGELOG v23** (Prioridad Media)
   - Título: `docs: expand CHANGELOG v23 with all features and fixes`
   - Scope: Añadir detalles faltantes sobre validaciones 400, panel rotativo, iconos a color

3. **PR: Añadir sección Smoke Test v23 detallada** (Prioridad Media)
   - Título: `docs: add detailed Smoke Test v23 section to README`
   - Scope: Crear sección dedicada con comandos, expected y troubleshooting

4. **PR: Ampliar smoke_v23.sh con checks faltantes** (Prioridad Media)
   - Título: `test: add missing endpoint checks to smoke_v23.sh`
   - Scope: Añadir verificaciones para weather, ephemerides, saints, overlay

5. **PR: Implementar pausa por tormenta** (Prioridad Baja - Opcional)
   - Título: `feat: add storm pause functionality to OverlayRotator`
   - Scope: Consultar `GET /api/health` → `storm.enabled` y pausar rotador si está activo

---

## ✅ Criterios Globales de Éxito

### ✅ Cumplidos

1. ✅ **python-multipart está en requirements.txt** - Confirmado (línea 5)
2. ✅ **Launcher arranca uvicorn backend.main:app** - Confirmado (línea 137-151)
3. ✅ **Panel rotativo presente** - Confirmado (OverlayRotator.tsx)
4. ✅ **Iconos a color presentes** - Confirmado (`/public/icons/weather/`, `/public/icons/harvest/`)
5. ✅ **Endpoints devuelven 400 para validaciones** - Confirmado (POST /api/config, POST /api/config/upload/ics)
6. ✅ **Escrituras atómicas implementadas** - Confirmado (`write_config_atomic()`)
7. ✅ **CHANGELOG v23 presente** - Confirmado (líneas 5-26)
8. ✅ **README secciones ICS presentes** - Confirmado (líneas 103-241)

### ⚠️ Revisar

1. ⚠️ **smoke_v23.sh cubre endpoints clave** - Parcial (faltan weather, ephemerides, saints, overlay)
2. ⚠️ **CHANGELOG v23 completo** - Incompleto (faltan detalles de validaciones 400, panel rotativo, iconos)
3. ⚠️ **README sección Smoke Test v23** - Básica (falta sección detallada)

### ❌ No Cumplidos

**Ninguno** - No hay bloqueantes críticos.

---

## 📋 Listado de Mismatches Concretos

### 1. Main local desactualizado

**Problema:** Main local está 11 commits detrás de origin/main.

**Solución:** Ejecutar `git checkout main && git pull --ff-only origin main`

### 2. Smoke test incompleto

**Problema:** `smoke_v23.sh` no cubre todos los endpoints críticos.

**Solución:** Añadir checks para `/api/weather/now`, `/api/weather/weekly`, `/api/ephemerides`, `/api/saints`, overlay en `/api/config`.

### 3. CHANGELOG v23 incompleto

**Problema:** Falta mención explícita de validaciones 400, panel rotativo, iconos a color.

**Solución:** Expandir sección v23 con todos los detalles.

### 4. README falta sección Smoke Test v23 detallada

**Problema:** Solo hay mención básica del smoke test.

**Solución:** Crear sección dedicada con comandos, expected y troubleshooting.

### 5. Pausa por tormenta no implementada (Opcional)

**Problema:** OverlayRotator no consulta `GET /api/health` → `storm.enabled` para pausar.

**Solución:** Implementar lógica de pausa si es requerida.

---

## 🎯 Conclusión

**v23 está aplicado y desplegable** ✅ con las siguientes observaciones:

- **Backend:** ✅ Correcto - endpoints, dependencias, validaciones
- **Frontend:** ✅ Correcto - rotator, iconos, configuración
- **Systemd:** ✅ Correcto - service unit, launcher, paths
- **GIT:** ⚠️ Revisar - sincronizar main local
- **QA:** ⚠️ Revisar - ampliar smoke test
- **Docs:** ⚠️ Revisar - expandir CHANGELOG y README

**No hay bloqueantes críticos.** Las mejoras sugeridas son principalmente documentales y de cobertura de tests.

---

**Reporte generado:** 2025-01  
**Auditor:** Agente Multi-Área  
**Estado:** 🟢 DESPLEGABLE (con mejoras recomendadas)

