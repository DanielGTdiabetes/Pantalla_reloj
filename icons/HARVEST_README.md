# Iconos de Frutas, Verduras y Hortalizas - Full-Color Ultra-Realistas

Este directorio contiene **23 iconos SVG ultra-realistas** de frutas, verduras y hortalizas con gradientes complejos, sombras y detalles hiperrealistas.

## Iconos Disponibles

### Frutas (9 iconos)
- **apple.svg** - Manzana roja brillante (también usado para naranja, mandarina, limón)
- **cherry.svg** - Cerezas rojas con tallo
- **grapes.svg** - Racimo de uvas moradas
- **peach.svg** - Melocotón dorado con rubor rosado
- **pear.svg** - Pera amarilla dorada
- **strawberry.svg** - Fresa roja con semillas doradas
- **melon.svg** - Melón amarillo con textura de red
- **watermelon.svg** - Sandía con corte mostrando pulpa roja y semillas
- **pumpkin.svg** - Calabaza naranja con surcos verticales

### Verduras (14 iconos)
- **broccoli.svg** - Brócoli verde con floretes detallados
- **lettuce.svg** - Lechuga con hojas rizadas en capas
- **chard.svg** - Acelga con tallos rosados y hojas verdes
- **cauliflower.svg** - Coliflor blanca con textura de floretes
- **carrot.svg** - Zanahoria naranja con hojas verdes (también para ajo, rábano)
- **beet.svg** - Remolacha roja oscura con hojas (también para cebolla)
- **pepper.svg** - Pimiento rojo alargado
- **tomato.svg** - Tomate rojo brillante con hojas
- **eggplant.svg** - Berenjena morada con tapa verde
- **cucumber.svg** - Pepino verde con espinas
- **zucchini.svg** - Calabacín verde con rayas longitudinales
- **corn.svg** - Mazorca de maíz con granos amarillos y hojas
- **bean.svg** - Vaina de judías verde con semillas visibles
- **artichoke.svg** - Alcachofa verde con pétalos espinosos

## Características de los Iconos

### Diseño Ultra-Realista
- **Gradientes radiales complejos** para volumen y profundidad 3D
- **Sombras suaves** con filtros SVG para efecto de elevación
- **Highlights brillantes** para simular luz natural
- **Texturas detalladas** (semillas, granos, espinas, surcos)
- **Colores vibrantes y naturales** con paletas realistas
- **Detalles finos** (hojas, tallos, pétalos, cráteres)

### Especificaciones Técnicas
- **ViewBox**: 0 0 512 512 (escalable sin pérdida)
- **Formato**: SVG vectorial (escalable a cualquier tamaño)
- **Estilo**: Full-color con gradientes y filtros SVG
- **Tamaño**: Optimizado para 48-80px en pantalla

## Uso en el Código

Los iconos se usan automáticamente en `HarvestCard` mediante el mapeo de nombres:

```tsx
// El mapeo se hace automáticamente desde el nombre del cultivo
// Ejemplo: "manzana" → apple.svg, "tomate" → tomato.svg
```

### Mapeo de Nombres

El componente `HarvestCard` incluye un mapeo completo de nombres en español a iconos:

- **Frutas cítricas**: naranja, mandarina, limón → `apple.svg`
- **Frutas de hueso**: cereza → `cherry.svg`, fresa → `strawberry.svg`, melocotón → `peach.svg`
- **Frutas de pepita**: pera → `pear.svg`
- **Uvas**: uva → `grapes.svg`
- **Melones**: melón → `melon.svg`, sandía → `watermelon.svg`
- **Calabazas**: calabaza → `pumpkin.svg`
- **Verduras de hoja**: lechuga → `lettuce.svg`, acelga → `chard.svg`, etc.
- **Raíces**: zanahoria, ajo, rábano → `carrot.svg`
- **Remolachas**: remolacha, cebolla → `beet.svg`
- **Legumbres**: guisante, judía → `bean.svg`
- **Solanáceas**: tomate → `tomato.svg`, pimiento → `pepper.svg`, berenjena → `eggplant.svg`
- **Cucurbitáceas**: pepino → `cucumber.svg`, calabacín → `zucchini.svg`
- **Otros**: alcachofa → `artichoke.svg`, maíz → `corn.svg`

## Detalles Visuales

Cada icono incluye:
- **Sombras realistas** debajo del objeto
- **Gradientes radiales** para profundidad 3D
- **Highlights** para simular luz natural desde arriba-izquierda
- **Texturas específicas** (semillas de fresa, granos de maíz, floretes de brócoli, etc.)
- **Hojas y tallos** con colores naturales y gradientes
- **Strokes sutiles** para definir bordes sin ser agresivos

## Añadir Nuevos Iconos

Si necesitas añadir un nuevo icono:

1. Crea el SVG en `dash-ui/public/icons/harvest/[nombre].svg`
2. Usa viewBox="0 0 512 512" para escalado consistente
3. Incluye gradientes radiales para volumen
4. Añade sombras con filtros SVG
5. Añade highlights para realismo
6. Actualiza el mapeo en `HarvestCard.tsx` si el nombre es nuevo

## Ejemplos de Calidad

Los iconos están diseñados con:
- **Sombras**: `filter="url(#shadow)"` con GaussianBlur
- **Gradientes**: `radialGradient` para volumen 3D
- **Highlights**: `ellipse` con opacidad para brillo
- **Texturas**: múltiples capas para detalles finos
- **Paletas realistas**: colores naturales vibrantes

¡Todos los iconos están listos para usar en producción con calidad ultra-realista!
