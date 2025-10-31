# Estado de Implementación Fase 2

## ✅ COMPLETADO / EXISTENTE

### 1. Overlay Rotatorio Único
- ✅ `OverlayRotator.tsx` implementado completamente
- ✅ Secciones: hora/fecha, clima, predicción (weather), luna, frutas/verduras (harvest), efemérides, noticias, calendar
- ✅ Transiciones suaves con `RotatingCard`
- ✅ Orden y tiempos configurables desde `/config`
- ✅ Rotación automática funcionando

### 2. GeoScope Global (WebGL)
- ✅ `GeoScopeMap.tsx` implementado con MapLibre GL
- ✅ Modo cine implementado completamente
- ✅ Layers base: AircraftLayer, CyclonesLayer, ShipsLayer, WeatherLayer
- ✅ LayerRegistry para gestión de capas
- ⚠️ **Verificar**: Asegurar que no hay recortes visuales

### 3. LightningLayer (Infraestructura)
- ✅ `LightningLayer.ts` existe y funciona
- ⚠️ **Falta**: Conexión a datos MQTT/Blitzortung
- ⚠️ **Falta**: Integración en GeoScopeMap

### 4. Storm Mode (Básico)
- ✅ Endpoints `/api/storm_mode` (GET/POST) existen
- ❌ **Falta**: Implementación funcional (actualmente ignorado)
- ❌ **Falta**: Activación automática
- ❌ **Falta**: Zoom a Castellón/Vila-real
- ❌ **Falta**: Integración con rayos

## ❌ FALTA IMPLEMENTAR

### 1. Modo Tormenta Completo
- [ ] Modelo de configuración para storm mode
- [ ] Lógica de activación automática/manual
- [ ] Zoom automático a Castellón/Vila-real (39.986°N, -0.051°W)
- [ ] Integración con LightningLayer cuando está activo
- [ ] Endpoints backend funcionales (no ignorados)
- [ ] UI para activar/desactivar storm mode
- [ ] Persistencia de estado

### 2. AEMET (Completamente Falta)
- [ ] Modelo de configuración para AEMET
- [ ] Backend endpoints para:
  - [ ] Avisos CAP (GeoJSON)
  - [ ] Radar precipitación (tiles animados)
  - [ ] Satélite (tiles animados, opcional)
- [ ] Proxy backend con caché local
- [ ] Frontend layers:
  - [ ] CAPLayer (GeoJSON)
  - [ ] RadarLayer (tiles animados)
  - [ ] SatelliteLayer (tiles animados)
- [ ] Controles UI (play/pause, velocidad, opacidad)
- [ ] Integración en GeoScopeMap
- [ ] En Modo Cine: mantener radar/satélite; atenuar CAP
- [ ] Configuración en `/config`

### 3. Blitzortung + MQTT
- [ ] Cliente MQTT/WebSocket (`/opt/blitzortung/ws_client`)
- [ ] Publicación en topic `blitzortung/1`
- [ ] Servicio systemd con autorestart y reconexión
- [ ] Integración en LightningLayer para actualizar datos
- [ ] Backend endpoint para datos de rayos (o WebSocket directo)
- [ ] Configuración MQTT en modelos

### 4. Actualizaciones de Configuración
- [ ] Agregar `storm` al modelo `AppConfig`
- [ ] Agregar `aemet` al modelo `AppConfig`
- [ ] Agregar `blitzortung` o `mqtt` al modelo `AppConfig`
- [ ] Actualizar `default_config.json`
- [ ] UI en `/config` para configurar:
  - [ ] Storm mode (enable, zoom, center)
  - [ ] AEMET (enable, API endpoints/config)
  - [ ] MQTT/Blitzortung (host, port, topic)

## PLAN DE IMPLEMENTACIÓN

### Prioridad 1: Base de Configuración
1. Actualizar modelos (`backend/models.py`)
2. Actualizar `default_config.json`
3. Actualizar tipos TypeScript

### Prioridad 2: Modo Tormenta
1. Implementar lógica de activación
2. Zoom automático a Castellón/Vila-real
3. Integrar LightningLayer en GeoScopeMap
4. Conectar a datos MQTT (si MQTT está listo)

### Prioridad 3: AEMET
1. Backend endpoints con proxy y caché
2. Frontend layers (CAP, Radar, Satélite)
3. Controles UI
4. Integración en GeoScopeMap

### Prioridad 4: Blitzortung/MQTT
1. Cliente WebSocket/MQTT
2. Servicio systemd
3. Integración con LightningLayer

## NOTAS

- Castellón/Vila-real: ~39.986°N, -0.051°W
- AEMET requiere API key o acceso a endpoints públicos
- Blitzortung WebSocket endpoint: `wss://live.blitzortung.org/CometServer`
- MQTT broker local: `mosquitto` en loopback (127.0.0.1)

