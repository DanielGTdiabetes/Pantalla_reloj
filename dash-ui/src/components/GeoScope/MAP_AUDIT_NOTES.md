# Auditoría flujo mapa híbrido (MapTiler)

## Cadena de configuración

1. `useConfig` (`dash-ui/src/lib/useConfig.ts`) hace `getConfigV2()` contra `/api/config`, aplica `withConfigDefaultsV2` y expone el objeto completo (con `ui_map.*`) a los componentes.
2. `GeoScopeMap.loadRuntimePreferences` (`dash-ui/src/components/GeoScope/GeoScopeMap.tsx`) vuelve a pedir la configuración V2 para construir el runtime. Aquí se normaliza la vista (`viewMode`, `fixed`), se resuelve el estilo (`loadMapStyle`) y se devuelve `RuntimePreferences`.
3. En la propia `GeoScopeMap`, `ui_map.satellite.*` se lee mediante `useMemo`; `effectiveBaseStyleUrl` prioriza `ui_map.satellite.style_url` y si está deshabilitado usa `ui_map.maptiler.styleUrl` como fallback vectorial.
4. Antes de instanciar `maplibregl.Map`, se emite `[MapAudit] runtime map options before maplibregl.Map` para confirmar qué valores llegan a la inicialización.
5. El componente `MapHybrid` (`dash-ui/src/components/GeoScope/layers/MapHybrid.tsx`) es el punto donde se activa el modo híbrido: usa el API key, la URL base de satélite y el overlay de etiquetas normalizado.

## Dónde enchufar el híbrido

- El interruptor real es `effectiveSatelliteEnabled`: si vale `true`, `GeoScopeMap` renderiza `<MapHybrid />`.
- Para garantizar el híbrido permanente habría que asegurar que `effectiveBaseStyleUrl` reciba siempre la URL de satélite y que `MapHybrid` añada las etiquetas vectoriales encima. Los logs `[MapAudit]` permiten comprobar si `ui_map.satellite.enabled` llega a `true` y si la URL/overlay se usan.

## Verificación en tiempo de ejecución

- DevTools debería mostrar, en orden:
  - `[MapAudit] ui_map.satellite from config …` con los campos saneados (sin key en claro).
  - `[MapAudit] runtime map options before maplibregl.Map …` con los valores usados para crear `maplibre`.
  - `[GeoScopeMap] Map init …` y, si procede, `[MapHybrid] Hybrid mode enabled …`.


