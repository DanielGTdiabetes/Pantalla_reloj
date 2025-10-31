# Fase 3: Implementación de Datos del Panel Rotativo

## Estado Actual

### ✅ Cards Existentes
1. **TimeCard** - Hora/fecha (funciona con timezone)
2. **WeatherCard** - Clima (backend devuelve datos por defecto)
3. **CalendarCard** - Eventos de calendario (backend devuelve vacío)
4. **MoonCard** - Fase lunar (backend devuelve datos por defecto)
5. **HarvestCard** - Hortalizas/cultivos (backend devuelve vacío)
6. **SaintsCard** - Santos y onomásticos (backend devuelve vacío)
7. **NewsCard** - Noticias (backend devuelve datos por defecto)
8. **EphemeridesCard** - Efemérides (sol/luna)

### ❌ Backend Faltante
1. **Google Calendar API** - `/api/calendar` solo devuelve datos vacíos
2. **RSS Feeds** - `/api/news` solo devuelve datos por defecto
3. **Fases Lunares** - `/api/astronomy` solo devuelve datos estáticos
4. **Hortalizas Estacionales** - `/api/calendar.harvest` solo devuelve vacío

## Objetivos Fase 3

### 1. Google Calendar
- [ ] Modelo de configuración (`CalendarConfig`)
- [ ] Backend: Conexión a Google Calendar API
- [ ] Obtener eventos próximos (7-14 días)
- [ ] UI en `/config` para:
  - API key/credentials
  - Calendar ID
  - Número de días a mostrar

### 2. RSS Feeds
- [ ] Extender modelo `News` para incluir RSS feeds
- [ ] Backend: Parser RSS/Atom
- [ ] Múltiples feeds configurables (ej: periódico mediterráneo, xataka)
- [ ] UI en `/config` para:
  - Habilitar/deshabilitar noticias
  - Agregar/eliminar feeds RSS
  - Límite de artículos por feed
  - Intervalo de actualización

### 3. Fases Lunares
- [ ] Backend: Cálculo real de fase lunar (algoritmo astronómico)
- [ ] Iluminación lunar precisa
- [ ] Configuración mínima (no requiere UI en /config si es automático)

### 4. Hortalizas Estacionales
- [ ] Modelo de configuración (`HarvestConfig`)
- [ ] Backend: Base de datos de hortalizas con temporadas
- [ ] Datos por mes/estación para España (Castellón)
- [ ] UI en `/config` para:
  - Personalizar cultivos
  - Establecer temporadas personalizadas

## Plan de Implementación

### Prioridad 1: Modelos y Configuración
1. Extender `News` con RSS feeds
2. Crear `CalendarConfig` para Google Calendar
3. Crear `HarvestConfig` para hortalizas
4. Actualizar tipos TypeScript
5. UI en `/config`

### Prioridad 2: Backend Real
1. Google Calendar API client
2. RSS/Atom parser (usar `feedparser` o similar)
3. Algoritmo de fases lunares (usar `ephem` o cálculo propio)
4. Base de datos de hortalizas estacionales

### Prioridad 3: Testing y Validación
1. Probar con feeds reales
2. Verificar cálculo de fases lunares
3. Validar datos de hortalizas

## Notas Técnicas

- **Google Calendar API**: Requiere OAuth2 o API key (service account)
- **RSS Feeds**: Ejemplos:
  - Periódico Mediterráneo: `https://www.elperiodicomediterraneo.com/rss`
  - Xataka: `https://www.xataka.com/feed`
- **Fases Lunares**: Algoritmo simple o librería `pyephem`/`astral`
- **Hortalizas**: Base de datos por mes/estación (JSON estático o cálculo)

