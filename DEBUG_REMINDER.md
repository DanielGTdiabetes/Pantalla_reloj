# 🔧 RECORDATORIO: Debugging Capas del Mapa - Sesión 2025-11-29 (ACTUALIZADO)

## 📍 ESTADO ACTUAL

### ✅ COMPLETADO EN SESIÓN ANTERIOR:

1. **Aviones - Habilitación**: 
   - ✅ Agregado `aircraftLayer.setEnabled(true)` en `AircraftMapLayer.tsx` (línea 250)
   - ✅ Eliminada llamada a método inexistente `updateRenderState()` en `AircraftLayer.ts`

2. **Icono del Avión**:
   - ✅ Mejorado diseño en `planeIcon.ts` - ahora es un avión realista visto desde arriba
   - ✅ Incluye: fuselaje, alas anchas, cola en V, cabina (línea blanca), línea central

3. **Configuración Global**:
   - ✅ Agregado `window.__APP_CONFIG__` en `useConfig.ts` (línea 301-308)
   - ✅ Modificado `extractMaptilerApiKey()` en `GlobalRadarLayer.ts` para buscar en config global

4. **Correcciones de Errores**:
   - ✅ TypeError `aemet` null - agregado null check en `GeoScopeMap.tsx` (línea 979)
   - ✅ Método `extractMaptilerApiKey` - corregido nombre en `GlobalRadarLayer.ts` (línea 132)

5. **Documentación**:
   - ✅ Creado `.env.example` en `dash-ui/`
   - ✅ Creado `MAPTILER_SETUP.md` con instrucciones

---

### ✅ COMPLETADO EN SESIÓN ACTUAL (2025-11-29):

## 🎯 PROBLEMA CRÍTICO RESUELTO: Sincronización de Capas con Estilo

**Síntoma original**:
```
[AircraftLayer-symbol] Style not loaded yet, skipping operation
```

**Causa raíz identificada**:
- Las funciones `ensureFlightsLayer()`, `ensureShipsLayer()`, `ensureWarningsLayer()` se llamaban antes de que el estilo del mapa estuviera completamente cargado
- `withSafeMapStyle()` verificaba `map.isStyleLoaded()` y si era `false`, simplemente saltaba la operación sin reintentar
- Resultado: Los datos se recibían pero las capas nunca se creaban

**Solución implementada**:

### 1. Nueva función `waitForStyleLoaded()` en `safeMapOperations.ts`:
```typescript
export const waitForStyleLoaded = (
  map: MaptilerMap | undefined | null,
  timeoutMs: number = 10000
): Promise<boolean>
```
- Espera a que `map.isStyleLoaded()` y `getSafeMapStyle(map)` sean válidos
- Escucha eventos `styledata` y `load`
- Timeout configurable (default 10s)

### 2. Nueva función `withSafeMapStyleAsync()` en `safeMapOperations.ts`:
```typescript
export const withSafeMapStyleAsync = async (
  map: MaptilerMap | undefined | null,
  operation: () => void,
  layerName: string,
  timeoutMs: number = 10000
): Promise<boolean>
```
- Versión async de `withSafeMapStyle` que espera al estilo antes de ejecutar

### 3. Capas actualizadas para esperar al estilo:

- **`AircraftLayer.ts`** - `ensureFlightsLayer()`:
  ```typescript
  const styleReady = await waitForStyleLoaded(this.map, 15000);
  if (!styleReady) {
    console.warn("[AircraftLayer] Timeout waiting for style");
    return;
  }
  ```

- **`ShipsLayer.ts`** - `ensureShipsLayer()`:
  ```typescript
  const styleReady = await waitForStyleLoaded(this.map, 15000);
  if (!styleReady) {
    console.warn("[ShipsLayer] Timeout waiting for style");
    return;
  }
  ```

- **`AEMETWarningsLayer.ts`** - `ensureWarningsLayer()`:
  ```typescript
  const styleReady = await waitForStyleLoaded(this.map, 15000);
  if (!styleReady) {
    console.warn("[AEMETWarningsLayer] Timeout waiting for style");
    return;
  }
  ```

- **`GlobalRadarLayer.ts`** - `addMaptilerWeatherAsync()`:
  ```typescript
  const styleReady = await waitForStyleLoaded(map, 15000);
  if (!styleReady) {
    console.warn("[GlobalRadarLayer] Timeout waiting for style");
    return;
  }
  ```

---

## 🌧️ PROBLEMA RADAR MAPTILER RESUELTO: API Key

**Síntoma original**:
```
GET https://api.maptiler.com/weather/latest.json?key=&mtsid=... 403
```

**Causa raíz identificada**:
- El SDK de `@maptiler/weather` necesita `maptilerConfig.apiKey` configurado globalmente
- La API key se extraía correctamente pero NO se asignaba a la configuración global del SDK

**Solución implementada**:

### 1. En `GeoScopeMap.tsx` - Configurar API key ANTES de crear el mapa:
```typescript
import { Map as MaptilerMap, config as maptilerConfig } from "@maptiler/sdk";

// En useEffect de inicialización:
if (globalApiKey) {
  maptilerConfig.apiKey = globalApiKey;
  console.log("[GeoScopeMap] MapTiler API key configured globally for SDK");
}
```

### 2. En `GlobalRadarLayer.ts` - Configurar API key antes de crear RadarLayer:
```typescript
import { Map as MaptilerMap, config as maptilerConfig } from "@maptiler/sdk";

// En addMaptilerWeatherAsync():
if (!maptilerConfig.apiKey || maptilerConfig.apiKey !== maptilerKey) {
  maptilerConfig.apiKey = maptilerKey;
  console.log("[GlobalRadarLayer] MapTiler API key configured globally for Weather SDK");
}
```

---

## 📂 ARCHIVOS MODIFICADOS EN SESIÓN ACTUAL

1. **`dash-ui/src/components/GeoScope/GeoScopeMap.tsx`**:
   - Importado `config as maptilerConfig` de `@maptiler/sdk`
   - Añadida configuración global de API key antes de crear el mapa

2. **`dash-ui/src/lib/map/utils/safeMapOperations.ts`**:
   - Nueva función `waitForStyleLoaded()` - espera a que el estilo esté listo
   - Nueva función `withSafeMapStyleAsync()` - versión async de withSafeMapStyle

3. **`dash-ui/src/components/GeoScope/layers/AircraftLayer.ts`**:
   - Importadas nuevas funciones de safeMapOperations
   - `ensureFlightsLayer()` ahora espera al estilo con `waitForStyleLoaded()`

4. **`dash-ui/src/components/GeoScope/layers/ShipsLayer.ts`**:
   - Importadas nuevas funciones de safeMapOperations
   - `ensureShipsLayer()` ahora espera al estilo con `waitForStyleLoaded()`

5. **`dash-ui/src/components/GeoScope/layers/AEMETWarningsLayer.ts`**:
   - Importada `waitForStyleLoaded` de safeMapOperations
   - `ensureWarningsLayer()` ahora espera al estilo

6. **`dash-ui/src/components/GeoScope/layers/GlobalRadarLayer.ts`**:
   - Importado `config as maptilerConfig` de `@maptiler/sdk`
   - Importada `waitForStyleLoaded` de safeMapOperations
   - Nuevo método `addMaptilerWeatherAsync()` que espera al estilo
   - Configuración de API key global antes de crear RadarLayer

---

## 🔍 LOGS ESPERADOS DESPUÉS DE LAS CORRECCIONES

### Secuencia correcta de inicialización:
```
[GeoScopeMap] MapTiler API key configured globally for SDK
[LayerRegistry] Added layer geoscope-aircraft successfully
[LayerRegistry] Added layer geoscope-ships successfully
[LayerRegistry] Added layer geoscope-radar successfully
...
[AircraftLayer] Style is ready, proceeding with layer creation
[AircraftLayer] ensureFlightsLayer - creating/updating source+layers
[ShipsLayer] Style is ready, proceeding with layer creation
[GlobalRadarLayer] Style is ready, proceeding with radar layer creation
[GlobalRadarLayer] MapTiler API key configured globally for Weather SDK
```

### Radar funcionando:
```
[GlobalRadarLayer] Adding radar layer with beforeId = ...
```

### Sin errores de "Style not loaded yet":
- ❌ Ya no debería aparecer: `[AircraftLayer-symbol] Style not loaded yet, skipping operation`
- ❌ Ya no debería aparecer: `GET https://api.maptiler.com/weather/latest.json?key=&mtsid=... 403`

---

## 📝 ERRORES SECUNDARIOS (No críticos - Revisar si persisten)

1. **AEMET Warnings 404**: Endpoint `/api/aemet/warnings` puede no estar implementado
2. **CORS RTL Text**: Error de CORS para textos RTL (no crítico)
3. **HarvestCard Icons**: Iconos faltantes en `/icons/harvest/`
4. **MapLibre null values**: `Expected value to be of type number, but found null` (revisar expresiones de estilo)

---

## 💡 NOTAS IMPORTANTES

- **NO** usar variables de entorno `.env` para API keys - Todo se configura desde `/config`
- `window.__APP_CONFIG__` contiene la configuración completa de la aplicación
- El icono del avión se genera dinámicamente (no requiere archivos externos)
- `waitForStyleLoaded()` usa timeout de 15 segundos por defecto en las capas
- El SDK de MapTiler Weather (`@maptiler/weather`) requiere `maptilerConfig.apiKey` configurado globalmente

---

## 🎯 OBJETIVO FINAL

**Hacer que todas las capas (aviones, barcos, radar, avisos AEMET) se visualicen correctamente en el mapa**

**Criterio de éxito**:
- ✅ Ver iconos de aviones en el mapa
- ✅ Ver iconos de barcos en el mapa
- ✅ Ver radar meteorológico (si hay lluvia y está habilitado)
- ✅ Ver avisos AEMET (si hay alertas activas)
- ✅ No ver errores de "Style not loaded yet"
- ✅ No ver errores 403 del API de MapTiler Weather

---

**Última actualización**: 2025-11-29 (Sesión de corrección de capas)
**Estado**: Correcciones aplicadas - Pendiente verificación en navegador
