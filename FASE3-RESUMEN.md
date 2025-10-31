# Fase 3: Resumen de Configuración Implementada

## ✅ Modelos de Configuración Completados

### 1. **News (Noticias RSS)**
- ✅ `enabled`: Habilitar/deshabilitar noticias
- ✅ `rss_feeds`: Lista de feeds RSS (por defecto: Periódico Mediterráneo, Xataka)
- ✅ `max_items_per_feed`: Máximo de artículos por feed (1-50, default: 10)
- ✅ `refresh_minutes`: Intervalo de actualización en minutos (5-1440, default: 30)

### 2. **Calendar (Google Calendar)**
- ✅ `enabled`: Habilitar/deshabilitar calendario
- ✅ `google_api_key`: API key de Google Calendar (opcional)
- ✅ `google_calendar_id`: ID del calendario de Google (opcional)
- ✅ `days_ahead`: Días adelante para obtener eventos (1-90, default: 14)

### 3. **Harvest (Hortalizas/Cultivos Estacionales)**
- ✅ `enabled`: Habilitar/deshabilitar hortalizas
- ✅ `custom_items`: Items personalizados de cultivos

### 4. **Saints (Santoral)**
- ✅ `enabled`: Habilitar/deshabilitar santoral
- ✅ `include_namedays`: Incluir onomásticos
- ✅ `locale`: Locale para nombres (default: "es")

### 5. **Ephemerides (Efemérides)**
- ✅ `enabled`: Habilitar/deshabilitar efemérides
- ✅ `latitude`: Latitud para cálculos (default: 39.986 - Castellón)
- ✅ `longitude`: Longitud para cálculos (default: -0.051 - Vila-real)
- ✅ `timezone`: Zona horaria (default: "Europe/Madrid")

## ⏳ Pendiente: Implementación Backend

### 1. Google Calendar (`/api/calendar`)
- [ ] Integrar Google Calendar API
- [ ] Obtener eventos próximos según `days_ahead`
- [ ] Formatear eventos para frontend
- [ ] Manejar errores de API

### 2. RSS Feeds (`/api/news`)
- [ ] Parser RSS/Atom (usar `feedparser` o `rss-parser`)
- [ ] Cargar múltiples feeds en paralelo
- [ ] Limitar artículos según `max_items_per_feed`
- [ ] Actualizar según `refresh_minutes`

### 3. Fases Lunares (`/api/astronomy`)
- [ ] Algoritmo de cálculo de fase lunar (usar `pyephem`, `astral` o cálculo propio)
- [ ] Calcular iluminación lunar precisa
- [ ] Actualizar según fecha/hora actual

### 4. Hortalizas Estacionales (`/api/calendar.harvest`)
- [ ] Base de datos de hortalizas con temporadas
- [ ] Calcular qué cultivos están en temporada según mes actual
- [ ] Combinar con `custom_items` de configuración

### 5. Santoral (`/api/calendar.saints` y `/api/calendar.namedays`)
- [ ] Base de datos de santos por fecha
- [ ] Generar lista de santos del día
- [ ] Incluir onomásticos si está habilitado
- [ ] Localización según `locale`

### 6. Efemérides (`/api/astronomy.events`)
- [ ] Calcular salida/puesta de sol (usar lat/lon de configuración)
- [ ] Generar eventos astronómicos del día
- [ ] Calcular horas solares precisas

## 📝 Notas Técnicas

- **Google Calendar API**: Requiere OAuth2 o Service Account
- **RSS Parser**: Python: `feedparser` o `rss-parser` | Node.js: `rss-parser`
- **Fases Lunares**: Librerías: `pyephem`, `astral`, o cálculo con fórmulas astronómicas
- **Hortalizas**: JSON estático con temporadas por mes/estación
- **Santoral**: JSON estático con santos por fecha (MM-DD)
- **Efemérides**: Cálculos solares/lunares basados en lat/lon

## 📦 Dependencias Backend Necesarias

Agregar a `backend/requirements.txt`:
- `feedparser` (para RSS)
- `pyephem` o `astral` (para astronomía - opcional, puede hacerse con cálculos propios)
- `google-api-python-client` (para Google Calendar - opcional)

