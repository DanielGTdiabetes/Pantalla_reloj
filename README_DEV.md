# Validación condicional de `/api/config`

Este documento resume las comprobaciones añadidas para que el guardado de configuración sea robusto cuando algunos módulos están deshabilitados.

## Calendario

- Mientras `calendar.enabled` sea `false`, no se exigen credenciales ni rutas.
- Al activar `calendar` con `source: "google"` se comprueba que lleguen o existan en el almacén de secretos las claves `secrets.google.api_key` y `secrets.google.calendar_id`.
- Al activar `calendar` con `source: "ics"` se exige disponer de **al menos** uno de estos valores:
  - `secrets.calendar_ics.url` (URL remota)
  - `secrets.calendar_ics.path` o `calendar.ics_path` (ruta local legible)
- Si se proporciona una ruta local se valida que exista y sea accesible. Las rutas ausentes no bloquean el guardado si hay una URL disponible.

### Ejemplos

- **Válido**

```json
PATCH /api/config/group/secrets
{"calendar_ics":{"url":"https://example.com/calendar.ics"}}

PATCH /api/config/group/calendar
{"enabled":true,"source":"ics"}
```

- **Inválido**

```json
PATCH /api/config/group/calendar
{"enabled":true,"source":"ics"}
```

Respuesta esperada:

```json
{
  "detail": {
    "error": "Calendar provider 'ics' requires url or path",
    "missing": [
      "secrets.calendar_ics.url",
      "secrets.calendar_ics.path"
    ]
  }
}
```

## Capas de barcos (AIS)

- Si `layers.ships.enabled` es `false` no se valida el sub-bloque del proveedor.
- Para `provider: "aisstream"` se completa automáticamente `aisstream.ws_url` con `wss://stream.aisstream.io/v0/stream` cuando llegue vacío o `null`.

### Ejemplo

- **Válido**

```json
PATCH /api/config/group/layers
{
  "ships": {
    "enabled": false,
    "provider": "aisstream",
    "aisstream": {
      "ws_url": null
    }
  }
}
```

El backend persiste `ws_url` con el valor por defecto sin generar errores.

## Notas de migración

- La migración v1→v2 ahora inicializa `panels.calendar.enabled` a `false` y el bloque `calendar` global queda desactivado (`source: "google"`). Al aplicar `config_migrator.migrate_v1_to_v2` se insertarán estos valores cuando falten.

## Pauta general de los endpoints

- `POST /api/config` y `PATCH /api/config/group/*` sólo rechazan la operación si el grupo afectado queda inconsistente tras aplicar el merge.
- Los mensajes de error mantienen el formato `{"detail": {"error": ..., "field": ..., "tip": ..., "missing": [...]}}` y se limitan al grupo que se está guardando.

## Recomendaciones para el frontend

- No enviar `provider: null`; cuando un módulo se desactiva basta con `{"enabled": false}`.
- Deshabilitar el botón de **Guardar** del calendario si el usuario activa ICS sin proporcionar URL o ruta.
- Mantener la escritura de secretos usando `PATCH /api/config/group/secrets` para evitar exponer credenciales en el archivo de configuración.

