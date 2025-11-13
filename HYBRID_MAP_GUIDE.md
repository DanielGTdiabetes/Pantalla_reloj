# Guía: Modo Híbrido Satélite + Etiquetas de MapTiler

## Descripción General

El modo híbrido permite mostrar un **mapa de fotografía satélite** con un **overlay de etiquetas vectoriales** (calles, POIs, nombres de lugares) de MapTiler Street v4 encima.

**Orden de capas garantizado:**
1. Satélite (raster)
2. Etiquetas (vector symbols)
3. Radar (si está habilitado)
4. Vuelos (si está habilitado)
5. Barcos (si está habilitado)

---

## Configuración

### Requisitos Previos

1. **API Key de MapTiler**: Necesitas una clave válida de MapTiler
   - Obtén una en: https://cloud.maptiler.com/
   - La clave debe tener acceso a:
     - `maps/satellite/` (tiles raster)
     - `maps/streets-v4/` (etiquetas vectoriales)

2. **Archivo de configuración JSON** en `/var/lib/pantalla-reloj/config.json`

### Estructura de Configuración

```json
{
  "version": 2,
  "ui_map": {
    "engine": "maplibre",
    "provider": "maptiler_vector",
    "maptiler": {
      "api_key": "TU_API_KEY_AQUI",
      "style": "vector-bright",
      "styleUrl": "https://api.maptiler.com/maps/streets-v4/style.json"
    },
    "satellite": {
      "enabled": true,
      "opacity": 0.85,
      "style_url": "https://api.maptiler.com/maps/satellite/style.json",
      "labels_overlay": {
        "enabled": true,
        "style_url": "https://api.maptiler.com/maps/streets-v4/style.json",
        "layer_filter": null,
        "opacity": 1.0
      }
    },
    "viewMode": "fixed",
    "fixed": {
      "center": {
        "lat": 39.98,
        "lon": 0.20
      },
      "zoom": 9.0,
      "bearing": 0,
      "pitch": 0
    }
  }
}
```

### Campos Explicados

#### `ui_map.satellite` (objeto)

| Campo | Tipo | Descripción | Defecto |
|-------|------|-------------|---------|
| `enabled` | boolean | Habilitar modo híbrido satélite | `false` |
| `opacity` | number | Opacidad del satélite (0.0-1.0) | `0.85` |
| `style_url` | string | URL del estilo satélite (para obtener tiles raster) | `https://api.maptiler.com/maps/satellite/style.json` |
| `labels_overlay` | object | Configuración de overlay de etiquetas | Ver abajo |

#### `ui_map.satellite.labels_overlay` (objeto)

| Campo | Tipo | Descripción | Defecto |
|-------|------|-------------|---------|
| `enabled` | boolean | Mostrar etiquetas encima del satélite | `true` |
| `style_url` | string | URL del estilo de etiquetas (Streets v4) | `https://api.maptiler.com/maps/streets-v4/style.json` |
| `layer_filter` | string\|null | Filtro de capas (null = todas las symbol) | `null` |
| `opacity` | number | Opacidad de etiquetas (0.0-1.0) | `1.0` |

---

## Ejemplos de Configuración

### Ejemplo 1: Satélite + Etiquetas (Recomendado)

```json
{
  "ui_map": {
    "satellite": {
      "enabled": true,
      "opacity": 0.85,
      "style_url": "https://api.maptiler.com/maps/satellite/style.json",
      "labels_overlay": {
        "enabled": true,
        "style_url": "https://api.maptiler.com/maps/streets-v4/style.json",
        "opacity": 1.0
      }
    }
  }
}
```

### Ejemplo 2: Solo Satélite (sin etiquetas)

```json
{
  "ui_map": {
    "satellite": {
      "enabled": true,
      "opacity": 0.85,
      "style_url": "https://api.maptiler.com/maps/satellite/style.json",
      "labels_overlay": {
        "enabled": false
      }
    }
  }
}
```

### Ejemplo 3: Satélite con etiquetas semitransparentes

```json
{
  "ui_map": {
    "satellite": {
      "enabled": true,
      "opacity": 0.9,
      "style_url": "https://api.maptiler.com/maps/satellite/style.json",
      "labels_overlay": {
        "enabled": true,
        "style_url": "https://api.maptiler.com/maps/streets-v4/style.json",
        "opacity": 0.7
      }
    }
  }
}
```

### Ejemplo 4: Deshabilitado (vuelve al mapa vector normal)

```json
{
  "ui_map": {
    "satellite": {
      "enabled": false
    }
  }
}
```

---

## Cómo Usar

### 1. Copiar archivo de ejemplo

```bash
cp config.example.json /var/lib/pantalla-reloj/config.json
```

### 2. Editar con tu API key

```bash
nano /var/lib/pantalla-reloj/config.json
```

Busca `"api_key": "fBZDqPrUD4EwoZLV4L6A"` y reemplaza con tu clave.

### 3. Reiniciar el backend

```bash
sudo systemctl restart pantalla-dash-backend@dani.service
```

### 4. Recargar el navegador

Abre el navegador y recarga la página. Deberías ver:
- Fondo de satélite
- Etiquetas de calles y POIs encima
- Radar, vuelos, barcos (si están habilitados) encima de todo

---

## Troubleshooting

### El mapa muestra solo satélite, sin etiquetas

**Causa:** Las etiquetas no se cargaron correctamente.

**Solución:**
1. Abre la consola del navegador (F12)
2. Busca errores que mencionen `vectorLabels` o `MapHybrid`
3. Verifica que la API key sea válida
4. Verifica que `labels_overlay.enabled` sea `true`

### El mapa muestra error 403 (Forbidden)

**Causa:** La API key no tiene acceso a los tiles de satélite o etiquetas.

**Solución:**
1. Verifica la API key en https://cloud.maptiler.com/
2. Asegúrate de que tiene acceso a:
   - `maps/satellite/`
   - `maps/streets-v4/`
3. Regenera la clave si es necesario

### El mapa muestra mar blanco o fondo azul

**Causa:** Las etiquetas están tapando el satélite (problema de z-index).

**Solución:**
1. Reduce `labels_overlay.opacity` a 0.7 o 0.8
2. O aumenta `satellite.opacity` a 0.95

### Las etiquetas se ven pixeladas o borrosas

**Causa:** Nivel de zoom muy bajo.

**Solución:**
1. Aumenta el zoom en `fixed.zoom` (ej: 9.0 → 10.0)
2. O aumenta `labels_overlay.opacity` a 1.0

---

## Cambios en el Código

### Archivos Modificados

1. **`dash-ui/src/lib/map/utils/maptilerHelpers.ts`**
   - Nuevas funciones: `isSatelliteStyle()`, `isHybridStyle()`, `getSatelliteTileUrl()`

2. **`dash-ui/src/components/GeoScope/layers/MapHybrid.tsx`**
   - Mejorado para usar `ensureLabelsOverlay()` de `vectorLabels.ts`
   - Usa `getSatelliteTileUrl()` para obtener URL de tiles correcta
   - Mejor manejo de errores

3. **`dash-ui/src/components/GeoScope/GeoScopeMap.tsx`**
   - Ahora pasa `labelsOpacity` a `MapHybrid`
   - Lee `ui_map.satellite` correctamente desde la configuración

4. **`config.example.json`** (Nuevo)
   - Archivo de ejemplo con configuración completa

---

## Arquitectura

### Flujo de Inicialización

```
GeoScopeMap (crea mapa base)
    ↓
Lee config.ui_map.satellite
    ↓
Si enabled=true, renderiza <MapHybrid>
    ↓
MapHybrid:
  1. Obtiene URL de tiles raster (getSatelliteTileUrl)
  2. Añade source raster "maptiler-satellite-raster"
  3. Añade layer raster "maptiler-satellite-raster-layer"
  4. Si labels_overlay.enabled=true:
     - Llama ensureLabelsOverlay()
     - Carga style JSON de Streets v4
     - Extrae solo capas symbol (labels)
     - Las añade encima del satélite
    ↓
LayerRegistry reinyecta capas:
  - Radar
  - Vuelos
  - Barcos
    ↓
Resultado final (orden de z-index):
  1. Satélite (raster)
  2. Etiquetas (vector symbols)
  3. Radar (raster)
  4. Vuelos (symbols)
  5. Barcos (symbols)
```

---

## Notas Técnicas

### Por qué `getSatelliteTileUrl()`

MapTiler proporciona dos tipos de URLs:
- **Style JSON**: `https://api.maptiler.com/maps/satellite/style.json`
- **Tiles raster**: `https://api.maptiler.com/tiles/satellite/{z}/{x}/{y}.jpg`

El componente MapHybrid necesita la URL de tiles, no el style JSON. La función `getSatelliteTileUrl()` convierte automáticamente entre ambos formatos.

### Por qué `ensureLabelsOverlay()`

En lugar de cargar manualmente las etiquetas, usamos la función existente `ensureLabelsOverlay()` de `vectorLabels.ts` porque:
- ✅ Maneja errores de red correctamente
- ✅ Extrae solo capas symbol (evita tapar el satélite)
- ✅ Aplica opacidad correctamente
- ✅ Limpia capas antiguas antes de añadir nuevas

### Orden de Capas Garantizado

El componente busca capas de overlay conocidas (`geoscope-global-radar`, `geoscope-aircraft`, etc.) y inserta las capas de satélite y etiquetas **antes** de ellas, garantizando que aparezcan debajo.

---

## FAQ

**P: ¿Puedo usar otro estilo de etiquetas además de Streets v4?**
R: Sí, cualquier estilo de MapTiler que tenga capas symbol (etiquetas). Ej: `https://api.maptiler.com/maps/bright-v2/style.json`

**P: ¿Qué pasa si desactivo las etiquetas?**
R: Se muestra solo el satélite. Puedes cambiar `labels_overlay.enabled` a `false`.

**P: ¿Funciona con radar, vuelos y barcos?**
R: Sí, todas las capas se montan encima del satélite + etiquetas automáticamente.

**P: ¿Puedo cambiar la opacidad sin reiniciar?**
R: Sí, edita `config.json` y recarga la página. Los cambios se aplican al instante.

---

## Soporte

Si encuentras problemas:
1. Revisa los logs del backend: `journalctl -u pantalla-dash-backend@dani.service -n 50`
2. Abre la consola del navegador (F12) y busca errores
3. Verifica que la API key sea válida en https://cloud.maptiler.com/
