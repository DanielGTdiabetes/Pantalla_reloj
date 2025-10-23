# Integración con Google Calendar

Esta guía cubre cómo habilitar el proveedor **Google** para el widget de calendario.
El backend utiliza el flujo OAuth 2.0 *Device Authorization Grant* para evitar que
el mini PC tenga que iniciar sesión en un navegador tradicional.

## 1. Crear credenciales en Google Cloud

1. Accede a [Google Cloud Console](https://console.cloud.google.com/).
2. Crea (o reutiliza) un proyecto y habilita la API **Google Calendar**.
3. En **APIs & Services → Credentials** crea un OAuth client:
   - Tipo de aplicación: **TVs and Limited Input devices** (o **Desktop** si no está disponible).
   - Copia el `client_id` y el `client_secret` generados.
4. En **OAuth consent screen** añade al menos un usuario de prueba (el mismo que
   usará la autorización) y guarda los cambios.

## 2. Configurar `/etc/pantalla-dash/secrets.json`

El backend lee las credenciales desde `secrets.json` con permisos `0600`.
Añade la sección `google` (o edítala desde `/#/config` → pestaña **Credenciales**).

```json
{
  "google": {
    "client_id": "TU_CLIENT_ID.apps.googleusercontent.com",
    "client_secret": "TU_CLIENT_SECRET"
  }
}
```

> El archivo puede contener otras claves (`openai`, etc.). Respeta el formato JSON.

## 3. Seleccionar proveedor desde la UI

1. Abre la pantalla de configuración en el mini PC (`/#/config`).
2. En la tarjeta **Calendario** elige **Google** como proveedor.
3. Si las credenciales son válidas aparecerá el botón **Conectar con Google**.

Al pulsarlo el backend llamará a `POST /api/calendar/google/device/start` y la UI
mostrará el código de usuario y la URL `https://www.google.com/device`.

## 4. Completar la autorización

1. Desde un ordenador o móvil abre `https://www.google.com/device`.
2. Introduce el código mostrado en la pantalla.
3. Acepta los permisos de lectura (`Google Calendar API - read only`).
4. El backend guardará el `refresh_token` en `secrets.json` y la UI indicará el
   correo autorizado.

Puedes listar calendarios adicionales con el botón **Actualizar** (UI) que
invoca `GET /api/calendar/google/calendars`. Selecciona el calendario deseado en
el desplegable; el identificador se guarda en `config.calendar.google.calendarId`.

## 5. Funcionamiento interno y mantenimiento

- Los eventos se solicitan mediante `GET /api/calendar/upcoming` con `provider=google`.
- Se cachean durante 5 minutos en `backend/storage/cache/calendar_google_upcoming.json`.
- Si necesitas revocar la sesión elimina `refresh_token` de `secrets.json` o
  pulsa **Cancelar** en la UI (llama a `POST /api/calendar/google/device/cancel`).
- El endpoint `GET /api/calendar/google/device/status` devuelve el estado actual:
  `{ authorized, needs_action, user_code, verification_url, email, has_credentials, has_refresh_token }`.
- Todos los eventos relevantes se registran en `/var/log/pantalla-dash/calendar.log`.

## 6. Resolución de problemas

| Síntoma | Posible causa | Acción |
| --- | --- | --- |
| La UI muestra “Configura client_id…” | Falta `client_id` o `client_secret` | Revisa `secrets.json` y permisos (`sudo chmod 600`). |
| Error “No se pudo iniciar la autorización” | Proyecto sin Calendar API o credenciales inválidas | Comprueba que la API esté habilitada y que el tipo de cliente sea correcto. |
| Eventos no se actualizan | Token caducado o revocado | Elimina el `refresh_token` y repite la autorización. |
| Código expira antes de introducirlo | Tiempo excedido (30 min) | Pulsa **Conectar con Google** de nuevo para generar uno nuevo. |

Con estos pasos el calendario de Google quedará sincronizado de forma segura con
el dashboard.
