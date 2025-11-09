# Configuración Inicial

Sigue estos pasos tras clonar el repositorio para evitar errores en arranques limpios.

## 1. Copia la plantilla de configuración

1. Crea la ruta de estado si no existe: `/var/lib/pantalla-reloj/`.
2. Copia `backend/default_config.json` a `/var/lib/pantalla-reloj/config.json`.
3. Asegúrate de que el archivo pertenece al usuario que ejecutará el backend y tiene permisos `0644`.

## 2. Configura el mapa

- **Opción rápida (sin MapTiler):** deja el proveedor por defecto (`xyz`). Se usarán los tiles de OpenStreetMap.
- **Opción MapTiler:** cambia `map.provider` y `ui.map.provider` a `"maptiler"`, define `ui.map.maptiler.apiKey` y `ui.map.maptiler.styleUrl` (p. ej. `https://api.maptiler.com/maps/streets-v2/style.json?key=TU_API_KEY`).
- Si usas MapTiler, exporta también `MAPTILER_API_KEY` en el entorno para que el backend pueda validar el estilo.

## 3. Activa capas y módulos

Completa las secciones relevantes del JSON antes de arrancar:

- `opensky` y `layers.flights`: credenciales de OpenSky o proveedor alternativo.
- `layers.ships`: API key de AISStream/AISHub si quieres tráfico marítimo.
- `aemet`: API key y banderas `radar_enabled`/`satellite_enabled`.
- `news.rss_feeds`: añade feeds válidos para tu despliegue.
- `harvest.custom_items`: rellena productos locales o desactiva el módulo.
- `calendar`: elige `google` (necesita `google_api_key` y `google_calendar_id`) o `ics` (`calendar.ics.file_path`).
- `weather`: define el proveedor que utilices (p. ej. OpenWeatherMap) y añade la clave en `secrets`.

## 4. Variables de entorno recomendadas

Configura estas variables en el servicio systemd o tu shell:

- `PANTALLA_CONFIG`: ruta alternativa si no usas `/var/lib/pantalla-reloj/config.json`.
- `MAPTILER_API_KEY`: requerido si el mapa usa MapTiler.
- `OPENWEATHER_API_KEY`: necesario para radar/clima con OpenWeatherMap.
- `GOOGLE_API_KEY` y `GOOGLE_CALENDAR_ID`: para calendario remoto.
- `AISSTREAM_API_KEY`, `AISHUB_API_KEY`, etc., según cada proveedor.

## 5. Verificación rápida

1. Arranca el backend y revisa `/var/log/pantalla/backend.log`. No debe aparecer el mensaje de migración en bucle.
2. Prueba los endpoints:
   - `curl http://localhost:8000/api/layers/flights`
   - `curl http://localhost:8000/api/global/radar/frames`
   - `curl http://localhost:8000/api/news`
3. Abre la UI; el mapa debe cargar sin errores y el panel rotatorio mostrar datos.

Repite los pasos de verificación siempre que cambies claves o proveedores.

