# Configuración del Radar Meteorológico (MapTiler Weather)

Para habilitar el radar meteorológico en el mapa, necesitas configurar un API key de MapTiler.

## Pasos:

### 1. Obtener API Key de MapTiler (Gratuito)

1. Ve a https://www.maptiler.com/cloud/
2. Crea una cuenta gratuita
3. En el dashboard, copia tu API key

### 2. Configurar el API Key

Tienes dos opciones:

#### Opción A: Variable de Entorno (Recomendado)

1. En la carpeta `dash-ui/`, copia el archivo `.env.example` a `.env`:
   ```bash
   cd dash-ui
   copy .env.example .env
   ```

2. Edita el archivo `.env` y reemplaza `TU_API_KEY_AQUI` con tu API key:
   ```
   VITE_MAPTILER_KEY=tu_api_key_real_aqui
   ```

3. Reinicia el servidor de desarrollo:
   ```bash
   npm run dev
   ```

#### Opción B: Configuración en la Interfaz

1. Ve a la página `/config` de tu aplicación
2. En la sección "Mapa Base", configura:
   - **Provider**: MapTiler
   - **API Key**: Tu API key de MapTiler
   - **Style URL**: `https://api.maptiler.com/maps/streets-v4/style.json?key=TU_API_KEY`
3. Guarda los cambios

## Verificación

Después de configurar el API key:

1. Recarga la página
2. El radar meteorológico debería aparecer en el mapa
3. No deberías ver el error `403 Forbidden` en la consola

## Notas

- El plan gratuito de MapTiler incluye 100,000 tiles/mes
- El archivo `.env` está en `.gitignore` por seguridad (no se sube a Git)
- Si usas la Opción A, el API key se aplicará automáticamente a todos los estilos de MapTiler
