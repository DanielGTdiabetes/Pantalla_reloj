# Hot Reload de Configuración

## Resumen

El sistema implementa hot-reload completo de la configuración sin necesidad de reiniciar el servicio. Los cambios en `/api/config` se reflejan inmediatamente en el runtime del backend y en la UI del frontend.

## Flujo de Hot Reload

### Backend

1. **Persistencia**: Cuando se guarda la configuración mediante `POST /api/config`, se persiste de forma atómica usando `write_config_atomic()`.
2. **Invalidación de caché**: Se invalidan las entradas de caché relacionadas con configuración:
   - `health`: El endpoint de health usa config
   - `calendar`: El endpoint de calendar usa config
   - `storm_mode`: Storm mode usa config
3. **Recarga en runtime**: Se llama a `reload_runtime_config()` que recarga la configuración desde el archivo usando `config_manager.reload()`.
4. **Actualización de servicios**: Los servicios que dependen de config (como `ships_service`) se actualizan automáticamente.

### Frontend

1. **Evento de guardado**: Cuando `ConfigPage` guarda exitosamente, dispara el evento `pantalla:config:saved`.
2. **Re-fetch inmediato**: Todos los componentes que usan `useConfig()` escuchan este evento y hacen un re-fetch inmediato de la configuración.
3. **Actualización del mapa**: `GeoScopeMap` detecta cambios en `ui_map.fixed` (zoom/centro) y actualiza la vista automáticamente.
4. **Polling de respaldo**: Además del evento, `useConfig()` mantiene un polling cada 1.5 segundos para detectar cambios externos.

## Latencia Esperada

### Backend
- **Persistencia**: ~10-50ms (escritura atómica)
- **Invalidación de caché**: ~1-5ms (operaciones de archivo)
- **Recarga de config**: ~5-20ms (lectura y parsing)
- **Total backend**: **~16-75ms** desde que se recibe el POST hasta que la config está lista en runtime

### Frontend
- **Evento de guardado**: ~0-5ms (despacho de evento)
- **Re-fetch de config**: ~50-200ms (request HTTP + parsing)
- **Actualización del mapa**: ~100-800ms (animación suave del mapa)
- **Total frontend**: **~150-1000ms** desde que se guarda hasta que se ve el cambio en la UI

### Total End-to-End
- **Latencia típica**: **200-1100ms**
- **Latencia en red local**: **150-300ms**
- **Latencia con red lenta**: **500-1500ms**

## Cómo Forzar Rehidratación

### Desde el Backend

#### 1. Endpoint de Recarga Explícita
```bash
curl -X POST http://127.0.0.1:8081/api/config/reload
```

#### 2. Invalidación Manual de Caché
```python
# En el código backend
cache_store.invalidate("health")
cache_store.invalidate("calendar")
cache_store.invalidate("storm_mode")
```

#### 3. Recarga Manual de Config
```python
# En el código backend
config_manager.reload()
```

### Desde el Frontend

#### 1. Re-fetch Manual con useConfig
```typescript
const { reload } = useConfig();
// Forzar re-fetch inmediato
await reload();
```

#### 2. Disparar Evento Personalizado
```typescript
// Desde cualquier componente
window.dispatchEvent(new CustomEvent("pantalla:config:saved", { 
  detail: { version: 2 } 
}));
```

#### 3. Llamar API de Recarga
```typescript
import { reloadConfig } from "../lib/api";
await reloadConfig();
```

## Verificación

### Test Básico de Hot Reload

```bash
# 1. Cambiar zoom/centro en /config
curl -sS -X POST -H "Content-Type: application/json" \
  --data '{"version":2,"ui_map":{"fixed":{"zoom":8.2,"center":{"lat":39.98,"lon":0.20}}}}' \
  http://127.0.0.1:8081/api/config

# 2. Observar cambio inmediato en UI (sin reiniciar servicio)
# El mapa debería actualizarse en ~200-1000ms
```

### Checklist de Verificación

- [ ] El mapa se actualiza sin reiniciar el servicio
- [ ] Los overlays (vuelos, barcos, radar) se rehidratan correctamente
- [ ] El endpoint `/api/config` devuelve la nueva configuración inmediatamente
- [ ] Los endpoints que dependen de config (`/api/health`, `/api/calendar`) reflejan los cambios
- [ ] El polling de 1.5s sigue funcionando como respaldo

## Notas Técnicas

### Invalidación de Caché
La invalidación de caché es conservadora: solo se invalidan las claves específicas que se sabe que dependen de la configuración. Esto minimiza el impacto en el rendimiento mientras asegura consistencia.

### Polling como Respaldo
El polling de 1.5 segundos actúa como mecanismo de respaldo para detectar cambios externos (por ejemplo, si alguien edita el archivo de configuración directamente). El evento `pantalla:config:saved` proporciona actualización inmediata para cambios desde la UI.

### Detección de Cambios en el Mapa
El mapa detecta cambios en `ui_map.fixed` comparando la configuración anterior con la nueva. Solo actualiza si hay diferencias significativas (thresholds: 0.001 grados para centro, 0.01 para zoom) para evitar actualizaciones innecesarias.

### Prioridad de Storm Mode
Cuando storm mode está activo, tiene prioridad sobre `ui_map.fixed`. Los cambios en zoom/centro solo se aplican si storm mode está desactivado.














