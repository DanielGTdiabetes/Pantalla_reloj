# Auditoría flujo mapa híbrido (MapTiler)

## Cadena de configuración

1. `useConfig` (`dash-ui/src/lib/useConfig.ts`) hace `getConfigV2()` contra `/api/config`, aplica `withConfigDefaultsV2` y expone el objeto completo (con `ui_map.*`) a los componentes.
2. `GeoScopeMap.loadRuntimePreferences` (`dash-ui/src/components/GeoScope/GeoScopeMap.tsx`) vuelve a pedir la configuración V2 para construir el runtime. Aquí se normaliza la vista (`viewMode`, `fixed`), se resuelve el estilo (`loadMapStyle`) y se devuelve `RuntimePreferences`.
3. En `GeoScopeMap` se llama a `extractHybridMappingConfig`, que extrae directamente `ui_map.maptiler.*` y `ui_map.satellite.*` (styleUrl, api_key, labels_overlay) sin pasar por lógica legacy.
4. Antes de instanciar `maplibregl.Map`, se emite `[HybridFix] runtime options before maplibregl.Map` con los campos clave (`base_style_url`, `satellite_style_url`, `maptiler_key_present`, etc.).
5. El componente `MapHybrid` (`dash-ui/src/components/GeoScope/layers/MapHybrid.tsx`) activa el modo híbrido usando `satelliteStyleUrl` y vuelve a loguear con `[HybridFix] MapHybrid enabled …` el raster y las etiquetas aplicadas.

## Dónde enchufar el híbrido

- El interruptor real es `effectiveSatelliteEnabled`: si vale `true`, `GeoScopeMap` renderiza `<MapHybrid />`.
- El híbrido se alimenta de `hybridConfig.baseStyleUrl` (vector) y `hybridConfig.satellite.styleUrl` (raster). Los logs `[HybridFix]` confirman si cada campo del backend llega al runtime.

## Verificación en tiempo de ejecución

- DevTools debería mostrar, en orden:
  - `[HybridFix] ui_map snapshot …` con los valores brutos del backend.
  - `[HybridFix] runtime options before maplibregl.Map …` con el objeto final usado para inicializar `maplibregl.Map`.
  - `[GeoScopeMap] Map init …` y, si procede, `[HybridFix] MapHybrid enabled …`.


