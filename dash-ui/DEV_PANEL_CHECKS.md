# Validación rápida del panel lateral derecho

Este paquete verifica que el panel lateral (1920×480) renderiza correctamente los bloques de reloj, tiempo, predicción, AIS/barcos, aviones, astronomía, NASA APOD, santoral, noticias y efemérides.

## Cómo ejecutar los tests automáticos

1. Instala dependencias en `dash-ui` si es necesario: `npm install`.
2. Lanza solo las pruebas del panel derecho:

```bash
npm run test:right-panel
```

Los tests validan iconos, textos clave, presencia de data-testid y ausencia de scrollbars visibles en los contenedores auto-scroll.

## Qué comprobar manualmente (Dani)

Checklist visual a ejecutar por Dani:

### Reloj
- Panel sin icono de sol ni título “Reloj”.
- Hora y fecha completa visibles, sin cortar.

### Tiempo actual
- Icono de clima visible.
- Estado coherente (nada de “aguanieve” con 15–20°C).

### Predicción semanal
- Iconos por día visibles.
- Nada de nieve rara si hace buena temperatura.

### Barcos
- Icono del panel sin cuadro blanco.
- Se ve el nombre del barco, velocidad y rumbo claramente.

### Astronomía
- Iconos para sol, luna, amanecer/atardecer correctos y uniformes.

### NASA APOD
- Si es foto → se ve la imagen.
- Si es vídeo → se ve icono/thumbnail, el panel no queda vacío.
- El texto se desplaza solo; no hay barra de scroll visible.

### Santoral
- Sin icono de sol.
- Lista se desplaza sola si hay muchos nombres.

### Noticias
- Texto legible, sin URLs largas.
- Si hay muchas, el contenido se mueve solo.

### Efemérides
- Hay icono en el título.
- Cada frase empieza por mayúscula.

### Aviones
- Si hay vuelos cerca → se muestra al menos uno.
- Si no hay, aparece el mensaje “Sin vuelos cercanos” o similar.

