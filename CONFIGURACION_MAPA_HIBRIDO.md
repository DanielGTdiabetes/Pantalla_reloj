# Configuración del Mapa Híbrido Satélite + Etiquetas

## Problema Resuelto

El mapa híbrido no funcionaba porque faltaba un campo específico para indicar la URL del estilo satélite. 

**Antes**: El sistema intentaba usar `ui_map.maptiler.styleUrl` para ambos propósitos (mapa base y satélite), causando un conflicto.

**Ahora**: El campo `ui_map.satellite.style_url` permite especificar la URL del satélite independientemente del mapa base.

---

## Configuración Recomendada

Para tener un **mapa base satélite** con **etiquetas vectoriales** superpuestas, usa la siguiente configuración en tu archivo `/var/lib/pantalla-reloj/config.json`:

```json
{
  "version": 2,
  "ui_map": {
    "engine": "maplibre",
    "provider": "maptiler_vector",
    "maptiler": {
      "api_key": "TU_API_KEY_AQUI",
      "style": "vector-bright",
      "styleUrl": "https://api.maptiler.com/maps/streets-v4/style.json?key=TU_API_KEY_AQUI"
    },
    "satellite": {
      "enabled": true,
      "opacity": 1.0,
      "style_url": "https://api.maptiler.com/maps/satellite/style.json?key=TU_API_KEY_AQUI",
      "labels_overlay": {
        "enabled": true,
        "style_url": "https://api.maptiler.com/maps/streets-v4/style.json?key=TU_API_KEY_AQUI",
        "layer_filter": null,
        "opacity": 1.0
      }
    },
    "viewMode": "fixed",
    "fixed": {
      "center": { "lat": 39.986, "lon": -0.051 },
      "zoom": 10.0,
      "bearing": 0,
      "pitch": 0
    }
  },
  "secrets": {
    "maptiler": {
      "api_key": "TU_API_KEY_AQUI"
    }
  }
}
```

---

## Campos Importantes

### `ui_map.maptiler.styleUrl`
- **Propósito**: Estilo del mapa base vectorial (cuando el satélite está deshabilitado)
- **Valor recomendado**: `https://api.maptiler.com/maps/streets-v4/style.json?key=TU_API_KEY`

### `ui_map.satellite.enabled`
- **Propósito**: Activar/desactivar el modo híbrido satélite
- **Tipo**: `boolean`
- **Valor**: `true` para activar el mapa híbrido

### `ui_map.satellite.style_url` ✨ **NUEVO**
- **Propósito**: URL del estilo satélite (para obtener los tiles raster)
- **Valor recomendado**: `https://api.maptiler.com/maps/satellite/style.json?key=TU_API_KEY`
- **⚠️ IMPORTANTE**: Este campo es NUEVO y es necesario para que funcione el mapa híbrido

### `ui_map.satellite.opacity`
- **Propósito**: Opacidad de la capa satélite
- **Tipo**: `number` (entre 0.0 y 1.0)
- **Valor recomendado**: `1.0` para satélite completamente opaco

### `ui_map.satellite.labels_overlay.enabled`
- **Propósito**: Activar/desactivar las etiquetas vectoriales sobre el satélite
- **Tipo**: `boolean`
- **Valor**: `true` para mostrar etiquetas

### `ui_map.satellite.labels_overlay.style_url`
- **Propósito**: URL del estilo de etiquetas vectoriales
- **Valor recomendado**: `https://api.maptiler.com/maps/streets-v4/style.json?key=TU_API_KEY`

### `ui_map.satellite.labels_overlay.opacity`
- **Propósito**: Opacidad de las etiquetas
- **Tipo**: `number` (entre 0.0 y 1.0)
- **Valor recomendado**: `1.0` para etiquetas completamente opacas

### `ui_map.satellite.labels_overlay.layer_filter`
- **Propósito**: Filtro para seleccionar qué capas de etiquetas mostrar
- **Tipo**: `string` (expresión JSON) o `null`
- **Valor recomendado**: `null` para mostrar todas las etiquetas

---

## Ejemplos de Uso

### Ejemplo 1: Satélite con etiquetas completas (Recomendado)

```json
{
  "ui_map": {
    "satellite": {
      "enabled": true,
      "opacity": 1.0,
      "style_url": "https://api.maptiler.com/maps/satellite/style.json?key=TU_API_KEY",
      "labels_overlay": {
        "enabled": true,
        "style_url": "https://api.maptiler.com/maps/streets-v4/style.json?key=TU_API_KEY",
        "opacity": 1.0
      }
    }
  }
}
```

### Ejemplo 2: Satélite con etiquetas semitransparentes

```json
{
  "ui_map": {
    "satellite": {
      "enabled": true,
      "opacity": 1.0,
      "style_url": "https://api.maptiler.com/maps/satellite/style.json?key=TU_API_KEY",
      "labels_overlay": {
        "enabled": true,
        "style_url": "https://api.maptiler.com/maps/streets-v4/style.json?key=TU_API_KEY",
        "opacity": 0.7
      }
    }
  }
}
```

### Ejemplo 3: Solo satélite (sin etiquetas)

```json
{
  "ui_map": {
    "satellite": {
      "enabled": true,
      "opacity": 1.0,
      "style_url": "https://api.maptiler.com/maps/satellite/style.json?key=TU_API_KEY",
      "labels_overlay": {
        "enabled": false
      }
    }
  }
}
```

---

## Instrucciones de Instalación

### 1. Editar el archivo de configuración

```bash
sudo nano /var/lib/pantalla-reloj/config.json
```

### 2. Añadir/modificar la sección `ui_map.satellite`

Copia la configuración recomendada del inicio de este documento y pega en tu archivo.

**⚠️ IMPORTANTE**: Reemplaza `TU_API_KEY_AQUI` con tu API key real de MapTiler.

### 3. Guardar y salir

- Presiona `Ctrl+O` para guardar
- Presiona `Enter` para confirmar
- Presiona `Ctrl+X` para salir

### 4. Reiniciar el backend

```bash
sudo systemctl restart pantalla-dash-backend@dani.service
```

### 5. Recargar el navegador

Abre tu navegador y recarga la página (Ctrl+R o F5).

---

## Verificación

Después de aplicar la configuración, deberías ver:

1. ✅ **Fondo satélite**: Imagen satelital de MapTiler
2. ✅ **Etiquetas encima**: Nombres de calles, ciudades, POIs, etc.
3. ✅ **Otras capas**: Radar, vuelos, barcos (si están habilitados) se muestran encima de todo

---

## Validación rápida tras un despliegue

Para confirmar que el backend y el frontend están alineados con el modo híbrido puedes ejecutar estos pasos:

1. **Health del backend**

   ```bash
   curl -sS http://127.0.0.1/api/health/full | jq '.maptiler'
   ```

   - `status` debe ser `"ok"`.
   - `error` debe ser `null` o no aparecer.
   - `styleUrl` tiene que apuntar al estilo con `?key=` incluido.

2. **Config publicada**

   ```bash
   curl -sS http://127.0.0.1/api/config | jq '.ui_map'
   ```

   - `satellite.enabled` debe ser `true`.
   - `satellite.style_url` y `satellite.labels_overlay.style_url` deben incluir la API key.

3. **Frontend (kiosk y PC de la LAN)**

   - Verifica que ambos muestran el satélite de Castellón con etiquetas vectoriales.
   - En la consola (F12) comprueba los logs `[HybridFix]`:
     - `base_style_url` y `satellite_style_url` deben aparecer con la URL firmada (la clave se verá como `***`).
     - `satellite_enabled` debe ser `true` y `maptiler_key_present` debe ser `true`.
     - No deberían aparecer errores `Cannot read properties of null (reading 'version')`.

Si cualquiera de los pasos anteriores falla, revisa los logs del backend (`journalctl -u pantalla-dash-backend@dani.service`) y los mensajes `[HybridFix]` en el navegador.

---

## Troubleshooting

### El mapa sigue mostrando el estilo vectorial (no el satélite)

**Causa**: El campo `ui_map.satellite.enabled` no está en `true` o falta `style_url`.

**Solución**:
```json
{
  "ui_map": {
    "satellite": {
      "enabled": true,
      "style_url": "https://api.maptiler.com/maps/satellite/style.json?key=TU_API_KEY"
    }
  }
}
```

### Las etiquetas no se muestran

**Causa**: `labels_overlay.enabled` está en `false` o falta `labels_overlay.style_url`.

**Solución**:
```json
{
  "ui_map": {
    "satellite": {
      "labels_overlay": {
        "enabled": true,
        "style_url": "https://api.maptiler.com/maps/streets-v4/style.json?key=TU_API_KEY"
      }
    }
  }
}
```

### Error 403 (Forbidden) al cargar tiles

**Causa**: La API key no es válida o no tiene permisos para los tiles de satélite.

**Solución**:
1. Verifica tu API key en https://cloud.maptiler.com/
2. Asegúrate de que tiene acceso a:
   - `maps/satellite/`
   - `maps/streets-v4/`

### Consola del navegador muestra errores

Abre la consola del navegador (F12) y busca mensajes de error que contengan:
- `[MapHybrid]`
- `vectorLabels`
- `satellite`

Copia el error y verifica:
- Que las URLs estén firmadas con `?key=TU_API_KEY`
- Que la API key sea válida

---

## Diferencias con la Configuración Anterior

| Campo | Antes | Ahora |
|-------|-------|-------|
| URL satélite | No existía campo específico | `ui_map.satellite.style_url` |
| URL etiquetas | `ui_map.satellite.labels_style_url` (deprecated) | `ui_map.satellite.labels_overlay.style_url` |
| Opacidad etiquetas | No configurable | `ui_map.satellite.labels_overlay.opacity` |
| Filtro de capas | No disponible | `ui_map.satellite.labels_overlay.layer_filter` |

---

## Notas Adicionales

- **API Key**: Reemplaza `TU_API_KEY_AQUI` con tu clave real de MapTiler
- **Firma de URLs**: El backend firma automáticamente las URLs con tu API key
- **Compatibilidad**: Los campos legacy (`labels_style_url`, `style_raster`, `style_labels`) aún funcionan pero están deprecated

---

## Soporte

Para más información, consulta:
- [HYBRID_MAP_GUIDE.md](./HYBRID_MAP_GUIDE.md) - Guía técnica completa
- Logs del backend: `journalctl -u pantalla-dash-backend@dani.service -n 50`
- Consola del navegador (F12) para errores del frontend

