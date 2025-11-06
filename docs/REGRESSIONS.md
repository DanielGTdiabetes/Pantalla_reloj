# Regresiones Conocidas y Cómo Evitarlas

Este documento lista las regresiones conocidas y cómo evitarlas.

## 1. Pérdida de Configuración al Guardar

### Problema

Al guardar un grupo de configuración, se borran claves que no están presentes en el formulario.

### Causa

Uso de `PUT` o `saveConfigV2` completo en lugar de `PATCH /api/config/group/{group_name}` con deep-merge.

### Solución Implementada

- **Deep-merge en PATCH**: El endpoint `PATCH /api/config/group/{group_name}` hace deep-merge
- **Frontend usa saveConfigGroup**: Todas las operaciones de guardado usan `saveConfigGroup` (PATCH) en lugar de `saveConfigV2` (PUT)
- **No borra claves**: Solo actualiza las claves presentes en el payload, preservando todas las demás

### Cómo Verificar

```bash
# Antes de guardar
curl -s "${API_BASE}/api/config" > /tmp/config-before.json

# Guardar solo un campo
curl -X PATCH "${API_BASE}/api/config/group/layers.flights" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'

# Después de guardar
curl -s "${API_BASE}/api/config" > /tmp/config-after.json

# Verificar que otras claves se mantienen
jq '.layers.flights.max_items_global' /tmp/config-before.json
jq '.layers.flights.max_items_global' /tmp/config-after.json
# Deben ser iguales
```

### Prevención

- ✅ Siempre usar `saveConfigGroup` (PATCH) en lugar de `saveConfigV2` (PUT)
- ✅ Solo enviar sub-árboles en el payload, no la configuración completa
- ✅ El backend hace deep-merge automáticamente

## 2. Secrets Expuestos en `/api/config`

### Problema

Los valores reales de API keys y credenciales se exponen en la respuesta de `/api/config`.

### Causa

Sanitización incompleta o incorrecta en `_build_public_config_v2`.

### Solución Implementada

- **Sanitización recursiva**: Función `_sanitize_secrets_recursive` que nullifica valores sensibles
- **Preserva metadatos**: Solo nullifica valores reales, preserva metadatos como `has_api_key`, `api_key_last4`
- **Backup de secrets**: Se hace backup del bloque `secrets` antes de sanitizar, luego se restaura para preservar metadatos

### Cómo Verificar

```bash
# Verificar que no hay secretos expuestos
curl -s "${API_BASE}/api/config" | jq '.secrets.maptiler.api_key'
# Debe ser null o no existir

# Verificar que hay metadatos
curl -s "${API_BASE}/api/config" | jq '.secrets.maptiler'
# Debe tener has_api_key y api_key_last4
```

### Prevención

- ✅ Nunca exponer valores reales en `secrets.*`
- ✅ Solo exponer metadatos: `has_api_key`, `api_key_last4`, `token_url`, etc.
- ✅ Verificar con `jq` antes de cada release

## 3. MapTiler URLs Incorrectas (V1 → V2)

### Problema

Las URLs de MapTiler usan nombres v1 (`vector-dark`, `vector-light`) en lugar de v2 (`streets-v2`, `bright-v2`, `dataviz-dark`).

### Causa

Mapeo incorrecto o falta de actualización a nombres v2.

### Solución Implementada

- **Mapeo correcto en frontend**: `computeStyleUrlFromConfig` mapea nombres v1 a v2:
  - `vector-dark` → `dataviz-dark`
  - `vector-light` → `streets-v2`
  - `vector-bright` → `bright-v2`
- **Prioridad de styleUrl**: Si hay `styleUrl` personalizado, se usa directamente
- **URLs personalizadas**: Soporte para `maptiler.urls.styleUrlDark`, etc.

### Cómo Verificar

1. Configurar MapTiler con style `streets-v2`
2. Verificar en la consola del navegador que la URL generada contiene `streets-v2`
3. Verificar que el mapa se carga correctamente

### Prevención

- ✅ Usar siempre nombres v2: `streets-v2`, `bright-v2`, `dataviz-dark`
- ✅ Verificar que el mapeo v1→v2 funciona correctamente
- ✅ Probar que el mapa se carga con cada estilo

## 4. AEMET Bloqueante

### Problema

El sistema falla o no inicia si AEMET no está configurado o falla.

### Causa

Dependencias hardcodeadas o falta de manejo de errores.

### Solución Implementada

- **AEMET opcional**: El sistema funciona completamente sin AEMET
- **No bloqueante**: Si AEMET falla, otros proveedores siguen funcionando
- **Manejo de errores**: Todos los endpoints de AEMET tienen try-catch y no propagan errores

### Cómo Verificar

1. No configurar AEMET o usar API key inválida
2. Verificar que el sistema funciona normalmente
3. Verificar que otros proveedores (GIBS, RainViewer, etc.) funcionan
4. Verificar que AEMET aparece como opcional en `/config`

### Prevención

- ✅ AEMET siempre opcional, nunca requerido
- ✅ Manejar errores de AEMET sin afectar otros proveedores
- ✅ Verificar que el sistema funciona sin AEMET

## 5. RainViewer Bug: "dict' object cannot be interpreted as an integer"

### Problema

Error `TypeError: 'dict' object cannot be interpreted as an integer` al obtener frames de RainViewer.

### Causa

El campo `time` en la respuesta de RainViewer puede ser un dict en lugar de un int/float.

### Solución Implementada

- **Validación explícita**: Verificación de tipo antes de convertir a int
- **Manejo de errores**: Try-catch que loguea warnings y omite items inválidos
- **Skip items inválidos**: Si un timestamp no es válido, se omite en lugar de fallar

### Cómo Verificar

```bash
# Probar RainViewer
curl -X POST "${API_BASE}/api/global/radar/test" | jq .

# Obtener frames (debe funcionar sin errores)
curl -s "${API_BASE}/api/global/radar/frames" | jq .
```

### Prevención

- ✅ Validar siempre tipos antes de convertir
- ✅ Manejar casos edge en la respuesta de RainViewer
- ✅ Loguear warnings en lugar de fallar

## 6. Chromium Usando Snap

### Problema

El sistema usa Chromium desde Snap, que puede ser inestable o lento.

### Causa

Rutas y detección de binario priorizando Snap.

### Solución Implementada

- **Rutas estándar XDG**: Directorios de datos y cache en `~/.local/share` y `~/.cache`
- **Prioridad de binarios**: Priorizar binarios normales sobre Snap
- **Fallback a Snap**: Solo usar Snap si no hay alternativa
- **Advertencias**: Log warnings si se usa Snap

### Cómo Verificar

```bash
# Verificar que no se usa Snap
grep -r "snap" /etc/systemd/system/pantalla-kiosk-chromium@*.service
# No debe haber rutas de snap

# Verificar directorios
ls -la ~/.local/share/pantalla-reloj/chromium
ls -la ~/.cache/pantalla-reloj/chromium
```

### Prevención

- ✅ Instalar Chromium normal: `apt-get install chromium-browser`
- ✅ Verificar que las rutas no usan Snap
- ✅ Verificar que el script prioriza binarios normales

## 7. Rotator No Incluye Todos los Paneles

### Problema

El rotator no muestra todos los paneles configurados (clock, weather, astronomy, etc.).

### Causa

Mapeo incorrecto o falta de inclusión de paneles en `OverlayRotator`.

### Solución Implementada

- **Mapeo completo**: Todos los paneles están mapeados en `OverlayRotator`
- **Orden configurable**: El orden se lee de `ui_global.overlay.order`
- **Paneles incluidos**: clock, weather, astronomy, santoral, calendar, news, historicalEvents, forecast, moon, harvest

### Cómo Verificar

1. Configurar orden de paneles en `/config`
2. Verificar que todos los paneles aparecen en el rotator
3. Verificar que el orden es correcto

### Prevención

- ✅ Verificar que todos los paneles están mapeados
- ✅ Verificar que el orden se lee correctamente
- ✅ Probar cada panel individualmente

## 8. Animación de Capas Globales No Funciona

### Problema

Las capas de satélite y radar no se animan (frames no avanzan).

### Causa

Falta de lógica de animación en el frontend o timestamps no se actualizan.

### Solución Implementada

- **Lógica de animación**: `useEffect` que actualiza frames periódicamente
- **Actualización de timestamps**: Los timestamps se actualizan según `refresh_minutes` y `frame_step`
- **Re-add de capas**: Las capas se re-agregan cuando cambia el timestamp

### Cómo Verificar

1. Habilitar satélite y radar en `/config`
2. Ir a la vista principal del mapa
3. Verificar que las capas se animan (frames avanzan)
4. Verificar en la consola que los timestamps se actualizan

### Prevención

- ✅ Verificar que `refresh_minutes` y `frame_step` están configurados
- ✅ Verificar que los frames se obtienen correctamente
- ✅ Verificar que los timestamps se actualizan periódicamente

## 9. Lightning Decay Temporal No Funciona

### Problema

Los rayos no se desvanecen con el tiempo (decay temporal).

### Causa

Falta de lógica de decay o propiedades de opacidad no se aplican.

### Solución Implementada

- **Cálculo de decay**: Cada rayo tiene `age_seconds` y `opacity` calculados
- **Filtrado por edad**: Rayos más antiguos que `max_age_seconds` se filtran
- **Expresiones de paint**: `circle-opacity` y `circle-blur` usan expresiones basadas en `age_seconds`

### Cómo Verificar

1. Habilitar lightning en `/config`
2. Verificar que los rayos se reciben (MQTT funciona)
3. Verificar que los rayos más antiguos son más transparentes
4. Verificar que los rayos muy antiguos desaparecen

### Prevención

- ✅ Verificar que `age_seconds` se calcula correctamente
- ✅ Verificar que las expresiones de paint funcionan
- ✅ Verificar que `max_age_seconds` se respeta

## 10. Modo Tormenta No Se Activa Automáticamente

### Problema

El modo tormenta no se activa automáticamente cuando se cumplen los umbrales.

### Causa

Falta de lógica de activación automática o umbrales no se verifican.

### Solución Implementada

- **Lógica de activación**: `useEffect` en `GeoScopeMap` verifica umbrales
- **Cálculo de distancia**: Fórmula de Haversine para calcular distancia de rayos
- **Activación automática**: Si se cumplen umbrales, se activa modo tormenta
- **Configuración**: `blitzortung.auto_storm_mode` controla la activación

### Cómo Verificar

1. Configurar `blitzortung.auto_storm_mode`:
   - Threshold: `5` rayos
   - Radius: `50` km
2. Verificar que los rayos se reciben
3. Verificar que el modo tormenta se activa cuando se cumplen umbrales
4. Verificar que el mapa se centra y hace zoom automáticamente

### Prevención

- ✅ Verificar que los umbrales se leen correctamente
- ✅ Verificar que la lógica de activación funciona
- ✅ Probar con diferentes umbrales

## Checklist de Prevención de Regresiones

Antes de cada release, verificar:

- [ ] PATCH hace deep-merge (no borra claves)
- [ ] Secrets no se exponen en `/api/config`
- [ ] MapTiler usa URLs v2 correctas
- [ ] AEMET es opcional (no bloqueante)
- [ ] RainViewer no falla con tipos inválidos
- [ ] Chromium no usa Snap
- [ ] Rotator incluye todos los paneles
- [ ] Capas globales se animan
- [ ] Lightning decay temporal funciona
- [ ] Modo tormenta se activa automáticamente
- [ ] Tests de proveedores funcionan
- [ ] ICS upload funciona con progreso
- [ ] Logs rotativos funcionan
- [ ] Snapshots diarios funcionan

