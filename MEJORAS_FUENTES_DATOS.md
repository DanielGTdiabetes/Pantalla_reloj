# Propuestas de Mejoras - Fuentes de Datos

**Fecha:** 2025-01-XX  
**Ámbito:** Backend - `data_sources.py`, `main.py`, `models.py`

---

## Resumen Ejecutivo

Propuestas de mejoras para incrementar la precisión, funcionalidad y mantenibilidad de las fuentes de datos de santoral, fases lunares, efemérides y siembra/harvest.

---

## 1. 🚀 MEJORAS CRÍTICAS

### 1.1. Precisión de Efemérides (Salida/Puesta de Sol)

**Problema Actual:**
- No considera horario de verano (DST)
- No usa `tz_str` correctamente (no convierte a zona horaria real)
- Algoritmo simplificado con error de ±5-15 minutos dependiendo de la latitud
- No considera elevación del terreno

**Impacto:** Errores significativos en horas de salida/puesta del sol

**Propuesta:**

#### Opción A: Usar librería `astral` (Recomendado)
```python
# requirements.txt
astral>=3.2
pytz>=2023.3  # Ya disponible en Python 3.12+

# data_sources.py
try:
    from astral import LocationInfo
    from astral.sun import sun
    from zoneinfo import ZoneInfo
except ImportError:
    # Fallback al algoritmo simplificado
    pass

def calculate_sun_times(
    lat: float, 
    lng: float, 
    tz_str: str = "Europe/Madrid", 
    dt: Optional[date] = None,
    elevation: float = 0.0  # Nueva opción
) -> Dict[str, str]:
    """Calcula horas de salida y puesta del sol usando astral."""
    if dt is None:
        dt = date.today()
    
    try:
        from astral import LocationInfo
        from astral.sun import sun
        from zoneinfo import ZoneInfo
        
        location = LocationInfo(
            name="Location",
            region="Region",
            timezone=tz_str,
            latitude=lat,
            longitude=lng,
        )
        
        tz = ZoneInfo(tz_str)
        dt_aware = datetime.combine(dt, datetime.min.time()).replace(tzinfo=tz)
        
        s = sun(location.observer, date=dt, tzinfo=tz)
        
        sunrise_str = s["sunrise"].strftime("%H:%M")
        sunset_str = s["sunset"].strftime("%H:%M")
        
        return {
            "sunrise": sunrise_str,
            "sunset": sunset_str,
            "solar_noon": s["noon"].strftime("%H:%M"),
            "dusk": s["dusk"].strftime("%H:%M"),
            "dawn": s["dawn"].strftime("%H:%M"),
        }
    except ImportError:
        # Fallback al algoritmo simplificado actual
        logger.warning("astral no disponible, usando algoritmo simplificado")
        # ... código actual ...
```

**Ventajas:**
- Precisión de ±1 minuto
- Maneja DST automáticamente
- Soporte completo de zonas horarias
- Incluye información adicional (dusk, dawn, solar noon)

**Desventajas:**
- Nueva dependencia (`astral`)
- ~500KB adicional en el sistema

#### Opción B: Mejorar algoritmo simplificado
```python
def calculate_sun_times_improved(...):
    """Versión mejorada sin dependencias externas."""
    import math
    from zoneinfo import ZoneInfo
    
    # Convertir fecha a datetime aware en la zona horaria
    tz = ZoneInfo(tz_str)
    dt_aware = datetime.combine(dt, datetime.min.time()).replace(tzinfo=tz)
    
    # Detectar si está en horario de verano
    is_dst = dt_aware.dst().total_seconds() > 0
    utc_offset_hours = dt_aware.utcoffset().total_seconds() / 3600
    
    # Ajustar cálculos con DST
    # ... algoritmo mejorado ...
```

**Recomendación:** Opción A (usar `astral`)

---

### 1.2. Información Astronómica Ampliada

**Problema Actual:**
- Solo proporciona fase lunar básica y salida/puesta de sol
- No incluye próximas fases lunares
- No calcula duración del día
- No incluye información de crepúsculo

**Propuesta:**
```python
def calculate_extended_astronomy(
    lat: float,
    lng: float,
    tz_str: str = "Europe/Madrid",
    days_ahead: int = 7
) -> Dict[str, Any]:
    """Calcula información astronómica extendida."""
    today = date.today()
    
    # Fase lunar actual
    moon_data = calculate_moon_phase()
    
    # Calcular próximas fases lunares
    next_phases = []
    for i in range(days_ahead):
        future_date = today + timedelta(days=i)
        future_moon = calculate_moon_phase(
            datetime.combine(future_date, datetime.min.time()).replace(tzinfo=timezone.utc)
        )
        next_phases.append({
            "date": future_date.isoformat(),
            "phase": future_moon["moon_phase"],
            "illumination": future_moon["moon_illumination"]
        })
    
    # Duración del día
    sun_data = calculate_sun_times(lat, lng, tz_str, today)
    sunrise = datetime.strptime(sun_data["sunrise"], "%H:%M")
    sunset = datetime.strptime(sun_data["sunset"], "%H:%M")
    day_duration = (sunset - sunrise).total_seconds() / 3600
    
    return {
        "current_moon": moon_data,
        "next_phases": next_phases,
        "day_duration_hours": round(day_duration, 2),
        "sun_data": sun_data,
        # ... más información ...
    }
```

---

## 2. 📈 MEJORAS IMPORTANTES

### 2.1. Santoral Mejorado

**Problema Actual:**
- Datos estáticos limitados
- No incluye información adicional (patrón de, historia)
- Función `include_namedays` no está implementada
- Solo cubre santos principales

**Propuesta:**

#### Opción A: Agregar más información al diccionario
```python
SAINTS_BY_DATE: Dict[str, List[Dict[str, Any]]] = {
    "01-01": [
        {
            "name": "María, Madre de Dios",
            "type": "solemnity",
            "patron_of": ["Madrid", "España"],
            "name_days": ["María", "Mariano", "Mariana"]
        }
    ],
    # ... más entradas con estructura enriquecida ...
}

def get_saints_today_enhanced(
    include_namedays: bool = True,
    locale: str = "es",
    include_info: bool = False
) -> List[Union[str, Dict[str, Any]]]:
    """Versión mejorada con información adicional."""
    today = date.today()
    date_key = f"{today.month:02d}-{today.day:02d}"
    
    saints_raw = SAINTS_BY_DATE.get(date_key, [])
    
    # Si include_info=False, devolver solo nombres (compatibilidad)
    if not include_info:
        saints = [s if isinstance(s, str) else s["name"] for s in saints_raw]
    else:
        saints = saints_raw
    
    # Implementar include_namedays correctamente
    if include_namedays:
        namedays = []
        for saint in saints_raw:
            if isinstance(saint, dict) and "name_days" in saint:
                namedays.extend(saint["name_days"])
        # Agregar namedays a la respuesta
        return {"saints": saints, "namedays": list(set(namedays))}
    
    return saints
```

#### Opción B: Fuente externa opcional
```python
def get_saints_today_with_fallback(
    include_namedays: bool = True,
    locale: str = "es",
    use_api: bool = False
) -> List[str]:
    """Intenta obtener desde API externa, fallback a datos estáticos."""
    if use_api:
        try:
            # API opcional: calendarios litúrgicos públicos
            # Por ejemplo: https://api.liturgical-calendar.com/
            response = requests.get(
                f"https://api.example.com/saints/{date.today().isoformat()}",
                timeout=5
            )
            if response.status_code == 200:
                return response.json()["saints"]
        except Exception:
            logger.warning("API de santos no disponible, usando datos estáticos")
    
    # Fallback a datos estáticos
    return get_saints_today(include_namedays, locale)
```

**Recomendación:** Opción A (enriquecer datos estáticos primero)

---

### 2.2. Harvest/Siembra Mejorado

**Problema Actual:**
- Datos estáticos básicos por mes
- No distingue entre siembra y cosecha
- No considera variedades regionales
- No incluye información de siembra

**Propuesta:**
```python
HARVEST_SEASON_DATA: Dict[int, Dict[str, List[Dict[str, str]]]] = {
    1: {
        "harvest": [  # Cosecha
            {"name": "Naranjas", "status": "Temporada alta", "varieties": ["Navel", "Valencia"]},
            {"name": "Mandarinas", "status": "Temporada alta"},
        ],
        "planting": [  # Siembra
            {"name": "Ajo", "status": "Siembra directa"},
            {"name": "Cebolla", "status": "Semilleros"},
        ],
        "maintenance": [  # Mantenimiento
            {"name": "Poda de árboles frutales", "status": "Temporada"},
        ]
    },
    # ... más meses ...
}

def get_harvest_data_enhanced(
    custom_items: List[Dict[str, str]] = None,
    include_planting: bool = True,
    include_maintenance: bool = False
) -> Dict[str, List[Dict[str, str]]]:
    """Versión mejorada con siembra y mantenimiento."""
    today = date.today()
    month = today.month
    
    month_data = HARVEST_SEASON_DATA.get(month, {})
    
    result = {
        "harvest": month_data.get("harvest", []),
    }
    
    if include_planting:
        result["planting"] = month_data.get("planting", [])
    
    if include_maintenance:
        result["maintenance"] = month_data.get("maintenance", [])
    
    # Agregar items personalizados
    if custom_items:
        result["harvest"].extend(custom_items)
    
    return result
```

**Actualizar endpoint:**
```python
@app.get("/api/calendar")
def get_calendar() -> Dict[str, Any]:
    # ... código existente ...
    
    # Hortalizas estacionales mejoradas
    if harvest_config.enabled:
        try:
            harvest_data = get_harvest_data_enhanced(
                custom_items=harvest_config.custom_items,
                include_planting=True,
                include_maintenance=False
            )
            payload["harvest"] = harvest_data["harvest"]
            payload["planting"] = harvest_data.get("planting", [])
        except Exception as exc:
            logger.warning("Failed to get harvest data: %s", exc)
            payload["harvest"] = []
            payload["planting"] = []
```

---

## 3. 🔧 MEJORAS DE MANTENIMIENTO

### 3.1. Validación y Manejo de Errores

**Propuesta:**
```python
def calculate_sun_times_safe(
    lat: float,
    lng: float,
    tz_str: str = "Europe/Madrid",
    dt: Optional[date] = None
) -> Dict[str, Any]:
    """Versión con validación y manejo de errores mejorado."""
    # Validar coordenadas
    if not (-90 <= lat <= 90):
        raise ValueError(f"Latitud inválida: {lat}")
    if not (-180 <= lng <= 180):
        raise ValueError(f"Longitud inválida: {lng}")
    
    # Validar zona horaria
    try:
        from zoneinfo import ZoneInfo
        ZoneInfo(tz_str)
    except Exception as e:
        logger.warning(f"Zona horaria inválida {tz_str}: {e}, usando Europe/Madrid")
        tz_str = "Europe/Madrid"
    
    try:
        # Intentar cálculo con astral
        return calculate_sun_times_astral(lat, lng, tz_str, dt)
    except ImportError:
        logger.info("astral no disponible, usando algoritmo simplificado")
        return calculate_sun_times_simple(lat, lng, tz_str, dt)
    except Exception as e:
        logger.error(f"Error calculando horas solares: {e}")
        # Devolver valores por defecto razonables
        return {
            "sunrise": "07:00",
            "sunset": "19:00",
            "error": str(e)
        }
```

---

### 3.2. Caché Inteligente

**Propuesta:**
```python
def get_astronomy_with_smart_cache() -> Dict[str, Any]:
    """Caché que se actualiza según el tipo de dato."""
    config = config_manager.read()
    ephemerides_config = config.ephemerides
    
    # Para fase lunar: caché por día (cambia lentamente)
    moon_cache_key = f"moon_{date.today().isoformat()}"
    moon_cached = cache_store.load(moon_cache_key, max_age_minutes=1440)
    
    # Para sol: caché por hora (puede cambiar con DST)
    sun_cache_key = f"sun_{datetime.now().strftime('%Y-%m-%d-%H')}"
    sun_cached = cache_store.load(sun_cache_key, max_age_minutes=60)
    
    # Combinar resultados cacheados o calcular nuevos
    if moon_cached and sun_cached:
        return {
            **moon_cached.payload,
            **sun_cached.payload,
            "cached": True
        }
    
    # ... calcular lo que falte ...
```

---

## 4. 📊 MEJORAS OPCIONALES

### 4.1. Información de Eventos Astronómicos

**Propuesta:**
```python
def get_astronomical_events(
    start_date: date,
    end_date: date,
    lat: float,
    lng: float
) -> List[Dict[str, Any]]:
    """Calcula eventos astronómicos en un rango de fechas."""
    events = []
    current_date = start_date
    
    while current_date <= end_date:
        moon_data = calculate_moon_phase(
            datetime.combine(current_date, datetime.min.time()).replace(tzinfo=timezone.utc)
        )
        
        # Detectar cambios de fase significativos
        if moon_data["moon_phase"] in ["Luna nueva", "Luna llena", "Cuarto creciente", "Cuarto menguante"]:
            events.append({
                "date": current_date.isoformat(),
                "type": "moon_phase",
                "description": moon_data["moon_phase"],
                "illumination": moon_data["moon_illumination"]
            })
        
        current_date += timedelta(days=1)
    
    return events
```

---

### 4.2. Configuración Avanzada de Efemérides

**Propuesta en `models.py`:**
```python
class Ephemerides(BaseModel):
    model_config = ConfigDict(extra="ignore")

    enabled: bool = True
    latitude: float = Field(default=39.986, ge=-90, le=90)
    longitude: float = Field(default=-0.051, ge=-180, le=180)
    timezone: str = Field(default="Europe/Madrid", min_length=1)
    
    # Nuevos campos opcionales
    elevation_meters: float = Field(default=0.0, ge=0, le=9000)  # Elevación del terreno
    include_twilight: bool = Field(default=False)  # Incluir crepúsculos
    include_solar_noon: bool = Field(default=False)  # Incluir mediodía solar
    precision_mode: Literal["simple", "accurate"] = Field(default="simple")  # Modo de precisión
```

---

## 5. 📋 PLAN DE IMPLEMENTACIÓN

### Fase 1: Críticas (Alta Prioridad)
1. ✅ **Mejorar precisión de efemérides** con `astral`
   - Agregar `astral>=3.2` a `requirements.txt`
   - Implementar `calculate_sun_times()` mejorado
   - Mantener fallback al algoritmo simplificado
   - **Tiempo estimado:** 2-3 horas

### Fase 2: Importantes (Media Prioridad)
2. ✅ **Ampliar información astronómica**
   - Implementar `calculate_extended_astronomy()`
   - Agregar duración del día y crepúsculos
   - Actualizar endpoint `/api/astronomy`
   - **Tiempo estimado:** 2-3 horas

3. ✅ **Mejorar datos de harvest**
   - Extender `HARVEST_SEASON_DATA` con siembra
   - Implementar `get_harvest_data_enhanced()`
   - Actualizar endpoint `/api/calendar`
   - **Tiempo estimado:** 3-4 horas

### Fase 3: Opcionales (Baja Prioridad)
4. ✅ **Enriquecer santoral**
   - Agregar estructura enriquecida a `SAINTS_BY_DATE`
   - Implementar `include_namedays` correctamente
   - **Tiempo estimado:** 4-6 horas

5. ✅ **Eventos astronómicos**
   - Implementar `get_astronomical_events()`
   - Agregar endpoint `/api/astronomy/events`
   - **Tiempo estimado:** 2-3 horas

---

## 6. ✅ CRITERIOS DE ACEPTACIÓN

### Mejoras Críticas
- [ ] Precisión de salida/puesta de sol: ±2 minutos o mejor
- [ ] Manejo correcto de DST (horario de verano)
- [ ] Fallback funcional si `astral` no está disponible
- [ ] Tests unitarios para validar cálculos

### Mejoras Importantes
- [ ] Información astronómica extendida disponible en `/api/astronomy`
- [ ] Datos de harvest incluyen siembra y cosecha
- [ ] Validación robusta de parámetros

### Mejoras Opcionales
- [ ] Santoral enriquecido con información adicional
- [ ] Eventos astronómicos calculables por rango de fechas

---

## 7. 📝 NOTAS ADICIONALES

### Dependencias Propuestas
```txt
# requirements.txt (nuevas dependencias)
astral>=3.2  # Para cálculos astronómicos precisos
```

### Compatibilidad
- Todas las mejoras deben mantener retrocompatibilidad
- Fallbacks deben funcionar si las dependencias opcionales no están disponibles
- Validación de configuración debe ser clara y reportar errores útiles

### Rendimiento
- Cálculos astronómicos deben ser rápidos (<100ms)
- Caché debe reducir recálculos innecesarios
- No debe impactar negativamente el tiempo de respuesta de los endpoints

---

**Fin del documento**

