# Informe de Diagnóstico: Configuración de Proveedores (Flights & Ships)

**Fecha:** $(date +%Y-%m-%d)  
**Objetivo:** Verificar si la UI de /config y el backend ya soportan selección y parámetros de proveedor para Flights y Ships.

---

## Resumen Ejecutivo

| Chequeo | Estado | Resultado |
|---------|--------|-----------|
| 1. Presencia de claves en GET /api/config | ❌ | Campos de proveedor existen pero **NO** incluyen los proveedores esperados ni sus parámetros |
| 2. Persistencia desde UI /config | ❌ | **NO** hay UI para seleccionar proveedor ni configurar parámetros |
| 3. Validación de esquema backend | ⚠️ | Valida valores permitidos pero **NO** valida configuraciones de proveedores |
| 4. Efecto sobre endpoints de datos | ❌ | Endpoints **NO** leen el provider desde config ni crean proveedores dinámicamente |
| 5. Logs y permisos | ✅ | Sistema de logs funcionando correctamente |

---

## 1. Presencia de Claves en GET /api/config

### Estado: ❌ NO COMPLETO

**Hallazgos:**

#### Backend Models (`backend/models.py`):

```python
class FlightsLayer(BaseModel):
    provider: Literal["opensky", "custom"] = Field(default="opensky")
    # ❌ NO incluye "aviationstack"
    # ❌ NO hay campos para opensky.auth.username/password
    # ❌ NO hay campos para aviationstack.base_url/api_key

class ShipsLayer(BaseModel):
    provider: Literal["ais_generic", "custom"] = Field(default="ais_generic")
    # ❌ NO incluye "aisstream" ni "aishub"
    # ❌ NO hay campos para aisstream.ws_url/api_key
    # ❌ NO hay campos para aishub.base_url/api_key
```

#### Default Config (`backend/default_config.json`):

```json
{
  "layers": {
    "flights": {
      "provider": "opensky",
      // ❌ NO hay sub-objeto opensky.auth.username/password
      // ❌ NO hay sub-objeto aviationstack.base_url/api_key
    },
    "ships": {
      "provider": "ais_generic",
      // ❌ NO hay sub-objeto aisstream.ws_url/api_key
      // ❌ NO hay sub-objeto aishub.base_url/api_key
    }
  }
}
```

#### Frontend Types (`dash-ui/src/types/config.ts`):

```typescript
export type FlightsLayerConfig = {
  provider: "opensky" | "custom";  // ❌ NO incluye "aviationstack"
  // ❌ NO hay campos para opensky.auth.username/password
  // ❌ NO hay campos para aviationstack.base_url/api_key
};

export type ShipsLayerConfig = {
  provider: "ais_generic" | "custom";  // ❌ NO incluye "aisstream" ni "aishub"
  // ❌ NO hay campos para aisstream.ws_url/api_key
  // ❌ NO hay campos para aishub.base_url/api_key
};
```

**Resultado:** Los campos `provider` existen pero:
- ❌ Flights: solo acepta `"opensky"` o `"custom"` (falta `"aviationstack"`)
- ❌ Ships: solo acepta `"ais_generic"` o `"custom"` (faltan `"aisstream"` y `"aishub"`)
- ❌ No existen campos para configurar credenciales/URLs de ningún proveedor

---

## 2. Persistencia desde la UI /config

### Estado: ❌ NO IMPLEMENTADO

**Hallazgos:**

#### UI de Configuración (`dash-ui/src/pages/ConfigPage.tsx`):

La sección "Capas en Tiempo Real" (líneas 2040-2288) solo incluye:
- ✅ Checkbox para `enabled`
- ✅ Slider para `opacity`
- ✅ Input numérico para `refresh_seconds`
- ✅ Input numérico para `max_age_seconds`
- ❌ **NO hay selector de `provider`**
- ❌ **NO hay campos para credenciales/URLs de proveedores**

**Código relevante:**
```tsx
// Líneas 2045-2164: Sección Flights
// Solo hay controles para enabled, opacity, refresh_seconds, max_age_seconds
// NO hay selector de provider
// NO hay campos para opensky.auth.username/password
// NO hay campos para aviationstack.base_url/api_key

// Líneas 2167-2287: Sección Ships
// Solo hay controles para enabled, opacity, refresh_seconds, max_age_seconds
// NO hay selector de provider
// NO hay campos para aisstream.ws_url/api_key
// NO hay campos para aishub.base_url/api_key
```

**Comparación con Map Provider (que SÍ funciona):**
```tsx
// Líneas 671-719: Map Provider - SÍ tiene selector
<select value={form.map.provider} onChange={...}>
  {MAP_BACKEND_PROVIDERS.map((option) => (
    <option key={option} value={option}>
      {MAP_PROVIDER_LABELS[option]}
    </option>
  ))}
</select>

// Líneas 721-760: Map Provider - SÍ tiene campo para api_key
{form.map.provider === "maptiler" && (
  <input id="maptiler_api_key" ... />
)}
```

**Resultado:** ❌ La UI de `/config` **NO permite**:
- Seleccionar el proveedor (opensky/aviationstack para flights, aisstream/aishub para ships)
- Configurar credenciales/URLs específicas de cada proveedor

---

## 3. Validación de Esquema Backend

### Estado: ⚠️ PARCIAL

**Hallazgos:**

#### Validación de Provider (`backend/models.py`):

```python
class FlightsLayer(BaseModel):
    provider: Literal["opensky", "custom"] = Field(default="opensky")
    # ✅ Valida que provider sea "opensky" o "custom"
    # ❌ NO valida configuraciones específicas de opensky (username/password)
    # ❌ NO valida configuraciones específicas de aviationstack (base_url/api_key)

class ShipsLayer(BaseModel):
    provider: Literal["ais_generic", "custom"] = Field(default="ais_generic")
    # ✅ Valida que provider sea "ais_generic" o "custom"
    # ❌ NO valida configuraciones específicas de aisstream (ws_url/api_key)
    # ❌ NO valida configuraciones específicas de aishub (base_url/api_key)
```

**Resultado:**
- ⚠️ El backend valida que `provider` sea uno de los valores permitidos en el `Literal`
- ❌ **NO valida** configuraciones específicas de cada proveedor (credenciales, URLs, etc.) porque **no existen campos** en el modelo

**Prueba de validación:**
Si se intenta enviar `layers.flights.provider = "aviationstack"`, el backend rechazará con error de validación Pydantic porque `"aviationstack"` no está en el `Literal["opensky", "custom"]`.

---

## 4. Efecto sobre Endpoints de Datos

### Estado: ❌ NO IMPLEMENTADO

**Hallazgos:**

#### Endpoint Flights (`backend/main.py`, líneas 981-1120):

```python
@app.get("/api/layers/flights")
def get_flights(...):
    config = config_manager.read()
    flights_config = config.layers.flights
    
    # ❌ NO lee flights_config.provider
    # ❌ Siempre usa OpenSkyFlightProvider() sin parámetros
    provider = _get_flights_provider()  # Siempre devuelve OpenSkyFlightProvider()
    data = provider.fetch(bounds=bounds)
```

#### Función Helper (`backend/main.py`, líneas 965-970):

```python
def _get_flights_provider() -> OpenSkyFlightProvider:
    """Obtiene o crea el proveedor de vuelos."""
    global _flights_provider
    if _flights_provider is None:
        _flights_provider = OpenSkyFlightProvider()  # ❌ Siempre crea OpenSky sin parámetros
        # ❌ NO lee config.layers.flights.provider
        # ❌ NO lee config.layers.flights.opensky.auth.username/password
    return _flights_provider
```

#### Endpoint Ships (`backend/main.py`, líneas 1134-1289):

```python
@app.get("/api/layers/ships")
def get_ships(...):
    config = config_manager.read()
    ships_config = config.layers.ships
    
    # ❌ NO lee ships_config.provider
    # ❌ Siempre usa GenericAISProvider(demo_enabled=True) sin parámetros
    provider = _get_ships_provider()  # Siempre devuelve GenericAISProvider()
    data = provider.fetch(bounds=bounds)
```

#### Función Helper (`backend/main.py`, líneas 973-978):

```python
def _get_ships_provider() -> GenericAISProvider:
    """Obtiene o crea el proveedor de barcos."""
    global _ships_provider
    if _ships_provider is None:
        _ships_provider = GenericAISProvider(demo_enabled=True)  # ❌ Siempre crea GenericAIS sin parámetros
        # ❌ NO lee config.layers.ships.provider
        # ❌ NO lee config.layers.ships.aisstream.ws_url/api_key
    return _ships_provider
```

#### Proveedores Disponibles (`backend/layer_providers.py`):

```python
# ✅ OpenSkyFlightProvider existe (líneas 64-153)
class OpenSkyFlightProvider(FlightProvider):
    def __init__(self, username: Optional[str] = None, password: Optional[str] = None):
        # ✅ Acepta username/password pero NO se configuran desde config.json

# ❌ NO existe AviationStackFlightProvider

# ✅ GenericAISProvider existe (líneas 156-243)
class GenericAISProvider(ShipProvider):
    def __init__(self, api_url: Optional[str] = None, api_key: Optional[str] = None, demo_enabled: bool = True):
        # ✅ Acepta api_url/api_key pero NO se configuran desde config.json

# ❌ NO existe AISStreamProvider
# ❌ NO existe AISHubProvider
```

**Resultado:** ❌ Los endpoints **NO**:
- Leen el `provider` desde `config.layers.flights.provider` o `config.layers.ships.provider`
- Crean proveedores diferentes según el valor de `provider`
- Configuran credenciales/URLs desde la configuración

**Comportamiento actual:**
- Flights: siempre usa `OpenSkyFlightProvider()` sin credenciales
- Ships: siempre usa `GenericAISProvider(demo_enabled=True)` que devuelve datos de demo

---

## 5. Health Endpoint

### Estado: ✅ FUNCIONANDO

**Hallazgos:**

#### GET /api/health/full (`backend/main.py`, líneas 161-212):

```python
@app.get("/api/health/full")
def healthcheck_full() -> Dict[str, Any]:
    # ✅ Incluye bloques flights y ships
    payload["flights"] = {
        "status": flights_status,        # ✅ "ok", "degraded", o "down"
        "last_fetch": flights_last_fetch,  # ✅ ISO timestamp o None
        "cache_age": flights_cache_age,   # ✅ Segundos o None
        "items_count": flights_items_count # ✅ Número de features
    }
    
    payload["ships"] = {
        "status": ships_status,
        "last_fetch": ships_last_fetch,
        "cache_age": ships_cache_age,
        "items_count": ships_items_count
    }
```

**Resultado:** ✅ El endpoint de health reporta correctamente el estado de flights y ships, pero **NO** incluye información sobre el proveedor configurado (porque no se lee desde config).

---

## 6. Logs y Permisos

### Estado: ✅ FUNCIONANDO

**Hallazgos:**

El sistema de logs está configurado correctamente:
- ✅ Logs en `/var/log/pantalla/backend.log`
- ✅ Logging de errores en endpoints de flights y ships
- ✅ Permisos de configuración manejados por `ConfigManager`

**No se encontraron problemas** relacionados con permisos o logs.

---

## Resumen de Problemas Encontrados

### Críticos (Bloquean funcionalidad):

1. ❌ **Modelos backend incompletos:**
   - `FlightsLayer.provider` solo acepta `["opensky", "custom"]` (falta `"aviationstack"`)
   - `ShipsLayer.provider` solo acepta `["ais_generic", "custom"]` (faltan `"aisstream"` y `"aishub"`)
   - No existen campos para configurar credenciales/URLs de ningún proveedor

2. ❌ **UI de configuración inexistente:**
   - No hay selector de `provider` en `/config`
   - No hay campos para credenciales/URLs de proveedores

3. ❌ **Endpoints no leen configuración:**
   - `get_flights()` siempre usa `OpenSkyFlightProvider()` sin parámetros
   - `get_ships()` siempre usa `GenericAISProvider(demo_enabled=True)` sin parámetros
   - No se lee `config.layers.flights.provider` ni `config.layers.ships.provider`

4. ❌ **Proveedores faltantes:**
   - No existe `AviationStackFlightProvider`
   - No existe `AISStreamProvider`
   - No existe `AISHubProvider`

### No críticos (Funcionalidad parcial):

- ⚠️ Validación de esquema valida valores permitidos pero no configuraciones de proveedores (porque no existen)

---

## Evidencias de Código

### Backend Models:
**Archivo:** `backend/models.py` (líneas 245-276)
```python
class FlightsLayer(BaseModel):
    provider: Literal["opensky", "custom"] = Field(default="opensky")
    # ❌ Faltan campos: opensky.auth.username, opensky.auth.password
    # ❌ Faltan campos: aviationstack.base_url, aviationstack.api_key

class ShipsLayer(BaseModel):
    provider: Literal["ais_generic", "custom"] = Field(default="ais_generic")
    # ❌ Faltan campos: aisstream.ws_url, aisstream.api_key
    # ❌ Faltan campos: aishub.base_url, aishub.api_key
```

### Default Config:
**Archivo:** `backend/default_config.json` (líneas 115-157)
```json
{
  "layers": {
    "flights": {
      "provider": "opensky",
      // ❌ No hay sub-objeto opensky
      // ❌ No hay sub-objeto aviationstack
    },
    "ships": {
      "provider": "ais_generic",
      // ❌ No hay sub-objeto aisstream
      // ❌ No hay sub-objeto aishub
    }
  }
}
```

### UI ConfigPage:
**Archivo:** `dash-ui/src/pages/ConfigPage.tsx` (líneas 2045-2287)
```tsx
{/* Sección Flights - NO tiene selector de provider */}
<div className="config-field">
  <label>Activar capa de aviones</label>
  <input type="checkbox" ... />
</div>
{/* ❌ Falta selector de provider */}
{/* ❌ Faltan campos para credenciales */}
```

### Endpoint Flights:
**Archivo:** `backend/main.py` (líneas 1022-1025)
```python
# ❌ NO lee config.layers.flights.provider
provider = _get_flights_provider()  # Siempre OpenSkyFlightProvider()
data = provider.fetch(bounds=bounds)
```

---

## Recomendaciones

Para implementar la configuración completa de proveedores, se requiere:

1. **Extender modelos backend:**
   - Agregar `"aviationstack"` a `FlightsLayer.provider`
   - Agregar `"aisstream"` y `"aishub"` a `ShipsLayer.provider`
   - Crear sub-modelos para configuraciones de cada proveedor (OpenSkyAuth, AviationStackConfig, AISStreamConfig, AISHubConfig)

2. **Implementar proveedores faltantes:**
   - Crear `AviationStackFlightProvider`
   - Crear `AISStreamProvider`
   - Crear `AISHubProvider`

3. **Modificar endpoints:**
   - Leer `config.layers.flights.provider` y crear proveedor correspondiente
   - Leer `config.layers.ships.provider` y crear proveedor correspondiente
   - Pasar credenciales/URLs desde config a los proveedores

4. **Agregar UI de configuración:**
   - Selector de `provider` para flights y ships
   - Campos condicionales para credenciales/URLs según el proveedor seleccionado

5. **Actualizar default_config.json:**
   - Agregar sub-objetos de configuración para cada proveedor (aunque vacíos)

---

## Conclusión

**Estado general:** ❌ **NO IMPLEMENTADO**

La configuración de proveedores para Flights y Ships **NO está implementada**. El sistema actual:
- ✅ Tiene campos básicos (`enabled`, `opacity`, `refresh_seconds`, `max_age_seconds`)
- ❌ **NO tiene** selector de proveedor ni campos para credenciales/URLs
- ❌ **NO lee** el proveedor desde config (siempre usa el mismo)
- ❌ **NO implementa** los proveedores esperados (`aviationstack`, `aisstream`, `aishub`)

**Prioridad:** ALTA - Requiere implementación completa de modelos, UI, proveedores y endpoints.

