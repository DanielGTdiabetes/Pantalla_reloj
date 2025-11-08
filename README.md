# Pantalla_reloj (versión estable 2025-10)

Sistema reproducible para mini-PC Ubuntu 24.04 LTS con pantalla HDMI 8.8" orientada
verticalmente. La solución combina **FastAPI** (backend), **React + Vite**
(frontend) y un stack gráfico mínimo **Xorg + Openbox + Chromium en modo kiosk**
(Epiphany queda como opción secundaria).

## Arquitectura

```
Pantalla_reloj/
├─ backend/                  # FastAPI con endpoints de salud, datos y configuración
├─ dash-ui/                  # React/Vite UI en modo kiosk
├─ scripts/                  # install.sh, uninstall.sh, fix_permissions.sh
├─ systemd/                  # Servicios pantalla-*.service
├─ etc/nginx/sites-available # Virtual host de Nginx
└─ openbox/autostart         # Lanzamiento de Epiphany en modo kiosk (Firefox opcional)
```

### Backend (FastAPI)
- Endpoints: `/api/health`, `/api/config` (GET/PATCH), `/api/weather`, `/api/news`,
  `/api/astronomy`, `/api/calendar`, `/api/storm_mode` (GET/POST), `/api/astronomy/events`,
  `/api/efemerides`, `/api/efemerides/status`, `/api/efemerides/upload`.
- Persistencia de configuración en `/var/lib/pantalla-reloj/config.json` (se crea con
  valores por defecto si no existe) y caché JSON en `/var/lib/pantalla/cache/`.
- **Ruta oficial de config**: `/var/lib/pantalla-reloj/config.json`. Están obsoletas:
  `/etc/pantalla-dash/config.json`, `/var/lib/pantalla/config.json` (el backend las detecta
  al arranque y emite WARNING si existen, pero las ignora).
- El lanzador `usr/local/bin/pantalla-backend-launch` es robusto e idempotente:
  crea/usar venv en `/opt/pantalla-reloj/backend/.venv`, actualiza pip, instala
  dependencias desde `requirements.txt` con retry x2 si falla la red, valida imports
  críticos (fastapi, uvicorn, python-multipart, icalendar, backend.main) antes de lanzar,
  garantiza directorios (`/var/lib/pantalla-reloj/ics` con 0700), y lanza uvicorn con
  uvloop/httptools si están disponibles (sino usa stdlib). Los logs van a journal via
  `StandardOutput=journal` y `StandardError=journal` del servicio systemd.

#### Funcionalidades Implementadas (2025-01)
- ✅ **Proveedores personalizados**: `CustomFlightProvider` y `CustomShipProvider` con configuración de URL y API key
- ✅ **Precisión astronómica**: Cálculos precisos de efemérides usando `astral` (±1 minuto), información extendida (dusk, dawn, solar noon)
- ✅ **Procesamiento de radar**: Procesamiento de tiles RainViewer con `Pillow` y `numpy` para generar máscaras de foco
- ✅ **Unión geométrica**: Combinación real de polígonos CAP y radar usando `shapely` para máscaras de foco en modo `"both"`
- ✅ **Datos enriquecidos**: Santoral con información adicional (type, patron_of, name_days), hortalizas con siembra y cosecha, eventos astronómicos
- ✅ **Mejoras de fuentes**: `calculate_extended_astronomy()`, `get_astronomical_events()`, datos mejorados de harvest y saints
- ✅ **Efemérides históricas**: Panel de efemérides históricas con datos locales JSON, uploader en `/config`, validación y guardado atómico

### Frontend (React/Vite)
- Dashboard por defecto en modo `full`: mapa principal con tarjetas de noticias y
  eventos, más panel lateral derecho con métricas de clima, rotación y estado de
  tormenta.
- El panel lateral puede moverse a la izquierda y el carrusel de módulos (modo demo)
  puede activarse desde `/config`; por defecto ambos permanecen deshabilitados.
- `/config` expone la administración completa (rotación, API keys, MQTT, Wi-Fi y
  opciones de UI). El overlay solo aparece en `/` si se añade `?overlay=1` para
  depuración puntual.
- La tarjeta **Mapa → Modo Cine** ofrece ahora controles dedicados: selector de
  velocidad (lenta/media/rápida), amplitud del barrido con `range`, easing
  lineal/suave, pausa automática cuando hay overlays y un botón para restaurar
  los valores por defecto.
- El bloque **AEMET** permite gestionar la API key de forma segura. El campo se
  muestra enmascarado (•••• 1234), el botón «Mostrar» habilita la edición en
  claro y el botón «Probar clave» ejecuta `/api/aemet/test_key` para validar la
  credencial sin exponerla al resto del formulario.
- Compilado con `npm run build` y servido por Nginx desde `/var/www/html`.

#### Autopan y diagnósticos

- El mapa GeoScope rota automáticamente en modo kiosk incluso si el panel lateral
  no es visible; se escribe una traza periódica en `console.log`
  (`[diagnostics:auto-pan] bearing=<valor>`) para que `journalctl` pueda validar el
  movimiento.
- Flags de runtime disponibles vía `window.location.search` o `localStorage`:
  - `autopan=1|0` fuerza la animación ON/OFF.
  - `force=1|0` ignora heurísticas y activa/desactiva el autopan incluso en escritorio.
  - `reducedMotion=1|0` (alias heredado `reduced`) indica si se respeta `prefers-reduced-motion`.
  - `speed=<grados/segundo>` fija la velocidad sin recompilar (por defecto ~0.1 °/s).
- `/diagnostics/auto-pan` monta solo el mapa a pantalla completa con
  `force=1&reducedMotion=0` y muestra un banner superior con el bearing actual, ideal
  para comprobar rápidamente el kiosk.

### Configurar MapTiler

- Crea una cuenta en [MapTiler](https://maptiler.com/) y genera una API key desde el
  panel **Cloud → API keys**. Copia el identificador alfanumérico (solo letras,
  números, punto, guion y guion bajo).
- En la UI de configuración (`/#/config`), abre la tarjeta **Mapas**, selecciona
  **MapTiler** como proveedor y pega la API key. Usa el botón «Mostrar» para
  comprobarla antes de guardar.
- La clave queda almacenada en `config.json` y se envía al navegador para cargar los
  estilos vectoriales, por lo que se considera información visible desde el cliente.
  Si el plan de MapTiler lo permite, restringe la API key a los dominios o direcciones
  IP del kiosk desde el panel de MapTiler.
- **Auto-migración**: El backend migra automáticamente configuraciones MapTiler con estilos obsoletos (`dark`, `dark-v2`) al estilo `streets-v2` por defecto. Si la URL del estilo no incluye `?key=`, se añade automáticamente.
- **Validación**: El endpoint `/api/map/validate` valida la configuración de MapTiler y proporciona auto-fix si detecta problemas. La información de estado de MapTiler se incluye en `/api/health` en el campo `maptiler`.
- **Variable de entorno**: Opcionalmente, puedes definir `MAPTILER_API_KEY` como variable de entorno al iniciar el backend. Si `ui_map.maptiler.apiKey` está vacío, se inyectará automáticamente (no sobrescribe valores existentes).

### Configurar AEMET

- En la tarjeta **AEMET** de `/config` podrás activar/desactivar la integración y
  definir qué capas (CAP, radar, satélite) se descargan.
- La clave se almacena sólo en backend: el campo muestra `•••• 1234` si existe
  un secreto guardado. Pulsa «Mostrar» para editar y «Guardar clave» para enviar
  la actualización a `/api/config/secret/aemet_api_key`.
- Usa «Probar clave» para llamar a `/api/aemet/test_key`; el backend contacta con
  AEMET y responde `{ok:true}` o `{ok:false, reason:"unauthorized|network|…"}`.
- `GET /api/config` nunca devuelve la clave completa; expone `has_api_key` y
  `api_key_last4` para saber si se ha cargado correctamente.

### Calendario ICS

El sistema soporta calendarios ICS (iCalendar) que pueden configurarse mediante subida de archivos o rutas locales.

#### Configurar calendario ICS desde la UI

La interfaz de configuración (`/#/config`) ofrece un uploader integrado para subir archivos ICS directamente desde tu navegador.

**Procedimiento:**

1. **Acceder a la configuración**: Navega a `/#/config` y busca la sección **Calendario**.
2. **Seleccionar proveedor ICS**: En el campo "Proveedor", selecciona `ics` del menú desplegable.
3. **Subir archivo ICS**: Haz clic en el botón **"Subir ICS…"** y selecciona un archivo `.ics` desde tu equipo.
4. **Verificación automática**: Tras la subida, el sistema valida el formato y muestra el número de eventos detectados. La ruta del archivo se guarda automáticamente (por defecto: `/var/lib/pantalla-reloj/ics/calendar.ics`).
5. **Probar conexión**: Usa el botón **"Probar conexión"** para verificar que el calendario se carga correctamente y devuelve eventos.

**Requisitos:**

- El archivo debe tener extensión `.ics` (validado en el navegador antes de enviar).
- Tamaño máximo: 2 MB (el backend rechaza archivos mayores con error 413).
- Formato válido: El archivo debe cumplir el estándar iCalendar (RFC 5545). El backend valida que contenga `BEGIN:VCALENDAR` y `END:VCALENDAR`.
- Permisos: El usuario del servicio (`dani` por defecto) debe tener permisos de escritura en `/var/lib/pantalla-reloj/ics/` (el directorio se crea automáticamente con permisos `0700` si no existe).

**Solución de errores típicos:**

**Error: "El archivo debe tener extensión .ics"**
- **Causa**: El archivo seleccionado no termina en `.ics`.
- **Solución**: Asegúrate de que el archivo tenga la extensión correcta. Si el archivo es válido pero tiene otra extensión, renómbralo o comprueba que realmente es un calendario ICS.

**Error: "File size exceeds maximum (2097152 bytes)"**
- **Causa**: El archivo supera el límite de 2 MB.
- **Solución**: Divide el calendario en archivos más pequeños o elimina eventos antiguos. Considera usar una URL remota para calendarios grandes (configuración manual en `secrets.calendar_ics.url`).

**Error: "Cannot create ICS directory" o "Cannot write ICS file"**
- **Causa**: Permisos insuficientes en `/var/lib/pantalla-reloj/ics/`.
- **Solución**:
  ```bash
  sudo mkdir -p /var/lib/pantalla-reloj/ics
  sudo chown dani:dani /var/lib/pantalla-reloj/ics
  sudo chmod 0700 /var/lib/pantalla-reloj/ics
  sudo systemctl restart pantalla-dash-backend@dani.service
  ```

**Error: "File is not valid iCalendar format" o errores de parsing**
- **Causa**: El archivo ICS está corrupto o no cumple el estándar RFC 5545.
- **Solución**: Valida el archivo con una herramienta externa:
  ```bash
  # Verificar formato básico
  head -n 5 /ruta/al/archivo.ics
  # Debe comenzar con: BEGIN:VCALENDAR
  
  # Validar con Python
  python3 -c "from icalendar import Calendar; Calendar.from_ical(open('archivo.ics').read())"
  ```

**Error: "Ruta inexistente" (cuando se configura manualmente)**
- **Causa**: Si introduces la ruta manualmente y el archivo no existe en esa ubicación.
- **Solución**: Verifica que la ruta sea absoluta y que el archivo exista:
  ```bash
  ls -l /var/lib/pantalla-reloj/ics/calendar.ics
  # Verifica permisos: debe ser legible por el usuario del servicio
  sudo -u dani test -r /var/lib/pantalla-reloj/ics/calendar.ics && echo "OK" || echo "ERROR"
  ```

**El calendario se sube pero no muestra eventos:**
- **Causa**: El archivo puede estar vacío o los eventos estar fuera del rango de fechas consultado.
- **Solución**: Usa el botón **"Probar conexión"** en la UI para ver el estado detallado. Verifica los logs del backend:
  ```bash
  journalctl -u pantalla-dash-backend@dani.service -n 50 | grep -i calendar
  ```

**Subida mediante API (alternativa):**

Si prefieres subir el archivo por línea de comandos:
```bash
curl -X POST \
  -F "file=@/ruta/a/tu/calendario.ics" \
  -F "filename=calendario.ics" \
  http://127.0.0.1:8081/api/config/upload/ics
```

El archivo se almacena de forma segura y la configuración se actualiza automáticamente para usar el proveedor `ics`.

#### Endpoints relacionados

- `GET /api/calendar/events`: Obtiene eventos del calendario ICS
- `GET /api/calendar/status`: Verifica el estado del calendario ICS (devuelve `status: "ok"` si está funcionando correctamente)
- `POST /api/config/upload/ics`: Sube un archivo ICS al servidor
- `GET /api/health`: Incluye información del calendario en el campo `calendar.status`

#### Formato ICS soportado

El sistema soporta el formato estándar iCalendar (RFC 5545) con eventos `VEVENT` básicos:
- `UID`: Identificador único del evento
- `DTSTART` / `DTEND`: Fechas de inicio y fin
- `SUMMARY`: Título del evento
- `DESCRIPTION`: Descripción opcional
- `LOCATION`: Ubicación opcional

### Efemérides Históricas

El sistema soporta efemérides históricas (hechos/curiosidades del día) que se muestran en el panel rotativo del overlay. Los datos se almacenan localmente en formato JSON.

#### Configurar efemérides históricas desde la UI

La interfaz de configuración (`/#/config`) ofrece un uploader integrado para subir archivos JSON con efemérides directamente desde tu navegador.

**Procedimiento:**

1. **Acceder a la configuración**: Navega a `/#/config` y busca la sección **Efemérides Históricas**.
2. **Activar el panel**: Marca la casilla **"Activar Efemérides Históricas"** para habilitar el panel en el rotador.
3. **Configurar rotación**: Ajusta el **"Intervalo de rotación"** (3-60 segundos) y el **"Máximo de items a mostrar"** (1-20).
4. **Subir archivo JSON**: Haz clic en el campo **"Subir archivo JSON"** y selecciona un archivo `.json` desde tu equipo.
5. **Vista previa automática**: Tras la subida, el sistema muestra una vista previa de los 3 primeros items del día actual si hay datos disponibles.

**Formato del archivo JSON:**

El archivo debe tener la siguiente estructura:

```json
{
  "MM-DD": [
    "Año: Descripción del evento.",
    "Año: Otro evento del mismo día."
  ],
  "01-01": [
    "1959: Fidel Castro toma el poder en Cuba.",
    "1993: Entra en vigor el Tratado de Maastricht."
  ],
  "11-03": [
    "1957: Se lanza el Sputnik 2 con Laika.",
    "1992: Firma del Tratado de Maastricht que establece la Unión Europea."
  ]
}
```

**Requisitos:**

- El archivo debe tener extensión `.json` (validado en el navegador antes de enviar).
- Formato válido: El archivo debe cumplir la estructura `{"MM-DD": ["evento1", "evento2", ...]}`. Las claves deben ser fechas en formato `MM-DD` (mes-día) y los valores deben ser arrays de strings.
- Validación: El backend valida que todas las claves sean fechas válidas (mes 1-12, día 1-31) y que todos los valores sean strings no vacíos.
- Permisos: El usuario del servicio (`dani` por defecto) debe tener permisos de escritura en `/var/lib/pantalla-reloj/data/` (el directorio se crea automáticamente con permisos `0644` si no existe).

**Solución de errores típicos:**

**Error: "El archivo debe tener extensión .json"**
- **Causa**: El archivo seleccionado no termina en `.json`.
- **Solución**: Asegúrate de que el archivo tenga la extensión correcta.

**Error: "Invalid JSON format"**
- **Causa**: El archivo no es un JSON válido.
- **Solución**: Valida el JSON con una herramienta externa:
  ```bash
  python3 -m json.tool archivo.json
  ```

**Error: "Invalid efemerides format: Key 'XX-YY' must have numeric month and day"**
- **Causa**: Las claves de fecha no están en formato `MM-DD` válido.
- **Solución**: Asegúrate de que todas las claves sean fechas en formato `MM-DD` (ej: `01-01`, `11-03`, `12-25`).

**Error: "Invalid efemerides format: Empty string found in 'XX-YY'"**
- **Causa**: Hay strings vacíos en los arrays de eventos.
- **Solución**: Elimina cualquier string vacío de los arrays.

**El panel no muestra efemérides:**
- **Causa**: Puede que no haya datos para el día actual o que el panel no esté habilitado en el rotador.
- **Solución**: 
  1. Verifica que `panels.historicalEvents.enabled` esté en `true` en la configuración.
  2. Comprueba que el panel esté incluido en `ui_global.overlay.rotator.order`:
     ```bash
     curl -s http://127.0.0.1:8081/api/config | python3 -m json.tool | grep -A 5 "rotator"
     ```
  3. Verifica que haya datos para el día actual:
     ```bash
     curl -s http://127.0.0.1:8081/api/efemerides | python3 -m json.tool
     ```

**Subida mediante API (alternativa):**

Si prefieres subir el archivo por línea de comandos:
```bash
curl -X POST \
  -F "file=@/ruta/a/tu/efemerides.json" \
  http://127.0.0.1:8081/api/efemerides/upload
```

El archivo se almacena de forma atómica (tmp + rename) y la configuración se actualiza automáticamente para habilitar el panel.

#### Endpoints relacionados

- `GET /api/efemerides?date=YYYY-MM-DD`: Obtiene efemérides para una fecha específica (por defecto: hoy)
- `GET /api/efemerides/status`: Verifica el estado del servicio de efemérides históricas (devuelve `status: "ok"` si está funcionando correctamente)
- `POST /api/efemerides/upload`: Sube un archivo JSON de efemérides al servidor
- `GET /api/health`: Incluye información de efemérides históricas en el campo `historicalEvents.status`

#### Ruta por defecto

Por defecto, los archivos de efemérides se almacenan en `/var/lib/pantalla-reloj/data/efemerides.json`. Esta ruta puede configurarse en `panels.historicalEvents.local.data_path`.

### Timezone y rangos de fecha

- **Configuración**: El timezone se define en `config.display.timezone` (por defecto `Europe/Madrid`).
- **Backend**: Los endpoints que trabajan con fechas (`/api/calendar/events`, `/api/weather/weekly`) usan el timezone del config para:
  - Construir rangos del día local actual si no se proporcionan fechas.
  - Convertir siempre rangos local → UTC al consultar proveedores externos.
  - Loguear proyecciones local/UTC en DEBUG para trazabilidad.
- **Frontend**: Usa utilidades `formatLocal()` para renderizar horas/fechas según el timezone del config.
- **Hot-reload**: Con `POST /api/config/reload` cambiando `display.timezone`, los endpoints ajustan automáticamente sin reiniciar.
- **Metadatos**: `/api/health` expone `timezone` y `now_local_iso` para diagnóstico.

#### Diagnóstico calendario (inspect)

- **Modo inspección**: Añade `?inspect=1` o `?debug=1` a `/api/calendar/events` para obtener información detallada:
  - `tz`: Timezone aplicada (p. ej., `Europe/Madrid`)
  - `local_range`: Rango del día local calculado (`start`, `end` en ISO)
  - `utc_range`: Conversión a UTC del rango local (`start`, `end` en ISO)
  - `provider`: Proveedor usado (`google`, `ics` o `disabled`)
  - `provider_enabled`: Si el proveedor está habilitado
  - `credentials_present`: Si existen credenciales (API key y calendar ID para Google, o url/path para ICS)
  - `calendars_found`: Número de calendarios detectados
  - `raw_events_count`: Eventos crudos recibidos del proveedor
  - `filtered_events_count`: Eventos tras normalización
  - `note`: Motivo si no hay eventos (p. ej., sin credenciales, error API, provider deshabilitado)
- **Estado en health**: `/api/health` incluye bloque `calendar` con:
  - `enabled`: Si el calendario está habilitado
  - `provider`: Proveedor configurado (`google`, `ics` o `disabled`)
  - `credentials_present`: Si hay credenciales
  - `last_fetch_iso`: Última consulta exitosa (si está disponible)
  - `status`: Estado (`ok`, `stale`, `error`, `disabled`)
- **Configuración de calendario**: En `/config`, puedes seleccionar el proveedor (`google`, `ics` o `disabled`):
  - **Google Calendar**: Requiere `secrets.google.api_key` y `secrets.google.calendar_id`
  - **ICS (iCalendar)**: Requiere `secrets.calendar_ics.url` (HTTP/HTTPS) o `secrets.calendar_ics.path` (ruta local)
  - **Deshabilitado**: Desactiva completamente el panel de calendario
- **Logs DEBUG**: El backend loguea información detallada con prefijo `[Calendar]` y `[timezone]`:
  ```bash
  journalctl -u pantalla-dash-backend@dani -n 60 --no-pager -l | egrep -i 'calendar|tz|range|utc'
  ```

### Integración OpenSky

- Crea un cliente OAuth2 en el portal de [OpenSky Network](https://opensky-network.org/)
  (sección *API Access → OAuth2 client credentials*). El formulario devuelve un
  `client_id` y `client_secret` válidos para `grant_type=client_credentials`.
- El backend solicita tokens en
  `https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token`
  enviando ambos valores como `application/x-www-form-urlencoded`. Los tokens
  duran ~30 minutos y se renuevan automáticamente 60 segundos antes de expirar.
- Desde la tarjeta **OpenSky** de `/config` puedes:
  - Habilitar/deshabilitar la capa de vuelos sin tocar el resto del dashboard.
  - Definir el *bounding box* (Castellón por defecto) o cambiar a modo global.
  - Ajustar `poll_seconds` (mínimo 10 s en modo anónimo, 5 s con credenciales).
  - Limitar el número máximo de aeronaves (`max_aircraft`) y activar el clustering.
  - Solicitar el modo extendido (`extended=1`) para obtener categoría y squawk.
- Los secretos se guardan en `/var/lib/pantalla/secrets/opensky_client_*` via
  `PUT /api/config/secret/opensky_client_id` y
  `PUT /api/config/secret/opensky_client_secret`. Las respuestas `GET` sólo
  exponen `{"set": true|false}` para confirmar si existe un valor persistido.
- La UI incluye un botón «Probar conexión» que consulta `/api/opensky/status` y
  muestra: validez del token, edad del último sondeo, conteo de aeronaves
  cacheadas y cualquier error reciente (401, 429, backoff en curso, etc.).
- El endpoint público `/api/layers/flights` devuelve `items[]` normalizados
  (lon/lat, velocidad, rumbo, país, última recepción) y se apoya en una caché
  en memoria con TTL = `poll_seconds` (nunca <5 s). Si OpenSky responde con 429
  o 5xx se reutiliza el último snapshot marcándolo como `stale=true`.

### Capas globales (Radar/Aviones/Barcos)

La interfaz de configuración (`/#/config`) incluye toggles dedicados para activar o desactivar las capas en tiempo real del mapa: **Radar**, **Aviones** y **Barcos**. Estas capas se controlan de forma independiente desde la sección **"Capas del Mapa"**.

**Ubicación en la UI:**

En `/config`, busca la sección **"Capas del Mapa"** (visible solo en configuración v2). Aquí encontrarás tres checkboxes:

- **Aviones (OpenSky)**: Activa/desactiva la capa de vuelos en tiempo real desde OpenSky Network.
- **Barcos**: Activa/desactiva la capa de barcos en tiempo real (AIS).
- **Radar (AEMET)**: Activa/desactiva la capa de radar meteorológico de AEMET.
- **Satélite (GIBS)**: Activa/desactiva las imágenes satelitales de GIBS/NASA.

**Funcionamiento:**

- Cada toggle es independiente: puedes activar solo el radar, solo los aviones, o cualquier combinación.
- Los cambios se guardan inmediatamente al hacer clic en **"Guardar configuración"**.
- La configuración se aplica sin reiniciar el servicio gracias al merge seguro y hot-reload.

**Resolución de problemas:**

**Las capas no se activan tras guardar:**
- **Causa**: Puede ser un problema de merge de configuración o caché del frontend.
- **Solución**: Recarga la página (`F5` o `Ctrl+R`). Verifica que los cambios se persistieron:
  ```bash
  curl -s http://127.0.0.1:8081/api/config | python3 -m json.tool | grep -A 5 "layers\|ui_global"
  ```
  Busca `"enabled": true` en las capas correspondientes.

**El radar no se muestra:**
- **Causa**: AEMET no está configurado o la API key es inválida.
- **Solución**:
  1. Verifica que AEMET esté habilitado en la sección **AEMET** de `/config`:
     ```bash
     curl -s http://127.0.0.1:8081/api/config | python3 -m json.tool | grep -A 3 '"aemet"'
     ```
     Debe mostrar `"enabled": true`.
  2. Verifica que la API key de AEMET esté configurada y sea válida:
     ```bash
     curl -s http://127.0.0.1:8081/api/aemet/test_key
     ```
     Debe devolver `{"ok": true}`.
  3. Comprueba que `radar_enabled` esté activado en la configuración de AEMET:
     ```bash
     curl -s http://127.0.0.1:8081/api/config | python3 -m json.tool | grep -A 5 '"radar_enabled"'
     ```
  4. Revisa los logs del backend para errores de AEMET:
     ```bash
     journalctl -u pantalla-dash-backend@dani.service -n 50 | grep -i "aemet\|radar"
     ```

**Los aviones no aparecen:**
- **Causa**: OpenSky puede estar sin credenciales, con rate limit, o la capa está deshabilitada.
- **Solución**:
  1. Verifica el estado de OpenSky:
     ```bash
     curl -s http://127.0.0.1:8081/api/opensky/status | python3 -m json.tool
     ```
  2. Comprueba que la capa de vuelos esté habilitada:
     ```bash
     curl -s http://127.0.0.1:8081/api/config | python3 -m json.tool | grep -A 3 '"flights"'
     ```
     Debe mostrar `"enabled": true`.
  3. Si ves errores 401 (unauthorized), configura las credenciales OAuth2 de OpenSky en `/config` → **OpenSky**.
  4. Si ves errores 429 (rate limit), el sistema reutiliza el último snapshot. Espera unos minutos o ajusta `poll_seconds` a un valor mayor.
  5. Verifica los logs:
     ```bash
     journalctl -u pantalla-dash-backend@dani.service -n 50 | grep -i "opensky\|flights"
     ```

**Los barcos no aparecen:**
- **Causa**: AISStream puede requerir API key, o la capa está deshabilitada.
- **Solución**:
  1. Verifica que la capa de barcos esté habilitada:
     ```bash
     curl -s http://127.0.0.1:8081/api/config | python3 -m json.tool | grep -A 5 '"ships"'
     ```
     Debe mostrar `"enabled": true`.
  2. Comprueba la configuración del proveedor AIS:
     ```bash
     curl -s http://127.0.0.1:8081/api/config | python3 -m json.tool | grep -A 10 '"ships"' | grep -A 5 '"provider\|aisstream"'
     ```
  3. Si usas AISStream, verifica que la API key esté configurada en `/config` → **Barcos**.
  4. Revisa los logs:
     ```bash
     journalctl -u pantalla-dash-backend@dani.service -n 50 | grep -i "ships\|ais"
     ```

**Las capas se activan pero no se muestran en el mapa:**
- **Causa**: Puede ser un problema de caché del frontend o el mapa no está cargado.
- **Solución**:
  1. Recarga la página completamente (`Ctrl+Shift+R` para forzar recarga sin caché).
  2. Abre la consola del navegador (`F12`) y busca errores de JavaScript.
  3. Verifica que el mapa esté cargado correctamente: el endpoint `/api/layers/flights` o `/api/layers/ships` debe devolver datos:
     ```bash
     curl -s http://127.0.0.1:8081/api/layers/flights | python3 -m json.tool | head -n 20
     ```
  4. Si el backend devuelve datos pero el frontend no los muestra, puede ser un problema de visibilidad (zoom, bounds). Ajusta el zoom del mapa o cambia la vista.

**Rate limit alcanzado:**
- **Causa**: Demasiadas peticiones a las APIs externas (OpenSky, AEMET, AISStream).
- **Solución**:
  1. Aumenta el intervalo de actualización (`poll_seconds` o `refresh_seconds`) en la configuración de cada capa.
  2. Para OpenSky: configura credenciales OAuth2 para aumentar el límite de peticiones/minuto.
  3. Espera unos minutos: el sistema aplica backoff automático y reutiliza el último snapshot válido.

**API keys no válidas:**
- **Causa**: Las credenciales expiraron o son incorrectas.
- **Solución**:
  1. Para AEMET: usa el botón **"Probar clave"** en `/config` → **AEMET** para validar.
  2. Para OpenSky: usa el botón **"Probar conexión"** en `/config` → **OpenSky**.
  3. Para AISStream: verifica la API key en el panel de control de AISStream.
  4. Actualiza las credenciales si es necesario y guarda la configuración.

### Nginx (reverse proxy `/api`)

- El virtual host `etc/nginx/sites-available/pantalla-reloj.conf` debe quedar
  activo y apuntar a `/var/www/html`. Asegúrate de que el bloque `/api/` use
  `proxy_pass http://127.0.0.1:8081;` **sin barra final** para mantener los
  paths correctos.
- El site por defecto de Nginx no debe estar habilitado: elimina el symlink
  `/etc/nginx/sites-enabled/default` para evitar colisiones con `server_name _`.

### Verificación post-deploy

Tras cada build o despliegue ejecuta la verificación rápida del proxy/API:

```bash
chmod +x scripts/verify_api.sh
./scripts/verify_api.sh
```

Confirma que `nginx -t` pasa y que `/api/health` y `/api/config` responden vía
Nginx antes de dar por finalizada la actualización.

### Checks posteriores a install.sh

Tras ejecutar `sudo bash scripts/install.sh` valida el estado final con:

```bash
systemctl is-active pantalla-openbox@dani
systemctl is-active pantalla-kiosk@dani
curl -s http://127.0.0.1/ui-healthz
systemctl show pantalla-kiosk@dani -p Environment
pantalla-kiosk-verify
```

- `curl` debe devolver `{"ui":"ok"}` (HTTP 200) gracias al fallback SPA.
- `systemctl show ... -p Environment` debe listar `EnvironmentFile=/var/lib/pantalla-reloj/state/kiosk.env` y las variables
  heredadas de ese archivo.
- `pantalla-kiosk-verify` debe terminar con código 0; cualquier resumen diferente a
  `ok` merece revisión antes de cerrar el despliegue.

### Wi-Fi por defecto

`install.sh` crea `/etc/pantalla-reloj/wifi.conf` con `WIFI_INTERFACE=wlp2s0` para
uniformar la configuración inalámbrica. Comprueba la interfaz presente en el
equipo con `nmcli device status` y edita el archivo si usas otro nombre (p. ej.
`wlan0`). Recarga cualquier script/servicio dependiente tras modificar la
variable.

### Build estable (guardarraíles Node/npm)

- El repositorio incluye `.nvmrc` fijado a **Node.js 18.20.3** y `package.json`
  exige `node >=18.18 <21` y `npm >=9 <11` para evitar incompatibilidades.
- Todos los scripts usan `npm install --no-audit --no-fund` en lugar de
  `npm ci`, de modo que el lockfile se sincroniza automáticamente cuando cambian
  las dependencias.
- Comandos de referencia para despliegues reproducibles:

  ```bash
  nvm use || true
  npm run build:stable
  npm run verify:api
  ```

  `build:stable` limpia `node_modules`, instala dependencias sin auditoría y
  ejecuta `npm run build`.

### Servicios systemd
- `pantalla-xorg.service`: levanta `Xorg :0` sin display manager ni TCP.
- `pantalla-openbox@dani.service`: sesión gráfica minimalista con autostart que aplica
  la geometría fija descrita arriba y prepara el entorno antes de lanzar el kiosk.
- `pantalla-dash-backend@dani.service`: ejecuta el backend FastAPI como usuario `dani`
  vía `pantalla-backend-launch`. El servicio usa `StateDirectory=pantalla-reloj` (crea
  `/var/lib/pantalla-reloj` con permisos 0755), `User=%i` y `Group=%i` dinámicos,
  timeouts de 30s/15s, logging a journal, y `Environment=PORT=8081`. El launcher crea/usar
  venv en `/opt/pantalla-reloj/backend/.venv`, instala dependencias con retry x2, valida
  imports críticos (fastapi, uvicorn, python-multipart, icalendar, backend.main) y garantiza
  directorios de datos antes de lanzar uvicorn con uvloop/httptools si están disponibles.
- `pantalla-kiosk@dani.service`: lanzador agnóstico que prioriza Chromium (deb o snap) y
  recurre a Firefox si no hay binario Chromium disponible; consume `kiosk.env` para
  URL y overrides.
- `pantalla-kiosk-chromium@dani.service`: wrapper legado mantenido para entornos que
  aún dependan del despliegue antiguo; no se habilita por defecto.

## Arranque estable (boot hardening)

- **Openbox autostart robusto** (`openbox/autostart`): deja trazas en
  `/var/log/pantalla-reloj/openbox-autostart.log`, deshabilita DPMS y entrega el
  control al servicio Chromium para que aplique la geometría conocida.
- **Sesión X autenticada**: `pantalla-xorg.service` delega en
  `/usr/lib/pantalla-reloj/xorg-launch.sh`, que genera de forma determinista la
  cookie `MIT-MAGIC-COOKIE-1` en `/home/dani/.Xauthority` y la reutiliza para
  Openbox y el navegador.
- **Lanzador de navegador resiliente**: `pantalla-kiosk@dani.service` selecciona
  Chromium (`chromium-browser`, `chromium`, snap o `CHROME_BIN_OVERRIDE`) y recurre a
  Firefox como fallback, reutilizando perfiles persistentes en
  `/var/lib/pantalla-reloj/state/chromium-kiosk` o `/var/lib/pantalla-reloj/state/firefox-kiosk`.
- **Orden de arranque garantizado**: `pantalla-openbox@dani.service` requiere
  `pantalla-xorg.service`, el backend y Nginx (`After=`/`Requires=`) con reinicio
  automático (`Restart=always`). `pantalla-xorg.service` se activa desde
  `multi-user.target`, levanta `Xorg :0` en `vt1` y también se reinicia ante fallos.
- **Healthchecks previos al navegador**: el script de autostart espera a que Nginx y
  el backend respondan antes de lanzar la ventana kiosk, evitando popups de “la página
  no responde”.
- **Grupos del sistema**: durante la instalación `install.sh` añade a `dani` a los
  grupos `render` y `video`, informando si se requiere reinicio (con opción
  `--auto-reboot` para reiniciar automáticamente).
- **Display manager controlado**: el instalador enmascara `display-manager.service`
  (registrándolo en `/var/lib/pantalla-reloj/state`) y el desinstalador solo lo
  deshace si lo enmascaramos nosotros, evitando interferencias con sesiones gráficas
  ajenas.

## Kiosk Browser

### Kiosk (Chromium)

- El servicio `pantalla-kiosk-chromium@.service` del repositorio lanza nuestro binario `CHROMIUM_BIN=/usr/local/bin/chromium-kiosk-bin`, evitando cualquier wrapper del snap (`/usr/bin/chromium-browser`).
- Se declara `After=Wants=graphical.target pantalla-openbox@%i.service` para garantizar que Openbox y Xorg estén listos antes de iniciar Chromium; el límite de reinicios (`StartLimitIntervalSec=30s`, `StartLimitBurst=5`) reside en `[Unit]` para que systemd lo acepte.
- Variables de entorno críticas se fijan en la propia unit (`DISPLAY=:0`, `XAUTHORITY=/home/%i/.Xauthority`, directorios XDG por usuario) y se limpian locks residuales antes de ejecutar el navegador.
- Verificación rápida tras instalar o actualizar:

```bash
sudo systemd-analyze verify /etc/systemd/system/pantalla-kiosk-chromium@.service
sudo systemctl daemon-reload
sudo systemctl start pantalla-openbox@dani.service
sudo systemctl start pantalla-kiosk-chromium@dani.service
sudo journalctl -u pantalla-kiosk-chromium@dani.service -n 120 --no-pager
sudo find /home/dani/.local/share/pantalla-reloj/chromium /home/dani/.cache/pantalla-reloj/chromium -name 'LOCK'
```

- El journal no debe mostrar `Unknown key name 'StartLimitIntervalSec'`, ni `Command '/usr/bin/chromium-browser' requires the chromium snap to be installed`, ni `xset: unable to open display ":0"`. Tras reiniciar el servicio, no deben quedar archivos `LOCK` persistentes en los directorios del perfil/cache.

### Kiosk estable (Chrome .deb)

**Motivo**: Evitar el wrapper Snap de Chromium y problemas con AppArmor/D-Bus que pueden causar pantalla negra o fallos de arranque.

El sistema utiliza **Google Chrome instalado como paquete .deb** (no Snap) para garantizar un arranque fiable en Xorg+Openbox, con rotación correcta y sin pantalla negra.

**Instalación automática**:

El script `install.sh` instala automáticamente Google Chrome .deb desde la fuente oficial si no está disponible:

1. Descarga el .deb desde `https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb`
2. Instala el paquete con `dpkg -i` y resuelve dependencias con `apt -f install`
3. Instala la unidad systemd `/etc/systemd/system/pantalla-kiosk-chrome@.service`
4. Habilita e inicia `pantalla-kiosk-chrome@dani.service` tras Openbox

**Verificación rápida**:

```bash
# Verificar estado de servicios
sudo systemctl status pantalla-openbox@dani.service
sudo systemctl status pantalla-kiosk-chrome@dani.service

# Verificar ventana kiosk
./scripts/verify_kiosk.sh dani

# Verificar ventanas abiertas
wmctrl -lx | grep -i chrome || echo "No se ve Chrome"
```

**Arranque manual** (si es necesario):

```bash
# Recargar units y arrancar
sudo systemctl daemon-reload
sudo systemctl enable --now pantalla-openbox@dani.service
sudo systemctl enable --now pantalla-kiosk-chrome@dani.service
```

**Ventajas sobre Chromium Snap**:

- ✅ Sin problemas de AppArmor/D-Bus
- ✅ Arranque más rápido y fiable
- ✅ Sin dependencias de Snap
- ✅ Mejor integración con X11
- ✅ Verificador automático con fallback si la ventana no aparece

**Nota**: El servicio `pantalla-kiosk-chrome@.service` es un unit de sistema que lanza Chrome en modo kiosk para el usuario designado (`User=%i`). Esta aproximación evita depender de sesiones de systemd --user y simplifica el arranque automático tras el boot.

### Servicios esenciales

```bash
sudo systemctl enable --now pantalla-xorg.service
sudo systemctl enable --now pantalla-openbox@dani.service
sudo systemctl enable --now pantalla-kiosk@dani.service
```

`pantalla-kiosk@.service` carga `/var/lib/pantalla-reloj/state/kiosk.env` y fija
`DISPLAY=:0`, `XAUTHORITY=/home/%i/.Xauthority`, `GDK_BACKEND=x11`,
`GTK_USE_PORTAL=0`, `GIO_USE_PORTALS=0` y `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/%U/bus`
para que Chromium (paquete deb o snap) funcione sin portales ni errores de bus.

### Archivo `kiosk.env` (overrides)

`scripts/install.sh` crea `kiosk.env` solo si no existe. El archivo mantiene
variables persistentes y puede editarse manualmente. Valores admitidos:

- `KIOSK_URL` – URL inicial (por defecto `http://127.0.0.1/`).
- `CHROME_BIN_OVERRIDE` – comando o ruta absoluta para Chromium/Chrome.
- `FIREFOX_BIN_OVERRIDE` – comando o ruta absoluta para Firefox.
- `CHROMIUM_PROFILE_DIR` – perfil persistente de Chromium
  (default `/var/lib/pantalla-reloj/state/chromium-kiosk`).
- `FIREFOX_PROFILE_DIR` – perfil persistente de Firefox
  (default `/var/lib/pantalla-reloj/state/firefox-kiosk`).
- `PANTALLA_CHROMIUM_VERBOSE` – `1` para añadir `--v=1` y forzar trazas VERBOSE.
- `PANTALLA_ALLOW_SWIFTSHADER` – `1` para permitir el fallback
  `--enable-unsafe-swiftshader` si ANGLE falla.

Después de editar `kiosk.env`, ejecuta `sudo systemctl restart pantalla-kiosk@dani`.

### Orden de preferencia del navegador

1. `CHROME_BIN_OVERRIDE` (o `CHROMIUM_BIN_OVERRIDE` heredado) si apunta a un
   ejecutable válido.
2. `chromium-browser`.
3. `chromium`.
4. `/snap/bin/chromium`.
5. `google-chrome-stable` / `google-chrome`.
6. `/snap/chromium/current/usr/lib/chromium-browser/chrome`.
7. `FIREFOX_BIN_OVERRIDE`.
8. `firefox`.
9. `firefox-esr`.

Si no se encuentra ningún binario compatible el servicio escribe un error y se
reinicia tras `RestartSec=2`.

### Flags y perfiles persistentes

Chromium se lanza con los flags mínimos requeridos para kiosk estable:
`--kiosk --no-first-run --no-default-browser-check --password-store=basic`,
`--ozone-platform=x11`, `--ignore-gpu-blocklist`, `--enable-webgl` y
`--use-gl=egl-angle`, siempre acompañados de `--user-data-dir=<perfil>`. Firefox
recibe `--kiosk --new-instance --profile <dir> --no-remote`.

El wrapper elimina previamente cualquier ventana `pantalla-kiosk` o
`chrome.chromium` con `wmctrl -ic` y replica el stderr del navegador en
`/tmp/pantalla-chromium.XXXXXX.log` y `/var/log/pantalla/browser-kiosk.log`. Usa
`PANTALLA_CHROMIUM_VERBOSE=1` para habilitar `--v=1` o `PANTALLA_ALLOW_SWIFTSHADER=1`
para permitir el fallback software.

Los perfiles viven en `/var/lib/pantalla-reloj/state/chromium-kiosk` y
`/var/lib/pantalla-reloj/state/firefox-kiosk` (permisos `0700`). Puedes moverlos
editando `kiosk.env`.

### Troubleshooting DBus y portals

El entorno fija explícitamente `DBUS_SESSION_BUS_ADDRESS`, `GTK_USE_PORTAL=0` y
`GIO_USE_PORTALS=0`. Si reaparece el error “Failed to connect to the bus: Could
not parse server address”, confirma que `/run/user/<UID>/bus` existe y que
`systemctl show pantalla-kiosk@dani -p Environment` refleja la variable. Eliminar
portals evita cuadros de diálogo inesperados en modo kiosk.

### Logs y diagnóstico

El lanzador escribe en `/var/log/pantalla/browser-kiosk.log`. Para revisar la
ejecución completa usa `journalctl -u pantalla-kiosk@dani.service -n 120 --no-pager -l`.
`/usr/local/bin/diag_kiosk.sh` sigue siendo compatible y vuelca variables, PID y
trazas `diagnostics:auto-pan` durante 20 segundos.

### Diagnóstico rápido

```bash
sudo systemctl status pantalla-xorg.service pantalla-openbox@dani.service \
  pantalla-kiosk@dani.service
DISPLAY=:0 xrandr --query
DISPLAY=:0 wmctrl -lx
```

### Modo diagnóstico del kiosk

Para forzar temporalmente `/diagnostics/auto-pan` añade la entrada
`KIOSK_URL=http://127.0.0.1/diagnostics/auto-pan?force=1&reducedMotion=0` a
`kiosk.env` o aplica un drop-in con `systemctl edit pantalla-kiosk@dani.service`.
Recarga con `sudo systemctl daemon-reload` (si creaste un drop-in) y reinicia el
servicio. Comprueba el valor efectivo con
`systemctl show pantalla-kiosk@dani -p Environment` y vuelve a
`http://127.0.0.1/` al terminar.

## Instalación

### Requisitos previos

- Ubuntu 24.04 LTS con usuario **dani** creado y sudo disponible.
- Paquetes base: `sudo apt-get install -y git curl ca-certificates`.
- Node.js 20.x instalado desde NodeSource u otra fuente compatible (incluye
  Corepack y npm; **no** instales `npm` con `apt`).
- Acceso a Internet para descargar dependencias del backend/frontend y,
  opcionalmente, el tarball oficial de Firefox.

### Instalación automatizada

```bash
sudo bash scripts/install.sh --non-interactive
```

Si quieres conservar Firefox como navegador alternativo, añade la bandera
`--with-firefox` al comando anterior.

El instalador es idempotente: puedes ejecutarlo varias veces y dejará el sistema
en un estado consistente. Durante la instalación:

- Se validan e instalan las dependencias APT requeridas.
- Se habilita Corepack con `npm` actualizado sin usar `apt install npm`.
- Se instala el lanzador multi-navegador (`/usr/local/bin/pantalla-kiosk`) y la
  unidad `pantalla-kiosk@.service`, creando `kiosk.env` solo si falta para evitar
  sobrescrituras.
- Se prepara el backend (venv + `requirements.txt`) sirviendo en
  `http://127.0.0.1:8081` y se crea `/var/lib/pantalla-reloj/config.json` con el layout
  `full`, panel derecho y overlay oculto.
- Se construye el frontend (`dash-ui`) aplicando las variables Vite por defecto y
  se publica en `/var/www/html`.
- Se configura Nginx como reverse proxy (`/api/` → backend) y servidor estático.
- Se instalan y activan las unidades systemd (`pantalla-xorg.service`,
  `pantalla-openbox@dani.service`, `pantalla-dash-backend@dani.service`).
- **Espera activa del backend**: El instalador espera hasta 60s (con mensajes cada 5s)
  a que el backend responda en `/api/health` con `status=ok`. Si falla, muestra los logs
  del servicio (`journalctl -u pantalla-dash-backend@dani.service -n 150 -o short-iso`)
  y aborta la instalación para evitar servicios en estado inconsistente.
- Se asegura la rotación de la pantalla a horizontal y se lanza el navegador kiosk
  (Chromium por defecto, Firefox como fallback) apuntando a `http://127.0.0.1`.
- Crea `/var/log/pantalla`, `/var/lib/pantalla` y `/var/lib/pantalla-reloj/state`,
  asegurando que la cookie `~/.Xauthority` exista con permisos correctos para
  `dani`. El servicio backend usa `StateDirectory=pantalla-reloj` para crear
  `/var/lib/pantalla-reloj` automáticamente con permisos correctos.

Al finalizar verás un resumen con el estado del backend, frontend, Nginx y los
servicios systemd.

## Desinstalación

```bash
sudo bash scripts/uninstall.sh
```

Detiene y elimina los servicios, borra `/opt/pantalla`, `/opt/firefox`,
`/var/lib/pantalla`, `/var/log/pantalla`, restaura `/var/www/html` con el HTML
por defecto y elimina el symlink de Firefox si apuntaba a `/opt/firefox`.
También desinstala las unidades systemd sin reactivar ningún display manager.

## Health check y troubleshooting

- Verificar backend: `curl -sf http://127.0.0.1:8081/api/health` (debe devolver
  HTTP 200 con `{"status": "ok"}`).
- Verificar Nginx: `sudo systemctl is-active nginx`.
- Verificar servicios gráficos: `sudo systemctl is-active pantalla-xorg.service`,
  `sudo systemctl is-active pantalla-openbox@dani.service`.
- Verificar backend por systemd: `sudo systemctl status pantalla-dash-backend@dani.service`.
- Logs del backend: `/tmp/backend-launch.log`.
- Errores de Nginx: `/var/log/nginx/pantalla-reloj.error.log`.

### Solución de problemas

#### Problemas comunes con calendario ICS

1. **El calendario no muestra eventos**:
   - Verifica que el archivo ICS se haya subido correctamente:
     ```bash
     curl -s http://127.0.0.1:8081/api/calendar/status
     ```
     Debe devolver `"status": "ok"` si está funcionando.
   - Verifica que el proveedor esté configurado como `ics`:
     ```bash
     curl -s http://127.0.0.1:8081/api/config | python3 -m json.tool | grep -A 5 calendar
     ```
   - Comprueba que el archivo ICS tenga el formato correcto:
     ```bash
     head -n 5 /var/lib/pantalla-reloj/ics/calendar.ics
     ```
     Debe comenzar con `BEGIN:VCALENDAR`.

2. **Error al subir archivo ICS**:
   - Verifica que el archivo no exceda 2 MB:
     ```bash
     ls -lh tu_archivo.ics
     ```
   - Verifica que el archivo tenga extensión `.ics`:
     ```bash
     file tu_archivo.ics
     ```
   - Revisa los logs del backend:
     ```bash
     journalctl -u pantalla-dash-backend@dani.service -n 50 --no-pager | grep -i ics
     ```

3. **El calendario muestra `status: "error"`**:
   - Verifica que el archivo ICS existe y es legible:
     ```bash
     sudo -u dani test -r /var/lib/pantalla-reloj/ics/calendar.ics && echo "OK" || echo "ERROR"
     ```
   - Verifica los permisos del directorio ICS:
     ```bash
     ls -ld /var/lib/pantalla-reloj/ics/
     ```
   - Revisa el estado del calendario:
     ```bash
     curl -s http://127.0.0.1:8081/api/calendar/status | python3 -m json.tool
     ```
     Busca el campo `note` para ver el mensaje de error específico.

#### Problemas con layers (radar/aviones/barcos)

1. **Las capas no se activan**:
   - Verifica la configuración actual:
     ```bash
     curl -s http://127.0.0.1:8081/api/config | python3 -m json.tool | grep -A 10 layers
     ```
   - Activa las capas manualmente:
     ```bash
     curl -X POST http://127.0.0.1:8081/api/config \
       -H "Content-Type: application/json" \
       -d '{"version": 2, "ui_map": {}, "layers": {"flights": {"enabled": true}, "ships": {"enabled": true}}, "ui_global": {"radar": {"enabled": true}}}'
     ```

2. **El radar no se muestra**:
   - Verifica que AEMET esté configurado:
     ```bash
     curl -s http://127.0.0.1:8081/api/config | python3 -m json.tool | grep -A 5 aemet
     ```
   - Verifica el estado de AEMET en el health:
     ```bash
     curl -s http://127.0.0.1:8081/api/health | python3 -m json.tool | grep -A 10 aemet
     ```

#### Problemas con la persistencia de configuración

1. **Los cambios en `/config` no se guardan**:
   - Verifica los permisos del archivo de configuración:
     ```bash
     ls -l /var/lib/pantalla-reloj/config.json
     ```
   - Verifica que el directorio tenga permisos correctos:
     ```bash
     ls -ld /var/lib/pantalla-reloj/
     ```
   - Revisa los logs del backend para errores de escritura:
     ```bash
     journalctl -u pantalla-dash-backend@dani.service -n 50 --no-pager | grep -i "config\|persist\|write"
     ```

2. **La configuración se corrompe**:
   - Verifica que el archivo JSON sea válido:
     ```bash
     python3 -m json.tool /var/lib/pantalla-reloj/config.json > /dev/null && echo "OK" || echo "ERROR"
     ```
   - Restaura desde un backup si es necesario:
     ```bash
     sudo cp /var/lib/pantalla-reloj/config.json.backup /var/lib/pantalla-reloj/config.json
     ```

#### Smoke Test v23 Detallado

El script `scripts/smoke_v23.sh` ejecuta una suite completa de pruebas E2E (end-to-end) para verificar que todos los componentes de v23 funcionan correctamente.

**Comandos exactos:**

```bash
cd /home/dani/proyectos/Pantalla_reloj
chmod +x scripts/smoke_v23.sh
bash scripts/smoke_v23.sh [usuario]
```

Si no se especifica `[usuario]`, el script intenta detectarlo automáticamente desde `$VERIFY_USER`, `$SUDO_USER` o `$USER`.

**Tests ejecutados (10/10):**

1. **Health endpoint (HTTP 200)**: Verifica que `/api/health` devuelve HTTP 200 con `status=ok`
2. **Subida de archivo ICS**: Sube un archivo ICS de prueba a `/api/config/upload/ics` y verifica HTTP 200
3. **Activación de layers**: Activa las capas radar, aviones y barcos mediante POST `/api/config`
4. **Eventos de calendario**: Verifica que `/api/calendar/events` devuelve >= 1 evento tras la subida ICS
5. **Calendar status**: Verifica que `/api/calendar/status` devuelve `status="ok"`
6. **Weather now**: Verifica que `/api/weather/now` devuelve HTTP 200 sin errores 500 (permite vacío)
7. **Weather weekly**: Verifica que `/api/weather/weekly` devuelve HTTP 200 sin errores 500
8. **Ephemerides**: Verifica que `/api/ephemerides` devuelve HTTP 200 sin errores 500 (permite vacío)
9. **Saints**: Verifica que `/api/saints` devuelve HTTP 200 sin errores 500 (permite vacío)
10. **Overlay config**: Verifica que `/api/config` contiene bloque `ui_overlay` o `ui_global.overlay`

**Expected outputs por test:**

- **Test 1 (Health)**: `[smoke][OK] Health directo → HTTP 200, status=ok`
- **Test 2 (ICS Upload)**: `[smoke][OK] ICS subido correctamente → HTTP 200`
- **Test 3 (Layers)**: `[smoke][OK] Layers activados (radar/aviones/barcos) → HTTP 200`
- **Test 4 (Calendar Events)**: `[smoke][OK] Eventos de calendario: X >= 1`
- **Test 5 (Calendar Status)**: `[smoke][OK] Calendar status: ok`
- **Test 6 (Weather Now)**: `[smoke][OK] weather/now → HTTP 200 (sin 500)`
- **Test 7 (Weather Weekly)**: `[smoke][OK] weather/weekly → HTTP 200 (sin 500)`
- **Test 8 (Ephemerides)**: `[smoke][OK] ephemerides → HTTP 200 (sin 500, permite vacío)`
- **Test 9 (Saints)**: `[smoke][OK] saints → HTTP 200 (sin 500, permite vacío)`
- **Test 10 (Overlay)**: `[smoke][OK] Config contiene bloque overlay coherente`

**Salida de éxito:**

```
[smoke] ==========================================
[smoke][OK] Todos los smoke tests E2E v23 pasaron correctamente (10/10)
```

**Salida de fallo:**

```
[smoke][ERROR] Smoke tests E2E v23 fallaron: X error(es) de 10 tests
```

**Troubleshooting específico:**

**Test falla con "Fallo al verificar health directo":**
- **Causa**: El backend no está corriendo o no responde en `http://127.0.0.1:8081`
- **Solución**:
  ```bash
  sudo systemctl status pantalla-dash-backend@dani.service
  sudo systemctl restart pantalla-dash-backend@dani.service
  # Esperar 5-10s y volver a ejecutar el test
  ```

**Test falla con "Fallo al subir ICS":**
- **Causa**: Permisos insuficientes en `/var/lib/pantalla-reloj/ics/` o archivo ICS inválido
- **Solución**:
  ```bash
  sudo install -d -m 0700 -o dani -g dani /var/lib/pantalla-reloj/ics
  # Verificar que el archivo temporal existe: ls -l /tmp/test_calendar_v23.ics
  ```

**Test falla con "Fallo al verificar weather/now" o "weather/now devolvió error del servidor (500)":**
- **Causa**: Error interno del backend al obtener datos meteorológicos
- **Solución**: Revisar logs del backend:
  ```bash
  journalctl -u pantalla-dash-backend@dani.service -n 100 | grep -i weather
  ```
  Si el error persiste, verificar que OpenWeather API key esté configurada correctamente en `/config`.

**Test falla con "ephemerides devolvió error del servidor (500)":**
- **Causa**: Error interno del backend al calcular efemérides
- **Solución**: Revisar logs del backend:
  ```bash
  journalctl -u pantalla-dash-backend@dani.service -n 100 | grep -i ephemerides
  ```
  Nota: El test permite respuestas vacías, pero no errores 500 del servidor.

**Test falla con "Config no contiene bloque overlay":**
- **Causa**: La configuración no tiene bloque `ui_overlay` o `ui_global.overlay`
- **Solución**: Verificar la configuración:
  ```bash
  curl -s http://127.0.0.1:8081/api/config | python3 -m json.tool | grep -A 10 overlay
  ```
  Si falta, activar el overlay desde la UI en `/config` o añadirlo manualmente a la configuración.

**Test falla con "Fallo al verificar calendar status" o "status" != "ok":**
- **Causa**: El calendario ICS no se procesó correctamente o está corrupto
- **Solución**: Verificar el estado del calendario:
  ```bash
  curl -s http://127.0.0.1:8081/api/calendar/status | python3 -m json.tool
  ```
  Revisar el campo `note` para el motivo del error específico. Verificar que el archivo ICS tenga formato válido (RFC 5545).

Si algún test falla, el script mostrará el error específico con mensajes claros para facilitar el diagnóstico.

Para pruebas mínimas de runtime post-arranque, usa:

```bash
bash scripts/smoke_runtime.sh
```

Este script verifica:
1. Health 200 → status="ok"
2. Calendar status endpoint (ok/empty/stale sin errores de proveedor)
3. Config path correcto (`/var/lib/pantalla-reloj/config.json` y no "default/legacy")

### Runbook: pantalla negra + puntero

1. Revisar servicios clave:
   ```bash
   sudo systemctl status pantalla-xorg.service pantalla-openbox@dani.service \
     pantalla-dash-backend@dani.service pantalla-kiosk@dani.service
   ```
2. Si el backend falló, inspeccionar `/tmp/backend-launch.log`; para reiniciar:
   ```bash
   sudo systemctl restart pantalla-dash-backend@dani.service
   curl -sS http://127.0.0.1:8081/healthz
   ```
3. Validar que Chromium tenga acceso a DISPLAY=:0:
   ```bash
   sudo -u dani env DISPLAY=:0 XAUTHORITY=/home/dani/.Xauthority \
     chromium-browser --version
   ```
   Si falla con "Authorization required", revisa permisos de `~/.Xauthority`.
4. Diagnosticar geometría activa y ventanas:
   ```bash
   DISPLAY=:0 XAUTHORITY=/home/dani/.Xauthority xrandr --query
   DISPLAY=:0 XAUTHORITY=/home/dani/.Xauthority wmctrl -lx
   ```
5. Reaplicar la secuencia mínima de `xrandr` si aparece `BadMatch`:
   ```bash
   DISPLAY=:0 XAUTHORITY=/home/dani/.Xauthority xrandr --fb 1920x1920
   DISPLAY=:0 XAUTHORITY=/home/dani/.Xauthority \
     xrandr --output HDMI-1 --mode 480x1920 --primary --pos 0x0 --rotate left
   ```
6. Si persiste la pantalla negra, revisa el journal del servicio kiosk:
   ```bash
   journalctl -u pantalla-kiosk@dani.service -n 120 --no-pager -l
   ```

### Troubleshooting: Restart Loop del Backend

Si el servicio `pantalla-dash-backend@dani.service` entra en un ciclo de reinicios (`restart loop`), sigue estos pasos:

#### 1. Diagnosticar el problema

```bash
# Ver estado del servicio y últimos reinicios
sudo systemctl status pantalla-dash-backend@dani.service

# Ver logs detallados (últimos 150 registros con timestamp)
journalctl -u pantalla-dash-backend@dani.service -n 150 -o short-iso

# Verificar que el servicio está en restart loop
systemctl show pantalla-dash-backend@dani.service -p ActiveState,Result
```

#### 2. Verificar dependencias e imports

El launcher valida imports críticos antes de lanzar. Si fallan, revisa:

```bash
# Verificar venv existe y es válido
ls -la /opt/pantalla-reloj/backend/.venv/bin/python

# Probar imports manualmente
sudo -u dani /opt/pantalla-reloj/backend/.venv/bin/python -c "import fastapi; import uvicorn; import multipart; import icalendar; import backend.main"

# Si algún import falla, reinstalar dependencias
sudo -u dani /opt/pantalla-reloj/backend/.venv/bin/pip install -r /opt/pantalla-reloj/backend/requirements.txt
```

#### 3. Verificar permisos de directorios

```bash
# Verificar StateDirectory
ls -ld /var/lib/pantalla-reloj/
# Debe ser: drwxr-xr-x dani dani (o similar con owner correcto)

# Verificar directorio ICS
ls -ld /var/lib/pantalla-reloj/ics/
# Debe ser: drwx------ dani dani (0700)

# Verificar config.json
ls -l /var/lib/pantalla-reloj/config.json
# Debe ser: -rw-r--r-- dani dani (0644)

# Si los permisos están incorrectos, corregir:
sudo install -d -m 0755 -o dani -g dani /var/lib/pantalla-reloj
sudo install -d -m 0700 -o dani -g dani /var/lib/pantalla-reloj/ics
sudo chown dani:dani /var/lib/pantalla-reloj/config.json
sudo chmod 0644 /var/lib/pantalla-reloj/config.json
```

#### 4. Verificar StateDirectory en systemd

El unit debe tener `StateDirectory=pantalla-reloj` (no `pantalla`). Verificar:

```bash
systemctl cat pantalla-dash-backend@dani.service | grep StateDirectory
```

Si muestra `StateDirectory=pantalla`, corregir instalando el unit actualizado:

```bash
sudo systemctl stop pantalla-dash-backend@dani.service
sudo install -D -m 0644 systemd/pantalla-dash-backend@.service /etc/systemd/system/pantalla-dash-backend@.service
sudo systemctl daemon-reload
sudo systemctl start pantalla-dash-backend@dani.service
```

#### 5. Verificar puerto y variables de entorno

```bash
# Verificar que PORT está definido
systemctl show pantalla-dash-backend@dani.service -p Environment

# Verificar que el puerto 8081 no está ocupado
sudo lsof -i :8081 || echo "Puerto libre"
```

#### 6. Reinstalar backend desde cero

Si nada funciona, reinstalar el backend:

```bash
# Detener servicio
sudo systemctl stop pantalla-dash-backend@dani.service

# Eliminar venv y recrear
sudo rm -rf /opt/pantalla-reloj/backend/.venv
sudo -u dani python3 -m venv /opt/pantalla-reloj/backend/.venv
sudo -u dani /opt/pantalla-reloj/backend/.venv/bin/pip install --upgrade pip wheel
sudo -u dani /opt/pantalla-reloj/backend/.venv/bin/pip install -r /opt/pantalla-reloj/backend/requirements.txt

# Verificar imports
sudo -u dani /opt/pantalla-reloj/backend/.venv/bin/python -c "import backend.main" || echo "ERROR: Imports fallan"

# Reiniciar servicio
sudo systemctl start pantalla-dash-backend@dani.service

# Verificar que arranca correctamente (esperar hasta 30s por TimeoutStartSec)
sleep 35
curl -sfS http://127.0.0.1:8081/api/health | jq -r '.status' || echo "Backend no responde"
```

#### 7. Verificar health después del arranque

Después de corregir el problema, verifica que el backend esté funcionando:

```bash
# Esperar hasta 15s para que arranque (según DoD)
for i in {1..15}; do
  if curl -sfS http://127.0.0.1:8081/api/health | jq -e '.status == "ok"' >/dev/null 2>&1; then
    echo "Backend OK tras ${i}s"
    exit 0
  fi
  sleep 1
done
echo "Backend no responde tras 15s"
```

#### 8. Ejecutar smoke test de runtime

Una vez el servicio esté estable, verifica con el smoke test:

```bash
bash scripts/smoke_runtime.sh
```

Si el smoke test pasa pero el servicio sigue reiniciándose, revisa `journalctl -u pantalla-dash-backend@dani.service -f` en tiempo real para ver el error exacto antes del restart.

#### Errores comunes y soluciones

- **"ERROR: fastapi no importable"**: Reinstalar dependencias (`pip install -r requirements.txt`).
- **"ERROR: backend.main no importable"**: Verificar `PYTHONPATH=/opt/pantalla-reloj` y que el código backend esté en `/opt/pantalla-reloj/backend/`.
- **PermissionError al crear directorios**: Verificar permisos de `/var/lib/pantalla-reloj` y que el usuario del servicio tenga acceso.
- **"Port already in use"**: Verificar que no hay otra instancia corriendo (`lsof -i :8081`) o cambiar `Environment=PORT=8082` temporalmente.

## Corrección de permisos

```bash
sudo bash scripts/fix_permissions.sh [usuario] [grupo]
```

Por defecto ajusta permisos para `dani:dani` y vuelve a asignar `/var/www/html` a
`www-data`.

## Reparación del entorno kiosk

Si Firefox, Xorg u Openbox quedaron en un estado inconsistente (por ejemplo, un
symlink roto en `/usr/local/bin/firefox` o permisos erróneos en
`/run/user/1000`), ejecuta:

```bash
sudo KIOSK_USER=dani scripts/fix_kiosk_env.sh --with-firefox
```

El script reinstala el navegador desde Mozilla (opcional con
`--with-firefox`), restablece `~/.mozilla/pantalla-kiosk`, `.Xauthority`,
copias actualizadas de los servicios `pantalla-*.service` y reactiva
automáticamente `pantalla-xorg`, `pantalla-openbox@dani`,
`pantalla-dash-backend@dani` y `pantalla-kiosk@dani`.

## Desarrollo local

- Backend: `cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && uvicorn main:app --reload`
- Frontend: `cd dash-ui && npm install && npm run dev`

Puedes sobreescribir rutas del backend exportando `PANTALLA_STATE_DIR`,
`PANTALLA_CONFIG_FILE` o `PANTALLA_CACHE_DIR` durante el desarrollo.
