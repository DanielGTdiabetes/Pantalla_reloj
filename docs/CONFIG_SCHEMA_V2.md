# Esquema de Configuración V2

Este documento describe el esquema de configuración V2 completo de Pantalla Reloj, incluyendo todos los bloques y valores por defecto.

## Estructura General

```json
{
  "version": 2,
  "display": { ... },
  "ui_map": { ... },
  "ui_global": { ... },
  "layers": { ... },
  "panels": { ... },
  "secrets": { ... },
  "storm": { ... },
  "blitzortung": { ... },
  "news": { ... },
  "ephemerides": { ... },
  "opensky": { ... },
  "ais": { ... }
}
```

## 1. Display (`display`)

Configuración de visualización general.

```json
{
  "display": {
    "timezone": "Europe/Madrid",
    "module_cycle_seconds": 20
  }
}
```

### Campos

- **`timezone`** (string, default: `"Europe/Madrid"`): Zona horaria del sistema.
- **`module_cycle_seconds`** (int, default: `20`, range: 1-300): Duración en segundos del ciclo de rotación de paneles.

## 2. UI Map (`ui_map`)

Configuración del mapa principal.

```json
{
  "ui_map": {
    "engine": "maplibre",
    "provider": "maptiler_vector",
    "renderWorldCopies": true,
    "interactive": false,
    "controls": false,
    "maptiler": {
      "style": "streets-v2",
      "urls": {
        "styleUrlDark": null,
        "styleUrlLight": null,
        "styleUrlBright": null
      }
    },
    "viewMode": "fixed",
    "fixed": {
      "center": { "lat": 40.4168, "lon": -3.7038 },
      "zoom": 6,
      "bearing": 0,
      "pitch": 0
    }
  }
}
```

### Campos

- **`engine`** (literal: `"maplibre"`): Motor de renderizado del mapa.
- **`provider`** (literal: `"maptiler_vector" | "local_raster_xyz" | "custom_xyz"`): Proveedor de tiles.
- **`renderWorldCopies`** (bool, default: `true`): Renderizar copias del mundo.
- **`interactive`** (bool, default: `false`): Permitir interacción con el mapa.
- **`controls`** (bool, default: `false`): Mostrar controles de navegación.
- **`maptiler.style`** (string, optional): Estilo MapTiler v2 (`"streets-v2"`, `"bright-v2"`, `"dataviz-dark"`).
- **`viewMode`** (literal: `"fixed" | "aoiCycle"`): Modo de visualización.
- **`fixed.center`** (object): Coordenadas del centro del mapa (`lat`, `lon`).

## 3. UI Global (`ui_global`)

Configuración de capas globales y overlays.

```json
{
  "ui_global": {
    "satellite": {
      "enabled": true,
      "provider": "gibs",
      "opacity": 1.0,
      "refresh_minutes": 10,
      "frame_step": 1
    },
    "radar": {
      "enabled": true,
      "provider": "rainviewer",
      "opacity": 0.7,
      "refresh_minutes": 10,
      "frame_step": 1,
      "layer": "precipitation_new"
    },
    "overlay": {
      "enabled": true,
      "panels": ["clock", "weather", "astronomy", "santoral", "calendar", "news", "historicalEvents", "forecast", "moon", "harvest"],
      "order": ["clock", "weather", "astronomy", "santoral", "calendar", "news", "historicalEvents", "forecast", "moon", "harvest"],
      "cycle_seconds": 20
    }
  }
}
```

### Campos

- **`satellite.enabled`** (bool, default: `true`): Habilitar capa de satélite (GIBS).
- **`satellite.opacity`** (float, default: `1.0`, range: 0.0-1.0): Opacidad de la capa.
- **`satellite.refresh_minutes`** (int, default: `10`): Intervalo de actualización en minutos.
- **`satellite.frame_step`** (int, default: `1`): Paso de frames para animación.
- **`radar.enabled`** (bool, default: `true`): Habilitar capa de radar (RainViewer).
- **`radar.opacity`** (float, default: `0.7`, range: 0.0-1.0): Opacidad de la capa.
- **`radar.layer`** (string, default: `"precipitation_new"`): Capa de precipitación.
- **`overlay.enabled`** (bool, default: `true`): Habilitar overlay de paneles.
- **`overlay.order`** (array): Orden de rotación de paneles.

## 4. Layers (`layers`)

Configuración de capas de datos (vuelos, barcos, rayos).

```json
{
  "layers": {
    "flights": {
      "enabled": false,
      "provider": "opensky",
      "refresh_seconds": 12,
      "max_age_seconds": 120,
      "max_items_global": 2000,
      "max_items_view": 1500,
      "rate_limit_per_min": 6,
      "decimate": "none"
    },
    "ships": {
      "enabled": false,
      "provider": "aisstream",
      "refresh_seconds": 10,
      "max_age_seconds": 300,
      "max_items_global": 5000,
      "max_items_view": 3000,
      "rate_limit_per_min": 4,
      "decimate": "grid",
      "grid_px": 24
    },
    "lightning": {
      "enabled": false,
      "provider": "blitzortung",
      "max_age_seconds": 3600,
      "decay_enabled": true,
      "decay_seconds": 1800
    }
  }
}
```

### Campos

- **`flights.enabled`** (bool, default: `false`): Habilitar capa de vuelos.
- **`flights.provider`** (literal: `"opensky" | "aviationstack" | "custom"`): Proveedor de datos de vuelos.
- **`flights.refresh_seconds`** (int, default: `12`): Intervalo de actualización en segundos.
- **`ships.enabled`** (bool, default: `false`): Habilitar capa de barcos.
- **`ships.provider`** (literal: `"aisstream" | "aishub" | "ais_generic" | "custom"`): Proveedor de datos AIS.
- **`lightning.enabled`** (bool, default: `false`): Habilitar capa de rayos.
- **`lightning.provider`** (literal: `"blitzortung"`): Proveedor de datos de rayos.
- **`lightning.max_age_seconds`** (int, default: `3600`): Edad máxima de rayos en segundos.
- **`lightning.decay_enabled`** (bool, default: `true`): Habilitar decay temporal visual.
- **`lightning.decay_seconds`** (int, default: `1800`): Duración del decay en segundos.

## 5. Panels (`panels`)

Configuración de paneles del overlay rotativo.

```json
{
  "panels": {
    "news": {
      "enabled": true,
      "feeds": [],
      "max_items_per_feed": 5,
      "refresh_minutes": 30
    },
    "calendar": {
      "enabled": true,
      "source": "ics",
      "days_ahead": 14,
      "ics": {
        "stored_path": null,
        "max_events": 50,
        "days_ahead": 14
      }
    },
    "historicalEvents": {
      "enabled": true,
      "provider": "local",
      "language": "es",
      "cache_hours": 24
    }
  }
}
```

### Campos

- **`news.enabled`** (bool, default: `true`): Habilitar panel de noticias.
- **`news.feeds`** (array, default: `[]`): Lista de feeds RSS.
- **`news.max_items_per_feed`** (int, default: `5`): Máximo de items por feed.
- **`news.refresh_minutes`** (int, default: `30`): Intervalo de actualización en minutos.
- **`calendar.enabled`** (bool, default: `true`): Habilitar panel de calendario.
- **`calendar.source`** (literal: `"ics" | "google"`): Fuente del calendario.
- **`calendar.days_ahead`** (int, default: `14`, range: 1-90): Días hacia adelante.
- **`historicalEvents.enabled`** (bool, default: `true`): Habilitar efemérides históricas.
- **`historicalEvents.provider`** (literal: `"local" | "wikimedia"`): Proveedor de efemérides.
- **`historicalEvents.language`** (string, default: `"es"`): Idioma de las efemérides.
- **`historicalEvents.cache_hours`** (int, default: `24`): Horas de cache.

## 6. Secrets (`secrets`)

Metadatos de secretos (sin valores reales en el JSON).

```json
{
  "secrets": {
    "maptiler": {
      "has_api_key": false,
      "api_key_last4": null
    },
    "opensky": {
      "oauth2": {
        "has_client_id": false,
        "has_client_secret": false,
        "token_url": "https://auth.opensky-network.org/oauth/token",
        "scope": null
      },
      "basic": {
        "has_username": false,
        "has_password": false
      }
    },
    "aemet": {
      "has_api_key": false,
      "api_key_last4": null
    },
    "aisstream": {
      "has_api_key": false,
      "api_key_last4": null
    },
    "aishub": {
      "has_api_key": false,
      "api_key_last4": null
    }
  }
}
```

### Nota

Los valores reales de secretos **nunca** se exponen en `/api/config`. Solo se muestran metadatos como `has_api_key` y `api_key_last4`.

## 7. Storm Mode (`storm`)

Configuración del modo tormenta.

```json
{
  "storm": {
    "enabled": false,
    "auto_enable": false,
    "threshold_km": 50,
    "radius_km": 100,
    "auto_disable_after_minutes": 60
  }
}
```

### Campos

- **`storm.enabled`** (bool, default: `false`): Habilitar modo tormenta manual.
- **`storm.auto_enable`** (bool, default: `false`): Habilitar activación automática.
- **`storm.threshold_km`** (int, default: `50`): Umbral de rayos para activación (km).
- **`storm.radius_km`** (int, default: `100`): Radio de detección (km).

## 8. Blitzortung (`blitzortung`)

Configuración de Blitzortung (rayos por MQTT).

```json
{
  "blitzortung": {
    "mqtt_host": "127.0.0.1",
    "mqtt_port": 1883,
    "mqtt_topic": "blitzortung/1",
    "auto_storm_mode": {
      "enabled": false,
      "threshold_count": 5,
      "radius_km": 50
    }
  }
}
```

### Campos

- **`blitzortung.mqtt_host`** (string, default: `"127.0.0.1"`): Host MQTT.
- **`blitzortung.mqtt_port`** (int, default: `1883`): Puerto MQTT.
- **`blitzortung.mqtt_topic`** (string, default: `"blitzortung/1"`): Tópico MQTT.
- **`blitzortung.auto_storm_mode.enabled`** (bool, default: `false`): Habilitar auto-activación de modo tormenta.
- **`blitzortung.auto_storm_mode.threshold_count`** (int, default: `5`): Número mínimo de rayos para activar.
- **`blitzortung.auto_storm_mode.radius_km`** (int, default: `50`): Radio de detección (km).

## 9. News (`news`)

Configuración global de noticias (top-level).

```json
{
  "news": {
    "feeds": [],
    "max_items_per_feed": 5,
    "refresh_minutes": 30
  }
}
```

## 10. Ephemerides (`ephemerides`)

Configuración global de efemérides (top-level).

```json
{
  "ephemerides": {
    "provider": "local",
    "data_path": "/opt/pantalla-reloj/backend/data/efemerides.json",
    "language": "es"
  }
}
```

## 11. OpenSky (`opensky`)

Configuración global de OpenSky (top-level).

```json
{
  "opensky": {
    "auth_method": "oauth2",
    "rate_limit_per_min": 6
  }
}
```

## 12. AIS (`ais`)

Configuración global de AIS (top-level).

```json
{
  "ais": {
    "provider": "aisstream",
    "rate_limit_per_min": 4
  }
}
```

## Valores por Defecto Completos

Ver `backend/default_config_v2.json` para el esquema completo con todos los valores por defecto.

## Migración desde V1

El sistema migra automáticamente desde V1 a V2 al cargar la configuración. Los cambios principales:

- `ui.map` → `ui_map`
- `ui.cinema` → `ui_global.cinema`
- `maptiler` → `ui_map.maptiler` + `secrets.maptiler`
- `aemet` → `panels.weather.aemet` + `secrets.aemet`
- `calendar` → `panels.calendar`
- `news` → `panels.news` + top-level `news`
- `storm` → `storm` + `blitzortung.auto_storm_mode`

## Notas Importantes

1. **AEMET es opcional**: El sistema funciona sin AEMET. Si se mantiene, va bajo `panels.weather.aemet` y `secrets.aemet.api_key`.
2. **Deep-merge en PATCH**: Al usar `PATCH /api/config/group/{group_name}`, se hace deep-merge. No se borran claves fuera del sub-árbol editado.
3. **Secrets nunca expuestos**: Los valores reales de secretos nunca se devuelven en `/api/config`. Solo metadatos.
4. **MapTiler v2**: Los estilos deben usar nombres v2: `streets-v2`, `bright-v2`, `dataviz-dark`.

