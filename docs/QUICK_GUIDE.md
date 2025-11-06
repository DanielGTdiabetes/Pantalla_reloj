# Guía Rápida de Configuración

Esta guía rápida te ayudará a configurar las funcionalidades principales de Pantalla Reloj.

## 1. Configurar MapTiler (V2)

### Opción 1: Usar Estilos Predefinidos

1. Ve a `/config` → "Maps and Layers"
2. Selecciona provider: **"MapTiler Vector"**
3. En "MapTiler Style", selecciona uno de:
   - `streets-v2` (calles detalladas)
   - `bright-v2` (brillante y colorido)
   - `dataviz-dark` (oscuro para visualización de datos)

### Opción 2: URLs Personalizadas

1. Configura las URLs de estilos en `maptiler.urls`:
   ```json
   {
     "maptiler": {
       "urls": {
         "styleUrlDark": "https://api.maptiler.com/maps/dataviz-dark/style.json?key=YOUR_KEY",
         "styleUrlLight": "https://api.maptiler.com/maps/streets-v2/style.json?key=YOUR_KEY",
         "styleUrlBright": "https://api.maptiler.com/maps/bright-v2/style.json?key=YOUR_KEY"
       }
     }
   }
   ```

2. Configura tu API key en `secrets.maptiler.api_key`

### Probar MapTiler

1. Click en **"Test MapTiler"**
2. Verifica que muestra:
   - ✓ `ok: true`
   - Bytes descargados
3. Click en **"Guardar"**

### Obtener API Key

1. Ve a [MapTiler](https://www.maptiler.com/)
2. Crea una cuenta gratuita
3. Obtén tu API key desde el dashboard
4. Configúrala en `/config` → "Maps and Layers" → "MapTiler API Key"

## 2. Subir Archivo ICS

### Preparar Archivo ICS

1. Exporta tu calendario desde Google Calendar, Outlook, etc. como `.ics`
2. O descarga un calendario ICS desde una URL pública

### Subir desde `/config`

1. Ve a `/config` → "Rotating Panel" → "Calendar"
2. Selecciona source: **"ICS"**
3. Selecciona mode: **"upload"**
4. Click en **"Choose File"** y selecciona tu archivo `.ics`
5. **Verifica:**
   - Barra de progreso aparece
   - Mensaje de éxito: "Archivo ICS subido correctamente. X eventos encontrados"
   - Archivo guardado se muestra

### Subir desde URL

1. Selecciona mode: **"url"**
2. Pega la URL del calendario ICS
3. Click en **"Descargar y Guardar"**

### Probar Calendario

1. Click en **"Test Calendario"**
2. Verifica que muestra:
   - ✓ `ok: true`
   - Número de eventos encontrados
   - Rango de días cubiertos

## 3. Probar Lightning (Blitzortung)

### Configurar MQTT

1. Instala Mosquitto (si no está instalado):
   ```bash
   sudo apt-get install mosquitto mosquitto-clients
   ```

2. Ve a `/config` → "Maps and Layers" → "Lightning"
3. Configura MQTT:
   - Host: `127.0.0.1` (o tu servidor MQTT)
   - Port: `1883` (puerto por defecto)
   - Topic: `blitzortung/1` (tópico por defecto)

### Probar MQTT

1. Click en **"Test MQTT"**
2. Verifica que muestra:
   - ✓ `ok: true`
   - `connected: true`
   - Rayos recibidos: `<número>`
   - Latencia: `<número>` ms

### Configurar Auto Storm Mode

1. Habilita **"Auto Storm Mode"**
2. Configura umbrales:
   - Threshold: `5` (número mínimo de rayos)
   - Radius: `50` (km de radio de detección)
3. Click en **"Guardar"**

### Verificar

1. El modo tormenta se activará automáticamente cuando:
   - Se detecten `threshold` o más rayos
   - Dentro de `radius` km del centro configurado
2. El mapa se centrará automáticamente en la zona de rayos
3. El zoom se ajustará automáticamente

## 4. Ver Satélite y Radar

### Habilitar Capas Globales

1. Ve a `/config` → "Maps and Layers" → "Global Layers"
2. Habilita **"Satellite (GIBS)"**
3. Habilita **"Radar (RainViewer)"**

### Probar GIBS (Satélite)

1. Click en **"Test GIBS"**
2. Verifica que muestra:
   - ✓ `ok: true`
   - Preview de tile si está disponible

### Probar RainViewer (Radar)

1. Click en **"Test RainViewer"**
2. Verifica que muestra:
   - ✓ `ok: true`
   - Frames disponibles: `<número>`

### Verificar Animación

1. Ve a la vista principal del mapa (`/`)
2. Verifica que:
   - La capa de satélite se anima (frames avanzan)
   - La capa de radar se anima (frames avanzan)
   - Las animaciones son suaves

### Configurar Animación

En `/config` → "Maps and Layers" → "Global Layers":

- **Satellite:**
  - Refresh: `10` minutos (intervalo de actualización)
  - Frame Step: `1` (avanzar 1 frame por vez)
- **Radar:**
  - Refresh: `5` minutos
  - Frame Step: `5` (avanzar 5 frames por vez)

## 5. Configurar Otros Proveedores

### OpenSky (Vuelos)

1. Ve a `/config` → "Maps and Layers" → "Flights"
2. Selecciona provider: **"OpenSky"**
3. Configura OAuth2:
   - Ve a [OpenSky](https://opensky-network.org/)
   - Obtén `client_id` y `client_secret`
   - Configúralos en `secrets.opensky.oauth2`
4. Click en **"Test OpenSky"**
5. Verifica que muestra:
   - ✓ `ok: true`
   - Token válido por X minutos

### AIS (Barcos)

1. Ve a `/config` → "Maps and Layers" → "Ships"
2. Selecciona provider:
   - **AISStream**: Requiere API key
   - **AIS Hub**: Requiere API key
   - **AIS Generic**: Requiere URL de API personalizada
3. Configura API key en `secrets.aisstream.api_key` o `secrets.aishub.api_key`
4. Click en **"Test AIS"**
5. Verifica que muestra:
   - ✓ `ok: true`
   - Provider utilizado

### News (Noticias)

1. Ve a `/config` → "Rotating Panel" → "News"
2. Añade feeds RSS:
   ```
   https://feeds.bbci.co.uk/news/rss.xml
   https://rss.nytimes.com/services/xml/rss/nyt/World.xml
   ```
3. Click en **"Test News"**
4. Verifica que muestra:
   - ✓ `ok: true` para cada feed válido
   - Items parseados por feed

## 6. Verificar Configuración

### Verificar que No Se Borran Claves

1. Configura completamente un grupo (ej: `layers.flights`)
2. Haz un cambio pequeño (ej: cambiar `refresh_seconds`)
3. Guarda
4. Verifica que otros campos del grupo se mantienen:
   - `max_items_global` sigue presente
   - `rate_limit_per_min` sigue presente
   - Otros campos no modificados siguen presentes

### Verificar que Tests Funcionan

Para cada proveedor en `/config`:

1. Click en **"Test [Provider]"**
2. Verifica que:
   - Muestra resultado claro (éxito/error)
   - Información relevante (API key status, eventos, etc.)
   - Tips si hay errores

### Verificar Logs

```bash
# Ver logs del backend
sudo journalctl -u pantalla-dash-backend@dani.service -f

# Ver logs de kiosk
tail -f /var/log/pantalla/browser-kiosk.log

# Ver logs rotativos
ls -lh /var/log/pantalla/
```

### Verificar Snapshots

```bash
# Ver snapshots de config
ls -lh /var/lib/pantalla-reloj/snapshots/

# Ver último snapshot
cat /var/lib/pantalla-reloj/snapshots/config_*.json | tail -1
```

## 7. Troubleshooting

### MapTiler No Carga

1. Verifica que la API key es válida: Click en "Test MapTiler"
2. Verifica que el estilo es v2: `streets-v2`, `bright-v2`, `dataviz-dark`
3. Verifica la consola del navegador para errores CORS

### ICS No Se Sube

1. Verifica que el archivo es `.ics` válido
2. Verifica permisos: `/var/lib/pantalla-reloj/ics/` debe ser escribible
3. Verifica logs: `journalctl -u pantalla-dash-backend@dani.service`

### Lightning No Funciona

1. Verifica que Mosquitto está ejecutándose:
   ```bash
   sudo systemctl status mosquitto
   ```

2. Verifica que el tópico es correcto: `blitzortung/1`
3. Prueba conectarte manualmente:
   ```bash
   mosquitto_sub -h 127.0.0.1 -p 1883 -t "blitzortung/1"
   ```

### Satélite/Radar No Se Anima

1. Verifica que las capas están habilitadas en `/config`
2. Verifica que `refresh_minutes` y `frame_step` están configurados
3. Verifica la consola del navegador para errores de red
4. Verifica que los endpoints responden:
   ```bash
   curl -s http://127.0.0.1:8081/api/global/satellite/frames | jq .
   curl -s http://127.0.0.1:8081/api/global/radar/frames | jq .
   ```

## 8. Recursos Adicionales

- **Documentación completa del esquema**: `docs/CONFIG_SCHEMA_V2.md`
- **Casos de prueba E2E**: `docs/E2E_TESTS.md`
- **Regresiones conocidas**: `docs/REGRESSIONS.md`
- **Logs y debugging**: `journalctl -u pantalla-dash-backend@dani.service -f`

