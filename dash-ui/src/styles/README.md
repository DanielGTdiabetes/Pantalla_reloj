# Sistema de Estilos - Pantalla Reloj

## Estructura de Archivos

- `variables.css` - Variables CSS globales
- `themes.css` - Temas día/noche
- `typography.css` - Sistema tipográfico
- `animations.css` - Animaciones y transiciones
- `card-enhancements.css` - Estilos de paneles
- `shadows.css` - Sistema de sombras
- `effects.css` - Efectos especiales (glassmorphism, skeletons)
- `accessibility.css` - Mejoras de accesibilidad
- `global.css` - Estilos globales base

## Uso de Variables

### Tipografía

```css
var(--font-size-display)   /* 6rem - Hora principal */
var(--font-size-title)     /* 3.5rem - Títulos */
var(--font-size-data)      /* 4rem - Datos importantes */
var(--font-size-subtitle)  /* 2rem - Subtítulos */
var(--font-size-body)      /* 1.8rem - Texto normal */
var(--font-size-caption)   /* 1.4rem - Texto pequeño */
```

### Espaciado

```css
var(--space-xs)  /* 8px */
var(--space-sm)  /* 16px */
var(--space-md)  /* 24px */
var(--space-lg)  /* 32px */
var(--space-xl)  /* 48px */
```

### Transiciones

```css
var(--transition-fast)    /* 0.2s ease */
var(--transition-normal)  /* 0.4s ease */
var(--transition-slow)    /* 0.6s cubic-bezier */
```

### Sombras

```css
var(--shadow-sm)  /* Sombra pequeña */
var(--shadow-md)  /* Sombra media */
var(--shadow-lg)  /* Sombra grande */
var(--shadow-xl)  /* Sombra extra grande */
```

## Temas

El tema se cambia automáticamente según la hora:

- **Día (7:00-20:00)**: Fondo claro, texto oscuro
- **Noche (20:00-7:00)**: Fondo oscuro, texto claro

El tema se aplica mediante el atributo `data-theme` en el elemento raíz:

```css
[data-theme="day"] {
  /* Estilos para modo día */
}

[data-theme="night"] {
  /* Estilos para modo noche */
}
```

## Animaciones Disponibles

### Transiciones

- `fadeIn` - Entrada con fade
- `slideInFade` - Entrada con slide y fade
- `scaleIn` - Escala al aparecer
- `slideIn` - Deslizamiento suave

### Efectos Ambientales

- `breathe` - Respiración sutil (3s)
- `pulse` - Pulso (2s)
- `blink` - Parpadeo (1s)
- `shimmer` - Efecto shimmer para skeletons (2s)

### Clases Utilitarias

```css
.breathe-effect    /* Aplicar efecto de respiración */
.pulse-effect      /* Aplicar efecto de pulso */
.blink             /* Aplicar parpadeo */
.smooth-transition /* Transición suave en todos los cambios */
```

## Efectos Especiales

### Glassmorphism

```css
.glass       /* Efecto de vidrio claro */
.glass-dark  /* Efecto de vidrio oscuro */
```

### Skeleton Loaders

```tsx
<SkeletonLoader variant="text" count={3} />
<SkeletonLoader variant="circle" width={48} height={48} />
<SkeletonLoader variant="rect" width="100%" height={200} />
<SkeletonLoader variant="card" width="100%" height={400} />
```

### Sombras

```css
.elevation-1  /* Sombra pequeña */
.elevation-2  /* Sombra media */
.elevation-3  /* Sombra grande */
.elevation-4  /* Sombra extra grande */
```

## Efectos Ambientales

Los efectos ambientales se muestran automáticamente según las condiciones meteorológicas:

- **Nieve**: Cuando la condición incluye "nieve" o "snow"
- **Lluvia**: Cuando la condición incluye "lluvia" o "rain"
- **Estrellas**: En modo noche cuando está despejado

## Accesibilidad

El sistema respeta automáticamente:

- `prefers-reduced-motion` - Reduce animaciones
- `prefers-contrast` - Aumenta contraste
- `prefers-color-scheme` - Respeta esquema de color del sistema

## Mejores Prácticas

1. **Usar variables CSS** en lugar de valores hardcodeados
2. **Respetar el tema** usando variables de tema (`--theme-*`)
3. **Aplicar transiciones** a elementos interactivos
4. **Usar skeleton loaders** mientras cargan los datos
5. **Optimizar rendimiento** limitando animaciones complejas

## Ejemplos de Uso

### Card con Glassmorphism

```tsx
<div className="card glass">
  {/* Contenido */}
</div>
```

### Texto con Sombra

```tsx
<h1 className="text-shadow-md">
  Título Principal
</h1>
```

### Elemento Interactivo

```tsx
<button className="interactive">
  Click me
</button>
```

### Skeleton Loader

```tsx
{loading ? (
  <SkeletonLoader variant="card" />
) : (
  <ActualContent />
)}
```

## Rendimiento

- Las animaciones usan `transform` y `opacity` para mejor rendimiento
- Los efectos ambientales se limitan a 50 partículas máximo
- Se respeta `prefers-reduced-motion` automáticamente
- Los efectos se desactivan en dispositivos de bajo rendimiento

