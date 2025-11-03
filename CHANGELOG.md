# Changelog

Todos los cambios notables del proyecto se documentarán en este archivo.

## v23 - 2025-01

### Fixed
- Corrección de persistencia de `/config` mediante escrituras atómicas
- Corrección del uploader de archivos ICS
- Corrección de capas por defecto (default layers)
- Corrección del toggle de AEMET
- Alineación con systemd mediante escrituras atómicas

### Changed
- Mejoras en la gestión de configuración con escrituras atómicas para evitar corrupción
- Mejor manejo de archivos ICS con validación y almacenamiento seguro
- Mejoras en la gestión de capas por defecto del mapa
- Mejor integración con systemd para mayor robustez

### Added
- Soporte completo para subida de archivos ICS (iCalendar)
- Endpoint `/api/config/upload/ics` para subida de calendarios ICS
- Validación de archivos ICS con manejo de errores mejorado
- Endpoint `/api/calendar/status` para verificación del estado del calendario
- Frontend `/config` re-hecho: uploader ICS, merge seguro, toggles capas, mensajes de error claros

