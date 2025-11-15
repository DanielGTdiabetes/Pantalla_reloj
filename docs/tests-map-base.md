# Pruebas del Mapa Base (Modo Solo MapTiler)

Este documento describe los pasos de prueba manuales para validar que el mapa base MapTiler (streets-v4) funciona correctamente **sin overlays globales** (GIBS, radar global).

## Estado Actual

**IMPORTANTE:** Todas las capas globales (GIBS, radar global) están **temporalmente deshabilitadas** en el frontend para dejar solo el mapa base funcionando de forma estable. Esto es una medida temporal para estabilizar el sistema antes de re-activar GIBS en una segunda iteración controlada.

## 1. Prueba en Mini-PC (Kiosk)

### Arrancar servicios

```bash
# Verificar que el backend está corriendo
systemctl status pantalla-dash-backend@dani.service

# Si no está corriendo, iniciarlo
sudo systemctl start pantalla-dash-backend@dani.service

# Verificar que el kiosk está activo
systemctl status pantalla-kiosk-chrome@dani.service

# Si no está corriendo, iniciarlo
sudo systemctl start pantalla-kiosk-chrome@dani.service
```

### Verificar mapa base

1. Acceder a la interfaz web en el mini-PC (normalmente http://localhost o similar)
2. **El mapa debe verse con estilo de calles (streets-v4)**
3. **NO debe verse verde/azul plano** - debe verse el mapa de calles normal
4. El mapa debe responder correctamente a los parámetros de `ui_map.fixed`:
   - Centro: Castellón (lat: ~39.938, lon: ~-0.101)
   - Zoom: ~10.8
   - Sin rotación (bearing: 0)

### Verificar en DevTools (si es posible)

Si puedes acceder a las DevTools del navegador en kiosk:

1. Abrir DevTools (F12)
2. Ir a la pestaña Console
3. **No deben aparecer errores JS críticos relacionados con:**
   - `gibs`
   - `globalSatelliteLayer`
   - `Cannot read properties of null (reading 'version')`
   - Errores de carga de tiles GIBS

4. Ir a la pestaña Network
5. **No deben aparecer peticiones a:**
   - `/api/global/satellite/frames`
   - `/api/global/radar/frames`
   - `gibs.earthdata.nasa.gov`

### Verificar logs del backend

```bash
# Ver logs recientes
tail -100 /var/log/pantalla/backend.log | grep -i "map\|config"

# Buscar errores relacionados con mapa
tail -100 /var/log/pantalla/backend.log | grep -i "error.*map"
```

**Resultado esperado:**
- No deben aparecer errores relacionados con GIBS o capas globales
- El backend debe servir `/api/config` correctamente

## 2. Prueba en Navegador de Escritorio

### Verificar compatibilidad

1. Abrir la misma URL del dashboard en un navegador de escritorio (Chrome, Firefox, etc.)
2. **El comportamiento del mapa debe ser idéntico al kiosk:**
   - Mapa de calles visible (streets-v4)
   - No verde/azul plano
   - Misma configuración de centro y zoom

### Verificar en DevTools

1. Abrir DevTools (F12)
2. Ir a la pestaña Console
3. **No deben aparecer errores JS críticos relacionados con:**
   - `gibs`
   - `globalSatelliteLayer`
   - `Cannot read properties of null (reading 'version')`

4. Ir a la pestaña Network
5. Filtrar por "api" o "global"
6. **No deben aparecer peticiones a:**
   - `/api/global/satellite/frames`
   - `/api/global/radar/frames`
   - URLs de GIBS (`gibs.earthdata.nasa.gov`)

### Verificar que el mapa base funciona independientemente de la config

Aunque `layers.global_`, `layers.global`, `layers.global_satellite` puedan existir en `/api/config`:

1. Verificar la configuración:
   ```bash
   curl -sS http://127.0.0.1/api/config | jq '.layers.global_satellite'
   ```

2. Puede devolver un objeto (la config existe), pero **el frontend NO debe usar esta config para crear capas**

3. Verificar que no se crean capas globales:
   - Abrir DevTools → Console
   - Buscar logs que contengan `[GlobalSatelliteLayer]` o `[GlobalRadarLayer]`
   - **No deben aparecer logs de creación de capas globales**
   - Si aparecen, deben ser solo logs de limpieza: `"[GlobalSatelliteLayer] removed (temporarily disabled - base map only mode)"`

## 3. Compatibilidad con Config Actual

### Verificar que la config puede tener capas globales sin romper el mapa

Aunque la configuración tenga:

```json
{
  "layers": {
    "global_": {
      "satellite": {
        "enabled": true,
        ...
      }
    }
  },
  "ui_global": {
    "satellite": {
      "enabled": true,
      ...
    }
  }
}
```

**El frontend debe:**
- Ignorar completamente estos campos
- NO crear ninguna capa global
- NO hacer peticiones a endpoints de frames globales
- El mapa base debe funcionar normalmente

### Probar con diferentes estados de config

1. **Con `enabled: false` en todas las capas globales:**
   - El mapa debe funcionar normalmente

2. **Con `enabled: true` en capas globales:**
   - El mapa debe funcionar normalmente
   - **El frontend debe ignorar estos valores** (fuerza `isEnabled: false`)

3. **Con capas globales ausentes:**
   - El mapa debe funcionar normalmente

## 4. Validaciones Adicionales

### Verificar que no hay animaciones globales

1. Abrir DevTools → Network
2. Dejar el mapa abierto por varios minutos
3. **No deben aparecer peticiones periódicas a:**
   - `/api/global/satellite/frames`
   - `/api/global/radar/frames`

### Verificar que el mapa se inicializa correctamente

1. Recargar la página varias veces (F5)
2. **El mapa debe inicializarse correctamente en cada recarga:**
   - No debe quedar pantalla negra
   - No debe quedar pantalla verde/azul
   - Debe mostrar el mapa de calles inmediatamente

### Verificar que no hay dependencias de capas globales

El mapa base debe funcionar **completamente independiente** de cualquier estado de capas globales:

1. El mapa debe inicializarse incluso si:
   - El backend no responde a `/api/global/satellite/frames`
   - Hay errores de red
   - La config tiene valores inválidos en capas globales

2. El mapa debe renderizarse correctamente incluso si:
   - `globalSatelliteReady` es `false`
   - `globalLayersSettings` tiene `isEnabled: false`
   - No hay frames disponibles de GIBS

## 5. Problemas Conocidos y Soluciones

### Problema: El mapa se ve verde/azul plano en el kiosk

**Causa posible:**
- El estilo base no está cargando correctamente
- Hay un error en la inicialización del mapa

**Solución:**
1. Verificar que el servicio backend está corriendo
2. Verificar que `/api/config` devuelve `ui_map.maptiler.styleUrl` correctamente
3. Verificar logs del backend:
   ```bash
   tail -100 /var/log/pantalla/backend.log | grep -i "maptiler\|style"
   ```
4. Verificar en DevTools (si es posible) si hay errores de carga de recursos

### Problema: El mapa no se inicializa

**Causa posible:**
- Error de WebGL
- Error de red al cargar el estilo

**Solución:**
1. Verificar en DevTools (Console) si hay errores relacionados con WebGL o MapLibre
2. Verificar que la URL del estilo es accesible:
   ```bash
   curl -I "$(curl -sS http://127.0.0.1/api/config | jq -r '.ui_map.maptiler.styleUrl')"
   ```
3. Debe devolver `200 OK`

### Problema: Aparecen errores sobre `globalSatelliteLayer`

**Causa posible:**
- Hay código que todavía intenta usar capas globales

**Solución:**
1. Verificar que los cambios están aplicados correctamente
2. Verificar que `globalLayersSettings` devuelve `isEnabled: false` siempre
3. Verificar que los useEffects están desactivados correctamente

## 6. Notas Técnicas

### Estado del Código

- **`globalLayersSettings`:** Fuerza `isEnabled: false` siempre, ignorando la config
- **`GlobalRadarLayer`:** No se crea en `initializeMap` (código comentado)
- **`GlobalSatelliteLayer`:** No se crea ni gestiona (useEffect desactivado)
- **Frames de capas globales:** No se cargan ni animan (useEffect desactivado)

### Próximos Pasos

Una vez que el mapa base funcione de forma estable:

1. Verificar que no hay errores en consola
2. Verificar que el mapa se ve correctamente en el kiosk
3. Probar en navegador de escritorio para comparar
4. Re-activar GIBS en una segunda iteración controlada

## 7. Comandos Útiles

### Verificar estado del backend

```bash
# Estado del servicio
systemctl status pantalla-dash-backend@dani.service

# Ver logs en tiempo real
tail -f /var/log/pantalla/backend.log | grep -i "map\|config\|error"
```

### Verificar configuración

```bash
# Ver config completa
curl -sS http://127.0.0.1/api/config | jq '.'

# Ver solo ui_map
curl -sS http://127.0.0.1/api/config | jq '.ui_map'

# Ver solo layers.global_satellite (puede existir pero no debe usarse)
curl -sS http://127.0.0.1/api/config | jq '.layers.global_satellite'
```

### Verificar que no hay peticiones a GIBS

```bash
# Ver logs del backend en busca de peticiones a GIBS
tail -100 /var/log/pantalla/backend.log | grep -i "gibs\|global.*satellite"

# No deberían aparecer peticiones de frames (aunque endpoints existan)
```

