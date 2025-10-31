# Auditoría Completa del Sistema
## Fecha: 2025-01-XX

## Metodología
Revisión exhaustiva de:
1. install.sh
2. Arranque de la app (systemd, servicios)
3. Backend (endpoints, validaciones, errores)
4. Frontend (visualización, /config, wifi)
5. uninstall.sh

**IMPORTANTE:** Solo documentar problemas, NO reparar todavía.

---

## RESUMEN EJECUTIVO

**Total de problemas encontrados:** 24

### Por categoría:
- **Críticos (pantalla negra/no visualización):** 4
- **Críticos (arranque/servicios):** 3
- **Importantes (/config):** 5
- **Importantes (WiFi):** 2
- **Medios (backend):** 4
- **Medios (frontend):** 3
- **Bajos (logs/limpieza):** 2

---

## 1. REVISIÓN DE SCRIPTS DE INSTALACIÓN

### 1.1 install.sh

#### ✅ Aspectos positivos:
- Validación de permisos root
- Verificación de usuario existente
- Manejo de errores en comandos críticos
- Verificación post-instalación

#### ❌ PROBLEMA 1: Usuario hardcodeado en sistema Xorg
**Ubicación:** `systemd/pantalla-xorg.service` línea 10  
**Descripción:** El servicio Xorg usa `/home/dani/.Xauthority` hardcodeado, pero el usuario puede variar.  
**Impacto:** CRÍTICO - Si el usuario no es "dani", Xorg no arrancará y habrá pantalla negra.  
**Referencias:** `install.sh` detecta `$USER_NAME` pero Xorg service lo ignora.

#### ❌ PROBLEMA 2: Falta validación de dependencias críticas antes de arrancar servicios
**Ubicación:** `scripts/install.sh` líneas 520-540  
**Descripción:** Se habilitan servicios sin verificar que todas las dependencias estén instaladas correctamente (ej: `shapely` para `focus_masks`).  
**Impacto:** IMPORTANTE - El backend puede fallar silenciosamente si falta `shapely` (solo log de warning).  
**Referencias:** `backend/focus_masks.py` línea 22-23 tiene fallback pero no se verifica en instalación.

#### ❌ PROBLEMA 3: Falta verificación de permisos en directorios de caché
**Ubicación:** `scripts/install.sh` líneas 273-277  
**Descripción:** Se crean directorios `/var/cache/pantalla/*` pero no se verifica que el backend pueda escribir en ellos.  
**Impacto:** MEDIO - El backend puede fallar al escribir caché sin mostrar errores claros.

#### ❌ PROBLEMA 4: No se valida que Nginx esté configurado antes de habilitar servicios
**Ubicación:** `scripts/install.sh` línea 455  
**Descripción:** `configure_nginx()` puede fallar, pero se continúa habilitando servicios sin verificar.  
**Impacto:** IMPORTANTE - El frontend no será accesible si Nginx falla.

#### ❌ PROBLEMA 5: Falta verificación de interfaz WiFi antes de usar
**Ubicación:** `scripts/install.sh` línea 170  
**Descripción:** Se lee `WIFI_INTERFACE` pero no se valida que la interfaz exista físicamente.  
**Impacto:** MEDIO - `/config` mostrará errores al buscar WiFi si la interfaz no existe.

---

## 2. REVISIÓN DE ARRANQUE Y SERVICIOS SYSTEMD

### 2.1 pantalla-xorg.service

#### ❌ PROBLEMA 6: Usuario hardcodeado en Xorg
**Ubicación:** `systemd/pantalla-xorg.service` línea 10  
**Descripción:** Usa `/home/dani/.Xauthority` hardcodeado, no parametrizado.  
**Impacto:** CRÍTICO - Si el usuario no es "dani", Xorg no arrancará.  
**Nota:** Ya mencionado en PROBLEMA 1.

### 2.2 pantalla-dash-backend@.service

#### ❌ PROBLEMA 7: Falta manejo de errores de importación Python
**Ubicación:** `usr/local/bin/pantalla-backend-launch` líneas 24-32  
**Descripción:** Si `importlib.import_module("backend.main")` falla, el servicio solo imprime error y sale con código 3, pero systemd puede reiniciarlo indefinidamente.  
**Impacto:** IMPORTANTE - Loop de reinicios si hay un error de importación.

### 2.3 pantalla-kiosk-chromium@.service

#### ❌ PROBLEMA 8: No se valida que Chromium exista antes de arrancar
**Ubicación:** `usr/local/bin/pantalla-kiosk-chromium` líneas 147-150  
**Descripción:** Si no encuentra Chromium, sale con código 1, pero el servicio systemd puede seguir intentando reiniciar.  
**Impacto:** IMPORTANTE - Loop de reinicios si Chromium no está instalado.

---

## 3. REVISIÓN DE BACKEND

### 3.1 Manejo de errores en endpoints

#### ❌ PROBLEMA 9: Falta validación de bounds en endpoints de layers
**Ubicación:** `backend/main.py` líneas 1150-1155 (flights), 1303-1308 (ships)  
**Descripción:** Si `bbox` viene mal formateado, solo se registra warning pero se continúa con `bounds=None`.  
**Impacto:** MEDIO - Puede devolver demasiados items si el bbox es inválido.

#### ❌ PROBLEMA 10: Falta manejo de errores en focus masks
**Ubicación:** `backend/main.py` líneas 1216-1228 (flights), 1373-1383 (ships)  
**Descripción:** Si `load_or_build_focus_mask` falla, se captura Exception pero solo se registra warning y se continúa sin focus mask. Esto es correcto, pero el log no es muy descriptivo.  
**Impacto:** BAJO - Funciona pero con logs poco claros.

#### ❌ PROBLEMA 11: WiFi scan puede fallar silenciosamente
**Ubicación:** `backend/main.py` líneas 753-776  
**Descripción:** Si `nmcli device status` falla, se lanza HTTPException 500, pero si el dispositivo no existe, solo se registra warning y se continúa.  
**Impacto:** IMPORTANTE - Puede dar errores confusos si la interfaz WiFi no existe.

#### ❌ PROBLEMA 12: Falta validación de permisos en endpoints WiFi
**Ubicación:** `backend/main.py` líneas 965-1012 (wifi_connect), 1015-1037 (wifi_disconnect)  
**Descripción:** Si `nmcli` requiere permisos root y el backend corre como usuario normal, fallará con error genérico.  
**Impacto:** IMPORTANTE - Errores poco claros cuando falta permisos para WiFi.

### 3.2 Configuración

#### ❌ PROBLEMA 13: Falta validación de provider "custom" en Flights/Ships
**Ubicación:** `backend/main.py` líneas 1060-1080 (flights provider), 1090-1120 (ships provider)  
**Descripción:** El código no maneja el caso `provider="custom"`, por lo que fallará si se intenta usar.  
**Impacto:** IMPORTANTE - Si se configura `provider="custom"` en `/config`, el backend fallará con AttributeError.

---

## 4. REVISIÓN DE FRONTEND

### 4.1 ConfigPage

#### ❌ PROBLEMA 14: Falta manejo de errores en carga inicial de /config
**Ubicación:** `dash-ui/src/pages/ConfigPage.tsx` líneas 535-573  
**Descripción:** Si `getHealth()` falla en `handleSubmit`, se captura pero solo se establece `status="error"`. No hay retry o mensaje claro al usuario.  
**Impacto:** MEDIO - Si el backend no está disponible temporalmente, el usuario verá error genérico.

#### ❌ PROBLEMA 15: Falta validación de campos WiFi antes de conectar
**Ubicación:** `dash-ui/src/pages/ConfigPage.tsx` (no encontrado en código revisado)  
**Descripción:** No se valida que el SSID no esté vacío antes de llamar a `wifiConnect()`.  
**Impacto:** MEDIO - Errores confusos si se intenta conectar con SSID vacío.

### 4.2 GeoScopeMap

#### ❌ PROBLEMA 16: Falta manejo de errores en inicialización del mapa
**Ubicación:** `dash-ui/src/components/GeoScope/GeoScopeMap.tsx` líneas 1611-1690  
**Descripción:** Si `loadRuntimePreferences()` falla, hay fallback, pero si `new maplibregl.Map()` falla, puede dejar la pantalla negra sin mensaje de error.  
**Impacto:** CRÍTICO - Pantalla negra si falla la inicialización del mapa sin WebGL.

#### ❌ PROBLEMA 17: Falta manejo de errores en carga de layers globales
**Ubicación:** `dash-ui/src/components/GeoScope/GeoScopeMap.tsx` líneas 1772-1791  
**Descripción:** Si `GlobalSatelliteLayer` o `GlobalRadarLayer` fallan al inicializar, no hay manejo de errores visible.  
**Impacto:** MEDIO - Layers pueden fallar silenciosamente.

### 4.3 Manejo de errores de red

#### ❌ PROBLEMA 18: Falta retry en llamadas API críticas
**Ubicación:** `dash-ui/src/lib/api.ts` líneas 34-58  
**Descripción:** Si una llamada API falla, se lanza `ApiError` pero no hay retry automático.  
**Impacto:** MEDIO - Errores temporales de red pueden dejar la UI sin datos.

---

## 5. REVISIÓN DE UNINSTALL.SH

### 5.1 Limpieza incompleta

#### ❌ PROBLEMA 19: No se limpian todos los directorios de caché
**Ubicación:** `scripts/uninstall.sh` líneas 225-239  
**Descripción:** Solo limpia `/var/cache/pantalla/focus/*` y `/var/cache/pantalla/global/*` si `PURGE_CONFIG` o `PURGE_VENV`, pero no limpia archivos `flights.*` o `ships.*` en la raíz de `/var/cache/pantalla`.  
**Impacto:** BAJO - Archivos de caché pueden quedarse después de desinstalar.

#### ❌ PROBLEMA 20: No se valida que los servicios estén detenidos antes de eliminar
**Ubicación:** `scripts/uninstall.sh` líneas 89-96  
**Descripción:** Se intenta detener servicios pero si fallan, se continúa eliminando unidades de systemd.  
**Impacto:** MEDIO - Puede dejar servicios en estado inconsistente.

---

## 6. PROBLEMAS DE VISUALIZACIÓN Y PANTALLA NEGRA

#### ❌ PROBLEMA 21: Falta verificación de WebGL antes de renderizar mapa
**Ubicación:** `dash-ui/src/components/GeoScope/GeoScopeMap.tsx` línea 1678  
**Descripción:** `new maplibregl.Map()` puede fallar si WebGL no está disponible, pero no hay verificación previa.  
**Impacto:** CRÍTICO - Pantalla negra si WebGL no está disponible (mencionado en PROBLEMA 16).

#### ❌ PROBLEMA 22: Falta fallback visual si el mapa falla
**Ubicación:** `dash-ui/src/components/GeoScope/GeoScopeMap.tsx`  
**Descripción:** Si el mapa falla completamente, no hay mensaje de error visible para el usuario.  
**Impacto:** CRÍTICO - Pantalla completamente negra sin feedback.

#### ❌ PROBLEMA 23: Falta validación de tamaño del contenedor antes de inicializar mapa
**Ubicación:** `dash-ui/src/components/GeoScope/GeoScopeMap.tsx` línea 1612  
**Descripción:** `waitForStableSize()` espera un tamaño estable, pero si el contenedor nunca alcanza un tamaño válido (>0), puede inicializar el mapa con tamaño 0.  
**Impacto:** MEDIO - Mapa puede no renderizar si el contenedor tiene tamaño 0.

---

## 7. PROBLEMAS DE CONFIGURACIÓN

#### ❌ PROBLEMA 24: Falta validación de schema en frontend antes de enviar
**Ubicación:** `dash-ui/src/pages/ConfigPage.tsx` líneas 540-544  
**Descripción:** Se valida con `validateConfig()` pero no se valida contra el schema completo de Pydantic antes de enviar.  
**Impacto:** MEDIO - Errores de validación pueden aparecer solo en el backend.

---

## 8. RESUMEN FINAL

### Problemas Críticos (prioridad alta):
1. Usuario hardcodeado en Xorg (PROBLEMA 1, 6)
2. Falta verificación de WebGL antes de renderizar (PROBLEMA 16, 21)
3. Falta fallback visual si el mapa falla (PROBLEMA 22)

### Problemas Importantes (prioridad media-alta):
4. Falta validación de dependencias antes de arrancar servicios (PROBLEMA 2)
5. Falta verificación de Nginx antes de habilitar servicios (PROBLEMA 4)
6. Falta manejo de errores en backend launch (PROBLEMA 7)
7. No se valida Chromium antes de arrancar (PROBLEMA 8)
8. Falta validación de permisos WiFi (PROBLEMA 12)
9. Falta implementación de provider "custom" (PROBLEMA 13)
10. Falta validación de interfaz WiFi (PROBLEMA 5, 11)

### Problemas Medios (prioridad media):
11. Falta verificación de permisos en caché (PROBLEMA 3)
12. Falta manejo de errores en /config (PROBLEMA 14)
13. Falta validación de campos WiFi (PROBLEMA 15)
14. Falta manejo de errores en layers globales (PROBLEMA 17)
15. Falta retry en llamadas API (PROBLEMA 18)
16. Falta validación de tamaño del contenedor (PROBLEMA 23)
17. Falta validación completa de schema (PROBLEMA 24)

### Problemas Bajos (prioridad baja):
18. Logs poco claros en focus masks (PROBLEMA 10)
19. Limpieza incompleta en uninstall (PROBLEMA 19, 20)

---

## RECOMENDACIONES GENERALES

1. **Agregar verificaciones pre-arranque:** Antes de habilitar servicios, verificar que todas las dependencias estén instaladas y funcionando.
2. **Mejorar manejo de errores:** Añadir mensajes de error más descriptivos y fallbacks visuales cuando sea posible.
3. **Validar permisos:** Verificar permisos de escritura en directorios de caché y configuración antes de usar.
4. **Parametrizar usuarios:** Eliminar usuarios hardcodeados y usar variables de entorno o parámetros de systemd.
5. **Implementar retry logic:** Añadir retry automático para llamadas API críticas con backoff exponencial.
6. **Mejorar feedback visual:** Añadir indicadores de carga y mensajes de error claros cuando el sistema falla.

