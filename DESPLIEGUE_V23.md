# Guía de Despliegue v23

## Resumen de cambios v23

### Nuevas funcionalidades implementadas

1. **Cliente MQTT/WebSocket para Blitzortung**
   - Servicio backend para recibir datos de rayos en tiempo real
   - Soporte para MQTT y WebSocket
   - Filtrado por bounding box
   - Limpieza automática de rayos antiguos

2. **Controles UI para radar animado**
   - Play/pause de animación
   - Control de velocidad (0.1x - 5.0x)
   - Control de opacidad (0% - 100%)
   - Interfaz visual con blur y transparencias

3. **Endpoint `/api/storm/local`**
   - Resumen de rayos + radar + avisos CAP en bbox local (Castellón por defecto)
   - Filtrado inteligente de avisos AEMET por bounding box

4. **Script de verificación de arranque**
   - Verificación completa de servicios systemd
   - Validación de lectura/escritura de config.json
   - Verificación de timezone y calendar

## Pasos de despliegue

### 1. Actualizar dependencias del backend

```bash
cd /home/dani/proyectos/Pantalla_reloj
cd backend
source .venv/bin/activate  # Si usas venv
pip install -r requirements.txt
```

**Nuevas dependencias añadidas:**
- `paho-mqtt>=1.6.0`
- `websocket-client>=1.6.0`

### 2. Verificar configuración v2

El archivo `backend/default_config_v2.json` ha sido actualizado con:

```json
{
  "display": {
    "timezone": "Europe/Madrid"
  },
  "ui_map": {
    "labelsOverlay": {
      "enabled": true,
      "style": "carto-only-labels"
    },
    ...
  },
  "secrets": {
    "google": {
      "api_key": null,
      "calendar_id": null
    },
    "aemet": {
      "api_key": null
    },
    "ics": {
      "url": null,
      "path": null
    }
  }
}
```

### 3. Configurar Blitzortung (opcional)

Si quieres usar detección de rayos en tiempo real, añade a `config.json`:

```json
{
  "blitzortung": {
    "enabled": true,
    "mqtt_host": "127.0.0.1",
    "mqtt_port": 1883,
    "mqtt_topic": "blitzortung/1",
    "ws_enabled": false,
    "ws_url": null
  }
}
```

**Nota:** Necesitas tener un servidor MQTT (ej: Mosquitto) o un endpoint WebSocket de Blitzortung configurado.

### 4. Reiniciar servicios

```bash
# Reiniciar backend para cargar nuevas dependencias
sudo systemctl restart pantalla-dash-backend@dani.service

# Esperar a que esté listo
sleep 5

# Verificar que el backend responde
curl -s http://127.0.0.1:8081/api/health | python3 -m json.tool
```

### 5. Verificar instalación completa

Ejecuta el script de verificación de arranque:

```bash
cd /home/dani/proyectos/Pantalla_reloj
chmod +x scripts/verify_startup.sh
sudo bash scripts/verify_startup.sh dani
```

**Verificaciones incluidas:**
- ✅ Xorg (`pantalla-xorg.service`)
- ✅ Openbox (`pantalla-openbox@dani.service`)
- ✅ Kiosk Browser (`pantalla-kiosk-chrome@dani.service` como principal, `pantalla-kiosk@dani.service` legacy)
- ✅ Nginx
- ✅ Backend (`pantalla-dash-backend@dani.service`)
- ✅ MQTT/Mosquitto (opcional)
- ✅ Lectura/escritura de `config.json`
- ✅ Verificación de timezone en `/api/health` y `/api/calendar/events`

### 6. Probar nuevas funcionalidades

#### Controles de radar animado

1. Habilita el radar en la configuración:
   ```json
   {
     "ui_global": {
       "radar": {
         "enabled": true,
         "provider": "rainviewer"
       }
     }
   }
   ```

2. Los controles aparecerán automáticamente en la esquina inferior izquierda del mapa cuando el radar esté habilitado.

#### Endpoint `/api/storm/local`

```bash
# Resumen de rayos + radar + avisos CAP en Castellón (bbox por defecto)
curl -s http://127.0.0.1:8081/api/storm/local | python3 -m json.tool

# Con bbox personalizado
curl -s "http://127.0.0.1:8081/api/storm/local?min_lat=39.5&max_lat=40.2&min_lon=-1.2&max_lon=0.5" | python3 -m json.tool
```

#### Endpoint `/api/lightning` (si Blitzortung está configurado)

```bash
# Todos los rayos
curl -s http://127.0.0.1:8081/api/lightning | python3 -m json.tool

# Rayos en bbox específico (Castellón)
curl -s "http://127.0.0.1:8081/api/lightning?bbox=39.5,40.2,-1.2,0.5" | python3 -m json.tool
```

## Verificación post-despliegue

### Smoke test v23

```bash
cd /home/dani/proyectos/Pantalla_reloj
bash scripts/smoke_v23.sh dani
```

Este test verifica:
1. Health endpoint (HTTP 200)
2. Subida de archivo ICS
3. Activación de layers
4. Eventos de calendario
5. Calendar status
6. Weather now/weekly
7. Ephemerides/Saints
8. Overlay config

### Verificación de servicios

```bash
# Estado de servicios
sudo systemctl status pantalla-dash-backend@dani.service
sudo systemctl status pantalla-kiosk-chrome@dani.service
sudo systemctl status nginx

# Logs del backend
journalctl -u pantalla-dash-backend@dani.service -n 100 --no-pager
```

## Troubleshooting

### Backend no inicia después de actualizar dependencias

```bash
# Verificar que las dependencias se instalaron correctamente
cd /home/dani/proyectos/Pantalla_reloj/backend
source .venv/bin/activate
pip list | grep -E "paho-mqtt|websocket-client"

# Si faltan, reinstalar
pip install paho-mqtt>=1.6.0 websocket-client>=1.6.0

# Verificar que Python puede importar los módulos
python3 -c "import paho.mqtt.client; import websocket; print('OK')"
```

### Blitzortung no se conecta

1. Verifica que MQTT/Mosquitto esté corriendo:
   ```bash
   sudo systemctl status mosquitto
   ```

2. Verifica los logs del backend:
   ```bash
   journalctl -u pantalla-dash-backend@dani.service -n 100 | grep -i blitzortung
   ```

3. Verifica la configuración en `config.json`:
   ```bash
   cat /var/lib/pantalla-reloj/config.json | python3 -m json.tool | grep -A 5 blitzortung
   ```

### Controles de radar no aparecen

1. Verifica que el radar esté habilitado:
   ```bash
   curl -s http://127.0.0.1:8081/api/config | python3 -m json.tool | grep -A 3 radar
   ```

2. Verifica que el frontend tenga los archivos CSS:
   ```bash
   ls -la dash-ui/src/components/GeoScope/RadarControls.css
   ```

3. Reconstruye el frontend si es necesario:
   ```bash
   cd dash-ui
   npm run build
   ```

## Archivos nuevos/modificados

### Backend
- `backend/services/blitzortung_service.py` (nuevo)
- `backend/main.py` (modificado)
- `backend/requirements.txt` (modificado)
- `backend/default_config_v2.json` (modificado)

### Frontend
- `dash-ui/src/components/GeoScope/RadarControls.tsx` (nuevo)
- `dash-ui/src/components/GeoScope/RadarControls.css` (nuevo)
- `dash-ui/src/components/GeoScope/GeoScopeMap.tsx` (modificado)

### Scripts
- `scripts/verify_startup.sh` (nuevo)

## Próximos pasos

1. ✅ Instalar dependencias del backend
2. ✅ Verificar configuración v2
3. ✅ Reiniciar servicios
4. ✅ Ejecutar verificación de arranque
5. ✅ Probar nuevas funcionalidades
6. ⏳ Configurar Blitzortung (opcional, si se requiere)
7. ⏳ Probar controles de radar en el frontend

