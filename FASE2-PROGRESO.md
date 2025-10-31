# Progreso de Implementación Fase 2

## ✅ COMPLETADO

### 1. Base de Configuración
- ✅ Modelos en `backend/models.py`:
  - `StormMode`: Configuración para modo tormenta (zoom, center, auto-enable)
  - `AEMET`: Configuración para integración AEMET (API key, capas)
  - `Blitzortung`: Configuración para MQTT/WebSocket de rayos
- ✅ Tipos TypeScript en `dash-ui/src/types/config.ts`
- ✅ Valores por defecto en `backend/default_config.json`
- ✅ Funciones de merge y defaults en `dash-ui/src/config/defaults.ts`

### 2. Infraestructura Existente
- ✅ Overlay Rotatorio completamente funcional
- ✅ LightningLayer implementado (necesita datos)
- ✅ GeoScopeMap base funcionando
- ✅ Sistema de capas (LayerRegistry) funcionando

## ⏳ EN PROGRESO / PENDIENTE

### 1. Modo Tormenta Completo
- [ ] Lógica de activación en `GeoScopeMap`
- [ ] Zoom automático a Castellón/Vila-real cuando se activa
- [ ] Integración de LightningLayer en GeoScopeMap
- [ ] Endpoint backend funcional (actualmente ignorado)
- [ ] UI para activar/desactivar desde `/config`
- [ ] Auto-activación basada en rayos (si configurado)

### 2. AEMET Completo
- [ ] Backend endpoints:
  - [ ] `/api/aemet/cap` - Avisos CAP (GeoJSON)
  - [ ] `/api/aemet/radar` - Radar precipitación
  - [ ] `/api/aemet/satellite` - Satélite (opcional)
- [ ] Proxy backend con caché local
- [ ] Frontend layers:
  - [ ] `CAPLayer` - GeoJSON de avisos
  - [ ] `RadarLayer` - Tiles animados de radar
  - [ ] `SatelliteLayer` - Tiles animados de satélite
- [ ] Controles UI (play/pause, velocidad, opacidad)
- [ ] Integración en GeoScopeMap
- [ ] UI en `/config` para configurar AEMET

### 3. Blitzortung + MQTT
- [ ] Cliente MQTT/WebSocket en backend
- [ ] Endpoint `/api/lightning` para datos de rayos
- [ ] Integración con LightningLayer para actualizar datos en tiempo real
- [ ] Servicio systemd para cliente MQTT/WebSocket
- [ ] Scripts de instalación/configuración

## PRÓXIMOS PASOS RECOMENDADOS

1. **Implementar Modo Tormenta**: Es la funcionalidad más prioritaria y relativamente simple
2. **Integrar LightningLayer en GeoScopeMap**: Conectar la capa existente
3. **Backend MQTT simple**: Para recibir datos de rayos
4. **AEMET backend**: Proxy con caché (más complejo, puede dejarse para después)

## NOTAS

- Los modelos están listos y validados
- La configuración se guardará y cargará correctamente
- Falta la lógica de negocio para usar estas configuraciones
- LightningLayer existe pero no está integrado en GeoScopeMap

