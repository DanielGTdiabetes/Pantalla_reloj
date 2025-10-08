# Dash UI Futurista

UI estática diseñada para funcionar en Raspberry Pi 4/5 (Chromium en modo kiosk) sirviendo archivos desde `/opt/dash` con `busybox httpd`.

## Requisitos

- Node.js 18+
- npm 9+

## Instalación y scripts

```bash
npm install
npm run dev
npm run build
```

`npm run dev` levanta el servidor de desarrollo de Vite en `http://localhost:5173`.

## Despliegue en Raspberry Pi

1. Ejecuta `npm run build`. El artefacto se generará en `dist/`.
2. Copia el contenido de `dist/` a `/opt/dash` en la Raspberry Pi (por ejemplo con `rsync` o `scp`).
3. Sirve la UI con Busybox:

   ```bash
   busybox httpd -f -p 8080 -h /opt/dash
   ```

   El navegador en modo kiosk puede apuntar a `http://localhost:8080`.

## Fondos y temas

- Las imágenes rotatorias viven en `src/assets/backgrounds/`. Sustituye las existentes por archivos `.webp` optimizados (~1280px) para actualizar la galería.
- El intervalo de rotación se controla desde `src/services/config.ts` mediante `BACKGROUND_ROTATION_MINUTES`.
- El tema predeterminado se define en el mismo archivo con `DEFAULT_THEME`.

## Power Save

Activa el modo de ahorro ajustando `powerSave` a `true` en `src/services/config.ts`. Esto reduce las animaciones, elimina filtros pesados y prioriza la estabilidad en Raspberry Pi 4.

## Mock de clima

El servicio `src/services/weather.ts` entrega un contrato estable:

```ts
{
  temp: number;
  condition: string;
  icon: 'cloud' | 'rain' | 'sun';
  precipProb: number;
  humidity: number;
  updatedAt: number;
}
```

Los datos se cachean en `localStorage` para mantenerse disponibles sin conexión.

## Bundle objetivo

Tras `npm run build` el bundle debe mantenerse por debajo de los 2 MB gracias a la separación de vendor y al árbol de dependencias optimizado.
