# Changelog

Todos los cambios notables del proyecto se documentarán en este archivo.

## v23 - 2025-01

### Fixed
- Corrección de persistencia de `/config` mediante escrituras atómicas
- Corrección del uploader de archivos ICS
- Corrección de capas por defecto (default layers)
- Corrección del toggle de AEMET
- Alineación con systemd mediante escrituras atómicas
- **Validaciones de usuario devuelven HTTP 400 en lugar de 500**: Las validaciones de entrada del usuario (POST `/api/config`, POST `/api/config/upload/ics`) ahora devuelven códigos HTTP 400 con mensajes claros cuando hay errores de validación, en lugar de errores 500 internos del servidor. Solo los errores de sistema legítimos (corrupción de config, permisos, OSError) devuelven 500.

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
- Frontend `/config` re-hecho: uploader ICS, merge seguro, toggles capas, mensajes de error claros
- **Panel rotativo con overlay**: Componente `OverlayRotator` que rota entre múltiples paneles (hora, clima, astronomía, santoral, calendario, noticias) con configuración desde `ui_global.overlay.rotator` (v2) o `ui.rotation` (v1 legacy). Soporta orden personalizado, duraciones por panel y transiciones suaves.
- **Iconos meteorológicos a color locales**: Iconos SVG a color almacenados localmente en `/public/icons/weather/` (día/noche), `/public/icons/harvest/` y `/public/icons/astronomy/moon/`, eliminando dependencias de CDNs externos. El componente `WeatherIcon` mapea códigos de iconos a rutas locales automáticamente.

