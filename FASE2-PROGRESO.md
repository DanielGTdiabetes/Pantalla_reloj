# Progreso de Implementación Fase 2

**⚠️ ACTUALIZACIÓN 2025-01:** Este documento describe el progreso de la Fase 2. Infraestructura base completada, funcionalidades avanzadas pendientes.

---

## ✅ COMPLETADO

### 1. Base de Configuración
- ✅ Modelos en `backend/models.py`:
  - ✅ `StormMode`: Configuración para modo tormenta (zoom, center, auto-enable)
  - ✅ `AEMET`: Configuración para integración AEMET (API key, capas)
  - ✅ `Blitzortung`: Configuración para MQTT/WebSocket de rayos
- ✅ Tipos TypeScript en `dash-ui/src/types/config.ts`
- ✅ Valores por defecto en `backend/default_config.json`
- ✅ Funciones de merge y defaults en `dash-ui/src/config/defaults.ts`

### 2. Infraestructura Existente
- ✅ Overlay Rotatorio completamente funcional
- ✅ LightningLayer implementado (necesita datos MQTT/WebSocket)
- ✅ GeoScopeMap base funcionando
- ✅ Sistema de capas (LayerRegistry) funcionando
- ✅ Verificación WebGL con fallback visual implementado

### 3. Integración AEMET (Parcial)
- ✅ Integración con CAP (avisos) en `focus_masks.py`
- ✅ Procesamiento de máscaras de foco con datos CAP
- ✅ Soporte para RainViewer para datos de radar (AEMET no proporciona tiles)
- ⚠️ Endpoints específicos `/api/aemet/*` pendientes

## ⏳ EN PROGRESO / PENDIENTE

### 1. Modo Tormenta Completo
- ⏳ Lógica de activación en `GeoScopeMap`
- ⏳ Zoom automático a Castellón/Vila-real cuando se activa
- ⏳ Integración de LightningLayer en GeoScopeMap (capa existe pero necesita datos)
- ⏳ Endpoint backend funcional completo (actualmente básico)
- ⏳ UI para activar/desactivar desde `/config`
- ⏳ Auto-activación basada en rayos (si configurado)

### 2. AEMET Completo
- ⏳ Backend endpoints específicos:
  - ⏳ `/api/aemet/cap` - Avisos CAP (GeoJSON) - Parcialmente implementado
  - ⏳ `/api/aemet/radar` - Radar precipitación (no disponible en AEMET OpenData)
  - ⏳ `/api/aemet/satellite` - Satélite (no disponible en AEMET OpenData)
- ✅ Proxy backend con caché local (implementado vía `focus_masks.py`)
- ⏳ Frontend layers específicos:
  - ⏳ `CAPLayer` - GeoJSON de avisos (parcialmente integrado en `cine_focus`)
  - ⏳ `RadarLayer` - Tiles animados de radar (usar RainViewer)
  - ⏳ `SatelliteLayer` - Tiles animados de satélite (no disponible en AEMET)
- ⏳ Controles UI (play/pause, velocidad, opacidad)
- ⏳ Integración completa en GeoScopeMap
- ⏳ UI en `/config` para configurar AEMET

**Nota:** AEMET OpenData no proporciona tiles de radar/satélite. Solo CAP 1.2 para avisos. Para radar, usar RainViewer (ya implementado en `focus_masks.py`).

### 3. Blitzortung + MQTT
- ⏳ Cliente MQTT/WebSocket en backend
- ⏳ Endpoint `/api/lightning` para datos de rayos
- ⏳ Integración con LightningLayer para actualizar datos en tiempo real
- ⏳ Servicio systemd para cliente MQTT/WebSocket
- ⏳ Scripts de instalación/configuración

## 📋 PRÓXIMOS PASOS RECOMENDADOS

1. **Implementar Modo Tormenta Completo**: Es la funcionalidad más prioritaria y relativamente simple
2. **Integrar LightningLayer en GeoScopeMap**: Conectar la capa existente cuando haya datos
3. **Backend MQTT simple**: Para recibir datos de rayos desde Blitzortung
4. **AEMET backend completo**: Endpoints específicos y UI (más complejo, puede dejarse para después)

## 📝 NOTAS

- ✅ Los modelos están listos y validados
- ✅ La configuración se guardará y cargará correctamente
- ⏳ Falta la lógica de negocio completa para usar estas configuraciones en algunos casos
- ⏳ LightningLayer existe pero no está completamente integrado en GeoScopeMap (necesita datos)
- ⏳ AEMET integración parcial vía `focus_masks.py` para CAP, pero endpoints específicos pendientes

---

**Estado:** ⏳ **FASE 2 PARCIALMENTE IMPLEMENTADA**

Infraestructura base completa. Funcionalidades avanzadas pendientes de implementación.
