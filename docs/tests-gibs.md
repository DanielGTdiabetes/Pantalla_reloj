# Pruebas de GIBS (Satélite Global)

Este documento describe los pasos de prueba manuales para validar que la integración de GIBS (Global Imagery Browse Services de NASA) funciona correctamente como overlay satélite global.

## Configuración previa

Asegúrate de que:
- El servicio `pantalla-dash-backend@dani.service` está corriendo
- El servicio kiosk está activo
- La configuración tiene GIBS habilitado en `layers.global_.satellite` o `ui_global.satellite`

## 1. Comprobar configuración unificada

### Verificar que `layers.global_satellite` existe en `/api/config`

```bash
curl -sS http://127.0.0.1/api/config | jq '.layers.global_satellite'
```

**Resultado esperado:**
- Debe devolver un objeto JSON válido (no `null`)
- Debe contener los campos:
  - `enabled`: `true` o `false`
  - `provider`: `"gibs"`
  - `tile_matrix_set`: `"GoogleMapsCompatible_Level9"` (o similar)
  - `min_zoom`: número entre 1 y 6
  - `max_zoom`: número entre 1 y 9 (nunca mayor que 9 para `Level9`)
  - `default_zoom`: número entre `min_zoom` y `max_zoom`
  - `gibs`: objeto con configuración específica de GIBS

**Ejemplo de salida esperada:**
```json
{
  "enabled": true,
  "provider": "gibs",
  "refresh_minutes": 10,
  "history_minutes": 90,
  "frame_step": 10,
  "layer": "MODIS_Terra_CorrectedReflectance_TrueColor",
  "tile_matrix_set": "GoogleMapsCompatible_Level9",
  "min_zoom": 1,
  "max_zoom": 6,
  "default_zoom": 2,
  "gibs": {
    "epsg": "epsg3857",
    "tile_matrix_set": "GoogleMapsCompatible_Level9",
    "layer": "MODIS_Terra_CorrectedReflectance_TrueColor",
    "format_ext": "jpg",
    "time_mode": "default",
    "time_value": "default"
  }
}
```

### Verificar compatibilidad con `layers.global_.satellite`

```bash
curl -sS http://127.0.0.1/api/config | jq '.layers.global_.satellite'
```

**Resultado esperado:**
- También debe devolver un objeto válido (para compatibilidad)
- Debe tener la misma estructura que `layers.global_satellite`

## 2. Comprobar salud general

### Verificar estado de GIBS en `/api/health/full`

```bash
curl -sS http://127.0.0.1/api/health/full | jq '.layers'
```

**Resultado esperado:**
- Si GIBS está habilitado, debe aparecer algún estado relacionado
- `global_satellite.status` debe ser `"ok"`, `"degraded"` o `"down"`
- `global_satellite.frames_count` debe ser mayor que 0 si está `"ok"`

### Verificar frames de GIBS disponibles

```bash
curl -sS http://127.0.0.1/api/global/satellite/frames | jq '.count'
```

**Resultado esperado:**
- Debe devolver un número mayor que 0 si GIBS está habilitado
- Cada frame debe tener `tile_url`, `timestamp`, `min_zoom`, `max_zoom`

**Verificar estructura de un frame:**
```bash
curl -sS http://127.0.0.1/api/global/satellite/frames | jq '.frames[0]'
```

**Resultado esperado:**
```json
{
  "timestamp": 1234567890,
  "t_iso": "2024-01-01T00:00:00Z",
  "tile_url": "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/2024-01-01/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg",
  "min_zoom": 1,
  "max_zoom": 6,
  "tile_matrix_set": "GoogleMapsCompatible_Level9"
}
```

## 3. Probar en el mini-PC

### Arrancar servicios

```bash
# Verificar que el backend está corriendo
systemctl status pantalla-dash-backend@dani.service

# Si no está corriendo, iniciarlo
sudo systemctl start pantalla-dash-backend@dani.service

# Verificar que el kiosk está activo
systemctl status pantalla-kiosk-chrome@dani.service
```

### Verificar mapa base sin GIBS

1. Acceder a la interfaz web en el mini-PC
2. Verificar que el mapa base `streets-v4` se ve correctamente
3. No debe haber errores en la consola del navegador (DevTools)
4. El mapa debe renderizarse sin pantalla negra o verde/azul

### Activar GIBS desde `/config`

1. Acceder a la página de configuración (`/config`)
2. Ir a la sección "Satélite Global (GIBS)"
3. Activar el satélite si está desactivado
4. Guardar la configuración

**Verificar en DevTools (F12):**
- No deben aparecer errores `"Cannot read properties of null (reading 'version')"`
- No deben aparecer errores `"GIBS frames available but globalSatelliteLayer is not initialized"`
- Los tiles GIBS deben cargarse correctamente

### Verificar overlay satélite a diferentes zooms

1. Hacer zoom out hasta llegar a zoom 1-6 (rango válido de GIBS)
2. El overlay satélite debe verse correctamente sobre el mapa base
3. Hacer zoom in más allá de zoom 6
4. El overlay satélite debe seguir funcionando pero con límite en zoom 9 para `GoogleMapsCompatible_Level9`

**Verificar en DevTools (Network tab):**
- Las peticiones a tiles GIBS deben tener el formato:
  - `https://gibs.earthdata.nasa.gov/wmts/.../Level9/{z}/{y}/{x}.jpg`
  - El zoom `{z}` debe estar entre 1 y 9 (nunca mayor que 9)
- No deben aparecer errores 400 Bad Request para tiles GIBS

### Verificar que no hay tiles 400 al hacer zoom o pan

1. Abrir DevTools (F12) → Network tab
2. Filtrar por "gibs" o "earthdata"
3. Hacer zoom y pan por el mapa
4. Verificar que todas las peticiones a tiles GIBS devuelven 200 OK
5. Si aparece algún 400, verificar el log del backend:
   ```bash
   tail -f /var/log/pantalla/backend.log | grep -i gibs
   ```

**Resultado esperado:**
- No deben aparecer errores 400 para tiles GIBS cuando el mapa hace zoom o pan
- Si aparece un 400, debe ser por un tile fuera de los límites válidos (y debe estar siendo manejado correctamente)

### Desactivar GIBS

1. Volver a la página de configuración
2. Desactivar el satélite
3. Guardar la configuración

**Verificar:**
- El overlay satélite debe desaparecer del mapa
- El mapa base `streets-v4` debe seguir funcionando correctamente
- No debe quedar la pantalla en negro ni verde/azul
- No deben aparecer errores en la consola del navegador

## 4. Probar botón de test satélite

### Endpoint del botón de test

El botón de test satélite en `/config` llama a:
- `GET /api/test/gibs` o similar (verificar en el código del frontend)

### Verificar respuesta del endpoint

```bash
curl -sS http://127.0.0.1/api/test/gibs | jq '.'
```

**Resultado esperado:**
```json
{
  "ok": true,
  "tile_url": "https://gibs.earthdata.nasa.gov/...",
  "preview_url": "data:image/jpeg;base64,..."
}
```

O en caso de error:
```json
{
  "ok": false,
  "reason": "mensaje de error descriptivo"
}
```

### Qué se debe ver en la UI

1. Al hacer clic en "Probar GIBS", el botón debe mostrar "Probando..."
2. Si funciona correctamente:
   - Debe aparecer un mensaje de éxito: "✓ GIBS funcionando correctamente"
   - Debe mostrarse una vista previa del tile GIBS
3. Si falla:
   - Debe aparecer un mensaje de error: "✗ Error: [descripción]"

## 5. Validaciones adicionales

### Verificar que no se rompe el mapa base al desactivar GIBS

1. Activar GIBS
2. Esperar a que se cargue el overlay
3. Desactivar GIBS inmediatamente
4. Verificar que el mapa base sigue funcionando

### Verificar manejo de errores

1. Simular un error de red (desconectar temporalmente internet)
2. Intentar cargar frames de GIBS
3. Verificar que el mapa base sigue funcionando
4. Verificar que no aparecen errores no manejados en consola

### Verificar logs del backend

```bash
# Ver logs recientes de GIBS
tail -100 /var/log/pantalla/backend.log | grep -i gibs

# Buscar errores
tail -100 /var/log/pantalla/backend.log | grep -i "error.*gibs"
```

**Resultado esperado:**
- Debe haber logs informativos sobre frames de GIBS
- Si hay errores, deben ser manejados y no deben romper el servicio
- Debe haber logs de clamp de zoom cuando se ajusta el zoom automáticamente

## 6. Problemas conocidos y soluciones

### Problema: `layers.global_satellite` es `null`

**Solución:**
- Verificar que la configuración tiene `layers.global_.satellite` o `ui_global.satellite`
- Reiniciar el servicio backend:
  ```bash
  sudo systemctl restart pantalla-dash-backend@dani.service
  ```

### Problema: Tiles 400 Bad Request

**Solución:**
- Verificar que el zoom está dentro de los límites válidos (1-9 para `GoogleMapsCompatible_Level9`)
- Verificar logs del backend para ver si hay clamp de zoom automático
- Si persiste, puede ser un problema con el tile_matrix_set configurado

### Problema: Pantalla negra o verde/azul al desactivar GIBS

**Solución:**
- Verificar que el mapa base está correctamente configurado
- Verificar que no hay errores en consola del navegador
- Reiniciar el servicio kiosk si es necesario:
  ```bash
  sudo systemctl restart pantalla-kiosk-chrome@dani.service
  ```

### Problema: "Cannot read properties of null (reading 'version')"

**Solución:**
- Este error ya debería estar manejado con los cambios recientes
- Si persiste, verificar que el mapa base está completamente cargado antes de inicializar GIBS
- Revisar logs del frontend en DevTools

## 7. Notas técnicas

- **Tile Matrix Set:** `GoogleMapsCompatible_Level9` tiene un límite de zoom máximo de 9
- **Zoom válido:** El zoom debe estar entre `min_zoom` y `max_zoom` configurados (normalmente 1-6)
- **Clamp automático:** Si el mapa intenta usar un zoom mayor que el máximo, se ajusta automáticamente
- **URLs de tiles:** Se construyen con el formato WMTS de GIBS, con validación de zoom antes de construir la URL

