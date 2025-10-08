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
- El intervalo de rotación y el tema activo se sincronizan con el backend (`/api/config`) y pueden ajustarse desde el panel de Ajustes.
- El tema predeterminado se define en `src/services/config.ts` con `DEFAULT_THEME`; se sobrescribe al recibir configuración remota.

## Power Save

Activa el modo de ahorro ajustando `powerSave` a `true` en `src/services/config.ts`. Esto reduce las animaciones, elimina filtros pesados y prioriza la estabilidad en Raspberry Pi 4.

## Integración con backend

La UI consume el backend local en `http://127.0.0.1:8787/api`:

- `src/services/weather.ts` realiza polling cada 12 minutos con backoff exponencial y cachea el último dato en `localStorage`.
- `src/services/wifi.ts` y `src/components/SettingsPanel.tsx` ofrecen gestión completa de Wi-Fi vía `nmcli`.
- `src/services/tts.ts` permite listar voces y lanzar pruebas de audio.
- `src/context/DashboardConfigContext.tsx` centraliza la configuración compartida (tema, fondos, voz, etc.).

## Bundle objetivo

Tras `npm run build` el bundle debe mantenerse por debajo de los 2 MB gracias a la separación de vendor y al árbol de dependencias optimizado.
