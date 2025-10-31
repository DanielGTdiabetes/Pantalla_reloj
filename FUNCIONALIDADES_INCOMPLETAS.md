# Funcionalidades Configuradas Pero No Completamente Implementadas

## Resumen

Se identificaron **3 funcionalidades principales** que están configuradas y preparadas pero no completamente implementadas:

---

## 1. ❌ Provider "custom" (Flights y Ships)

### Estado: Configurado pero sin implementación

**Ubicación:**
- `backend/models.py`: `FlightsLayer.provider` y `ShipsLayer.provider` incluyen `"custom"`
- `dash-ui/src/types/config.ts`: Tipos incluyen `"custom"`
- `dash-ui/src/pages/ConfigPage.tsx`: UI permite seleccionar `"custom"`
- `backend/main.py`: Cuando `provider == "custom"`, hace fallback

**Problema:**
```python
# backend/main.py líneas 999-1002
else:
    # Fallback a OpenSky si no se reconoce
    logger.warning("Unknown flights provider: %s, using OpenSky", flights_config.provider)
    provider = OpenSkyFlightProvider()
```

Cuando se selecciona `"custom"`:
- ❌ No hay forma de configurar un proveedor personalizado
- ❌ No hay campos en la UI para URL/cabeceras personalizadas
- ❌ No hay implementación de `CustomFlightProvider` o `CustomShipProvider`
- ✅ Solo hace fallback al proveedor por defecto (OpenSky/GenericAIS)

**Impacto:** Bajo (la opción existe pero no hace nada útil)

**Recomendación:** 
- Opción A: Eliminar la opción `"custom"` de los tipos si no se va a implementar
- Opción B: Implementar proveedor custom que acepte URL y headers desde config

---

## 2. ⚠️ Máscaras de Radar en `cine_focus`

### Estado: Parcialmente implementado

**Ubicación:**
- `backend/focus_masks.py`: Función `build_radar_mask()` existe pero retorna `None`
- Configuración existe: `cine_focus.radar_dbz_threshold`, `cine_focus.mode = "radar"` o `"both"`

**Problema:**
```python
# backend/focus_masks.py líneas 177-197
def build_radar_mask(
    radar_data: Dict[str, Any],
    threshold_dbz: float,
    buffer_km: float
) -> Optional[Dict[str, Any]]:
    """Construye una máscara de foco a partir de datos de radar.
    
    Nota: Por ahora, esto es una implementación simplificada.
    En producción, necesitaría procesar los tiles de radar reales.
    """
    # Por ahora, retornar None ya que necesitaríamos procesar tiles de radar
    # En producción, esto procesaría los tiles y generaría contornos
    return None
```

**Efecto:**
- ✅ Modo `"cap"` funciona correctamente
- ❌ Modo `"radar"` no funciona (siempre retorna `None`)
- ⚠️ Modo `"both"` solo usa CAP (prioridad a CAP cuando existe)

**Impacto:** Medio-Alto (si el usuario configura `mode="radar"`, no verá ningún foco)

**Recomendación:** Implementar procesamiento de tiles de radar AEMET para generar contornos/isobandas

---

## 3. ⚠️ Unión geométrica en `cine_focus` modo "both"

### Estado: Parcialmente implementado

**Ubicación:**
- `backend/focus_masks.py`: Función `build_focus_mask()` cuando `mode == "both"`

**Problema:**
```python
# backend/focus_masks.py líneas 235-246
elif mode == "both":
    # Unir las máscaras (simplificado: devolver la que exista)
    if cap_mask and radar_mask:
        # En producción, haría union geométrica
        # Por ahora, devolver la de CAP como prioridad
        return cap_mask
    elif cap_mask:
        return cap_mask
    elif radar_mask:
        return radar_mask
    else:
        return None
```

**Efecto:**
- ✅ Funciona pero de forma limitada
- ❌ No hace unión geométrica real (union de polígonos)
- ⚠️ Solo devuelve CAP si ambas existen (ignora radar)
- ⚠️ No combina áreas de ambas fuentes

**Impacto:** Medio (funciona pero no es óptimo - ignora datos de radar si CAP existe)

**Recomendación:** Usar librería como `shapely` para hacer union geométrica real de polígonos

---

## Resumen de Prioridades

| Funcionalidad | Prioridad | Impacto | Esfuerzo |
|---------------|-----------|---------|----------|
| **1. Provider "custom"** | Baja | Bajo | Medio |
| **2. Máscaras de Radar** | Alta | Alto | Alto |
| **3. Unión geométrica** | Media | Medio | Medio |

---

## Detalles Técnicos

### 1. Provider "custom"

**Para implementar:**
1. Crear `CustomFlightProvider` y `CustomShipProvider` que acepten:
   - URL base desde config
   - Headers personalizados
   - Parámetros de query
   - Transformación de datos (mapeo de campos)

2. Agregar campos de configuración:
   ```python
   class CustomFlightConfig(BaseModel):
       api_url: Optional[str]
       headers: Optional[Dict[str, str]]
       params: Optional[Dict[str, Any]]
   ```

3. Extender UI para mostrar campos cuando `provider == "custom"`

### 2. Máscaras de Radar

**Para implementar:**
1. Procesar tiles de radar AEMET (imágenes PNG/GeoTIFF)
2. Aplicar umbral `radar_dbz_threshold` para filtrar intensidad
3. Generar contornos/isobandas usando detección de bordes
4. Convertir contornos a GeoJSON Polygon/MultiPolygon
5. Aplicar buffer geodésico

**Requiere:**
- Librería para procesamiento de imágenes (PIL/Pillow, OpenCV)
- Librería para geometría (Shapely, GDAL)
- Acceso a tiles de radar desde AEMET

### 3. Unión geométrica

**Para implementar:**
1. Instalar `shapely`:
   ```bash
   pip install shapely
   ```

2. Usar operaciones geométricas:
   ```python
   from shapely.geometry import shape, mapping
   from shapely.ops import unary_union
   
   # Convertir GeoJSON a Shapely
   cap_shape = shape(cap_mask)
   radar_shape = shape(radar_mask)
   
   # Unión
   union_shape = unary_union([cap_shape, radar_shape])
   
   # Convertir de vuelta a GeoJSON
   union_geojson = mapping(union_shape)
   ```

---

## Conclusión

Las funcionalidades más críticas son:
1. **Máscaras de Radar** - Si el usuario configura `mode="radar"`, no funcionará
2. **Unión geométrica** - Modo `"both"` no combina correctamente las fuentes

El provider "custom" es menos crítico ya que simplemente no hace nada (fallback), pero podría ser útil para usuarios avanzados.

