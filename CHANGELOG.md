# Changelog

Todos los cambios notables del proyecto se documentarán en este archivo.

## v24 - 2025-01

### Fixed
- **RainViewerProvider corregido para esquema v4**: El proveedor ahora maneja correctamente el formato JSON v4 de RainViewer que retorna frames como objetos `{time, path}` en lugar de timestamps directos. Esto corrige el error `'dict' object cannot be interpreted as an integer`.

### Changed
- **Sustitución de AEMET por RainViewer v4 para radar global**: El radar global ahora usa RainViewer v4 por defecto (sin clave API requerida) en lugar de AEMET. AEMET se mantiene en la configuración pero deshabilitado por defecto y solo se usará en futuras capas (avisos CAP, radar ES, satélite ES) si se reactiva.
- **Endpoint AEMET test ajustado**: `/api/aemet/test` ahora retorna `{ok: false, reason: "disabled"}` cuando `aemet.enabled=false` sin requerir token, evitando errores en health checks.

### Added
- **Endpoints RainViewer**:
  - `GET /api/rainviewer/frames` → Retorna array de timestamps disponibles (combina `radar.past` + `radar.nowcast`)
  - `GET /api/rainviewer/tiles/{timestamp}/{z}/{x}/{y}.png` → Proxy/cache de tiles desde RainViewer v4
  - `GET /api/rainviewer/test` → Verificación de conectividad y disponibilidad de frames
- **Funciones de API frontend para RainViewer y GIBS**: `testRainViewer()`, `getRainViewerFrames()`, `getRainViewerTileUrl()`, `testGIBS()`
- **Tests unitarios**:
  - `test_rainviewer_provider.py`: Tests del parser RainViewer v4 con manejo de formatos legacy y v4
  - `test_routes_rainviewer.py`: Tests de endpoints de RainViewer
  - Tests adicionales en `test_aemet_endpoints.py` para verificar comportamiento cuando `enabled=false`

### Technical Details
- RainViewerProvider ahora soporta reintentos (2 intentos) con timeouts para mayor robustez
- URL de tiles actualizada al formato v4: `https://tilecache.rainviewer.com/v2/radar/{timestamp}/256/{z}/{x}/{y}/2/1_1.png`
- Filtros `history_minutes` y `frame_step` aplicados correctamente en el backend
- Configuración por defecto: `layers.global.radar.provider="rainviewer"`, `aemet.enabled=false`

## v23 - 2025-01

### Fixed
- Corrección de persistencia de `/config` mediante escrituras atómicas
- Corrección del uploader de archivos ICS
- Corrección de capas por defecto (default layers)
- Corrección del toggle de AEMET
- Alineación con systemd mediante escrituras atómicas
- **Validaciones de usuario devuelven HTTP 400 en lugar de 500**: Las validaciones de entrada del usuario (POST `/api/config`, POST `/api/config/upload/ics`, POST `/api/efemerides/upload`) ahora devuelven códigos HTTP 400 con mensajes claros cuando hay errores de validación, en lugar de errores 500 internos del servidor. Solo los errores de sistema legítimos (corrupción de config, permisos, OSError) devuelven 500.

### Changed
- Mejoras en la gestión de configuración con escrituras atómicas para evitar corrupción
- Mejor manejo de archivos ICS con validación y almacenamiento seguro
- Mejoras en la gestión de capas por defecto del mapa (radar/aviones/barcos)
- Mejor integración con systemd para mayor robustez
- **Alineación systemd**: Service unit (`pantalla-dash-backend@.service`) usa `StateDirectory=pantalla-reloj` coherente con `/var/lib/pantalla-reloj`. Launcher (`pantalla-backend-launch`) valida dependencias críticas (python-multipart, icalendar) y arranca `uvicorn backend.main:app` correctamente.

### Added
- Soporte completo para subida de archivos ICS (iCalendar)
- Endpoint `/api/config/upload/ics` para subida de calendarios ICS
- Validación de archivos ICS con manejo de errores mejorado
- Endpoint `/api/calendar/status` para verificación del estado del calendario
- **Panel de efemérides históricas**: Nuevo panel `historicalEvents` que muestra hechos/curiosidades del día desde datos locales en formato JSON
- Endpoints `/api/efemerides`, `/api/efemerides/status` y `/api/efemerides/upload` para gestión de efemérides históricas
- Componente `HistoricalEventsCard` integrado en `OverlayRotator` con rotación automática de items
- Uploader de archivos JSON de efemérides en `/config` con validación de estructura y vista previa automática
- Integración en `/api/health` con información de estado de efemérides históricas
- Ampliación de smoke tests (`scripts/smoke_v23.sh`) con checks de efemérides históricas
- Frontend `/config` re-hecho: uploader ICS, merge seguro, toggles capas, mensajes de error claros, uploader efemérides
- **Panel rotativo con overlay**: Componente `OverlayRotator` que rota entre múltiples paneles (hora, clima, astronomía, santoral, calendario, noticias, efemérides históricas) con configuración desde `ui_global.overlay.rotator` (v2) o `ui.rotation` (v1 legacy). Soporta orden personalizado, duraciones por panel y transiciones suaves.
- **Panel de efemérides históricas**: Nuevo panel `historicalEvents` en el rotador que muestra hechos/curiosidades del día desde datos locales en formato JSON. Incluye uploader en `/config`, validación de estructura JSON, guardado atómico de archivos y vista previa automática de items.
- **Iconos meteorológicos a color locales**: Iconos SVG a color almacenados localmente en `/public/icons/weather/` (día/noche), `/public/icons/harvest/` y `/public/icons/astronomy/moon/`, eliminando dependencias de CDNs externos. El componente `WeatherIcon` mapea códigos de iconos a rutas locales automáticamente.

