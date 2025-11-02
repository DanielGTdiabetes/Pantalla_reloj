# Esquema v2 de Configuración - Implementación Completada

## Resumen

Se ha implementado un esquema v2 limpio y mínimo para la Fase 2 del proyecto, consolidando la configuración y eliminando claves obsoletas.

## Archivos Creados/Modificados

### Backend

1. **`backend/models_v2.py`**: 
   - Modelos Pydantic para el esquema v2
   - Tipos: `AppConfigV2`, `UIConfigV2`, `MapConfigV2`, `AemetConfigV2`, `PanelConfig`, `LayersConfigV2`, etc.

2. **`backend/config_migrator.py`**:
   - Función `migrate_v1_to_v2()`: Migra configuración v1 a v2
   - Función `apply_postal_geocoding()`: Aplica geocodificación de códigos postales
   - Función `migrate_config_to_v2()`: Migra archivo de configuración completo

3. **`backend/main.py`**:
   - Endpoint `POST /api/config/migrate?to=2`: Endpoint para migrar configuración
   - Integración con geocodificación automática de códigos postales

4. **`backend/default_config_v2.json`**:
   - Defaults completos para el esquema v2
   - Configuración XYZ satelital por defecto
   - ViewMode fixed con Castellón (12001)
   - AEMET, panel rotatorio, y capas configuradas

### Frontend

1. **`dash-ui/src/types/config_v2.ts`**:
   - Tipos TypeScript para el esquema v2
   - Todos los tipos necesarios para la nueva estructura

2. **`dash-ui/src/config/defaults_v2.ts`**:
   - Defaults y helpers para v2
   - Función `withConfigDefaultsV2()` para mergear configuración

3. **`dash-ui/src/lib/api.ts`**:
   - Función `migrateConfig()` para llamar al endpoint de migración
   - Tipo `MigrateConfigResponse`

4. **`dash-ui/src/pages/ConfigPage.tsx`**:
   - Detección automática de versión de configuración
   - Banner de advertencia si la configuración no es v2
   - Botón para migrar a v2
   - Handler `handleMigrateToV2()` para ejecutar la migración

## Estructura del Esquema v2

```json
{
  "version": 2,
  "ui": {
    "layout": "grid-2-1",
    "map": {
      "engine": "maplibre",
      "provider": "xyz",
      "xyz": { ... },
      "labelsOverlay": { ... },
      "viewMode": "fixed",
      "fixed": { ... },
      "aoiCycle": { ... },
      "region": { "postalCode": "12001" }
    },
    "aemet": {
      "enabled": true,
      "warnings": { ... },
      "radar": { ... },
      "sat": { ... }
    },
    "panel": {
      "rotate": { ... },
      "news": { ... },
      "efemerides": { ... }
    }
  },
  "layers": {
    "flights": { ... },
    "ships": { ... }
  },
  "secrets": { ... }
}
```

## Claves Obsoletas Eliminadas

- `ui.map.style` (reemplazado por `provider: "xyz"`)
- `ui.map.provider !== "xyz"` y `ui.map.maptiler.*`
- `ui.global.satellite` y `ui.global.radar` (reemplazadas por `ui.aemet.*`)
- `layers.*.styleScale` (ya no necesario)
- Rutas antiguas `/assets/icons/...` (ahora `/icons/...`)

## Funcionalidades Nuevas

1. **Mapa Satelital XYZ**: Proveedor único XYZ con Esri World Imagery por defecto
2. **Vista Fija por Código Postal**: Geocodificación automática de CP español
3. **AEMET Configurado**: Estructura nueva con warnings, radar, y sat
4. **Panel Rotatorio**: Estructura nueva con rotate, news, efemerides
5. **Migración Automática**: Endpoint y UI para migrar v1→v2 idempotentemente

## Uso

### Migrar Configuración

1. **Desde la UI**: 
   - Si la configuración no es v2, aparecerá un banner con botón "Migrar a v2"
   - Hacer clic en el botón para ejecutar la migración

2. **Desde el Backend**:
   ```bash
   curl -X POST "http://localhost:8081/api/config/migrate?to=2&backup=true"
   ```

### Geocodificación Automática

Al migrar, si se encuentra un `postalCode` en `region`, se geocodifica automáticamente y se actualiza `fixed.center`.

## Tests y Validación

- ✅ Backend compila sin errores
- ✅ Frontend compila sin errores TypeScript
- ✅ Endpoint de migración funciona
- ✅ Detección de versión funciona
- ✅ UI de migración implementada

## Próximos Pasos

1. Actualizar `GeoScopeMap.tsx` para usar completamente la nueva estructura v2
2. Ajustar `ConfigPage.tsx` para mostrar controles específicos de v2
3. Actualizar validadores y schemas para v2
4. Documentar cambios para usuarios

