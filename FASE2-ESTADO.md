# Estado de Implementación Fase 2

**⚠️ ACTUALIZACIÓN 2025-01:** Este documento describe el estado de la Fase 2. Algunas funcionalidades están implementadas, otras están pendientes o en fase de planificación.

---

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
- ✅ Verificación WebGL con fallback visual implementado
- ✅ **Verificado:** No hay recortes visuales

### 3. LightningLayer (Infraestructura)
- ✅ `LightningLayer.ts` existe y funciona
- ⚠️ **Pendiente**: Conexión a datos MQTT/Blitzortung
- ⚠️ **Pendiente**: Integración en GeoScopeMap (capa existe pero necesita datos)

### 4. Storm Mode (Básico)
- ✅ Endpoints `/api/storm_mode` (GET/POST) existen
- ⚠️ **Pendiente**: Implementación funcional completa
- ⚠️ **Pendiente**: Activación automática
- ⚠️ **Pendiente**: Zoom a Castellón/Vila-real
- ⚠️ **Pendiente**: Integración con rayos

## ⏳ PENDIENTE DE IMPLEMENTAR

### 1. Modo Tormenta Completo
- ⏳ Modelo de configuración para storm mode (existe pero funcionalidad limitada)
- ⏳ Lógica de activación automática/manual
- ⏳ Zoom automático a Castellón/Vila-real (39.986°N, -0.051°W)
- ⏳ Integración con LightningLayer cuando está activo
- ⏳ Endpoints backend funcionales (actualmente solo básicos)
- ⏳ UI para activar/desactivar storm mode
- ⏳ Persistencia de estado

### 2. AEMET (Parcialmente Implementado)
- ✅ Modelo de configuración para AEMET existe en `backend/models.py`
- ✅ Integración con CAP (avisos) implementada en `focus_masks.py`
- ✅ Procesamiento de máscaras de foco con datos CAP
- ⏳ Backend endpoints específicos para AEMET:
  - ⏳ `/api/aemet/cap` - Avisos CAP (GeoJSON) - Parcialmente implementado vía `focus_masks.py`
  - ⏳ `/api/aemet/radar` - Radar precipitación (no disponible en AEMET OpenData)
  - ⏳ `/api/aemet/satellite` - Satélite (no disponible en AEMET OpenData)
- ✅ Proxy backend con caché local (implementado vía `focus_masks.py`)
- ⏳ Frontend layers específicos para AEMET (actualmente integrado en `cine_focus`)
- ⏳ Controles UI (play/pause, velocidad, opacidad) para tiles animados
- ⏳ Integración completa en GeoScopeMap
- ⏳ UI en `/config` para configurar AEMET

**Nota:** AEMET OpenData no proporciona tiles de radar/satélite en su API pública estándar. Solo proporciona avisos CAP 1.2. Para datos de radar, el sistema usa RainViewer.

### 3. Blitzortung + MQTT
- ⏳ Cliente MQTT/WebSocket en backend
- ⏳ Endpoint `/api/lightning` para datos de rayos
- ⏳ Integración con LightningLayer para actualizar datos en tiempo real
- ⏳ Servicio systemd para cliente MQTT/WebSocket
- ⏳ Scripts de instalación/configuración

### 4. Actualizaciones de Configuración
- ✅ Modelos de configuración existentes en `backend/models.py`:
  - ✅ `StormMode`: Configuración para modo tormenta (zoom, center, auto-enable)
  - ✅ `AEMET`: Configuración para integración AEMET (API key, capas)
  - ✅ `Blitzortung`: Configuración para MQTT/WebSocket de rayos
- ✅ Valores por defecto en `backend/default_config.json`
- ✅ Tipos TypeScript en `dash-ui/src/types/config.ts`
- ✅ Funciones de merge y defaults en `dash-ui/src/config/defaults.ts`
- ⏳ UI en `/config` para configurar:
  - ⏳ Storm mode (enable, zoom, center)
  - ⏳ AEMET (enable, API endpoints/config)
  - ⏳ MQTT/Blitzortung (host, port, topic)

## 📝 NOTAS

- **Castellón/Vila-real:** ~39.986°N, -0.051°W
- **AEMET:** Requiere API key o acceso a endpoints públicos (CAP disponible, radar no)
- **Blitzortung WebSocket endpoint:** `wss://live.blitzortung.org/CometServer`
- **MQTT broker local:** `mosquitto` en loopback (127.0.0.1) - si se implementa

---

**Estado:** ⏳ **FASE 2 PARCIALMENTE IMPLEMENTADA**

Infraestructura base completa. Funcionalidades avanzadas (Storm Mode completo, Blitzortung/MQTT, AEMET completo) pendientes.
