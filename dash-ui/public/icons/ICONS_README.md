# Iconos Full-Color Ultra-Realistas

Este directorio contiene iconos SVG ultra-realistas con gradientes complejos, sombras y detalles para máxima calidad visual.

## Estructura

```
icons/
├── weather/
│   ├── day/          # Iconos climáticos para día
│   │   ├── sunny.svg
│   │   ├── cloudy.svg
│   │   ├── partly-cloudy.svg
│   │   ├── rain.svg
│   │   ├── snow.svg
│   │   ├── thunderstorm.svg
│   │   └── unknown.svg
│   └── night/        # Iconos climáticos para noche
│       ├── sunny.svg
│       ├── cloudy.svg
│       ├── rain.svg
│       └── unknown.svg
├── astronomy/
│   ├── moon/         # Iconos de fase lunar
│   │   ├── new.svg
│   │   ├── waxing-crescent-1.svg
│   │   ├── first-quarter.svg
│   │   ├── full.svg
│   │   ├── last-quarter.svg
│   │   └── ...
│   └── sun/          # Iconos solares (futuro)
├── misc/             # Iconos misceláneos
│   ├── santoral.svg  # Cruz dorada para santoral
│   ├── calendar.svg   # Icono de calendario (futuro)
│   └── news.svg      # Icono de noticias (futuro)
└── harvest/          # Iconos de hortalizas (ya existen)
```

## Características de los Iconos

### Weather Icons (Iconos Climáticos)

- **Gradientes radiales complejos** para profundidad
- **Filtros de glow/blur** para efectos de luz
- **Sombras y highlights** para realismo 3D
- **Versiones día/noche** automáticas según hora
- **Fallback a emoji** si falla la carga

**Condiciones soportadas:**
- `sunny` / `clear` - Sol brillante
- `partly-cloudy` - Parcialmente nublado
- `cloudy` - Nublado
- `overcast` - Cubierto
- `rain` - Lluvia
- `drizzle` - Llovizna
- `snow` - Nieve
- `thunderstorm` - Tormenta
- `fog` / `mist` - Niebla/Bruma
- `haze` - Calima
- `unknown` - Condición desconocida

### Moon Icons (Iconos de Fase Lunar)

- **12 fases lunares detalladas** con cráteres
- **Gradientes sutiles** para simular superficie lunar
- **Efectos de glow** para luz lunar
- **Mapeo desde porcentaje de iluminación** (0-100%)
- **Mapeo desde texto** (nueva, llena, creciente, etc.)

**Fases soportadas:**
- `new` - Luna nueva
- `waxing-crescent-1/2` - Creciente (temprana/tardía)
- `first-quarter` - Cuarto creciente
- `waxing-gibbous-1/2` - Gibosa creciente
- `full` - Luna llena
- `waning-gibbous-1/2` - Gibosa menguante
- `last-quarter` - Cuarto menguante
- `waning-crescent-1/2` - Menguante

### Misc Icons (Iconos Misceláneos)

- **Santoral**: Cruz dorada con gradientes y glow
- **Calendar**: (pendiente)
- **News**: (pendiente)

## Uso en el Código

### WeatherIcon Component

```tsx
import { WeatherIcon } from "../components/WeatherIcon";

<WeatherIcon 
  condition="Lluvia"
  timezone="Europe/Madrid"
  size={80}
  alt="Condición climática"
/>
```

### MoonIcon Component

```tsx
import { MoonIcon } from "../components/MoonIcon";

<MoonIcon 
  phase="Luna llena"
  illumination={100}
  size={64}
  alt="Fase lunar"
/>
```

## Añadir Nuevos Iconos

1. Crea el SVG en la carpeta correspondiente
2. Usa gradientes radiales para profundidad
3. Añade filtros de glow/blur para efectos de luz
4. Incluye sombras y highlights para realismo
5. Asegúrate de que tenga viewBox="0 0 512 512" para escalado
6. Actualiza los mapeos en `weather-icons.ts` o `moon-icons.ts` si es necesario

## Calidad Ultra-Realista

Los iconos están diseñados con:
- **Gradientes complejos** (radial, linear)
- **Filtros SVG** (glow, blur, shadow)
- **Múltiples capas** para profundidad
- **Detalles finos** (cráteres, nubes, gotas de lluvia)
- **Paletas de colores realistas** (dorado para sol, plateado para luna, etc.)

Si necesitas aún más realismo, puedes reemplazar estos SVGs por imágenes PNG/WebP de alta calidad externas siguiendo el mismo sistema de mapeo.
