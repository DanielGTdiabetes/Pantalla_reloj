# Tests E2E con Playwright

Este directorio contiene tests end-to-end (E2E) para la UI de Pantalla Reloj usando Playwright.

## Instalación

Para instalar Playwright y sus dependencias:

```bash
cd dash-ui
npm install
npx playwright install chromium
```

## Ejecutar tests

### Ejecutar todos los tests E2E

```bash
npm run test:e2e
```

### Ejecutar tests con UI interactiva

```bash
npm run test:e2e:ui
```

### Ejecutar un test específico

```bash
npx playwright test ics-upload.spec.ts
```

## Configuración

La configuración de Playwright está en `playwright.config.ts`. Por defecto:

- Base URL: `http://127.0.0.1:5173` (servidor de desarrollo Vite)
- Navegador: Chromium (Desktop Chrome)
- Timeout: 30 segundos por test
- El servidor de desarrollo se inicia automáticamente antes de ejecutar los tests

Para cambiar la base URL, usa la variable de entorno:

```bash
PLAYWRIGHT_BASE_URL=http://localhost:8080 npm run test:e2e
```

## Tests disponibles

### `ics-upload.spec.ts`

Test E2E que verifica la funcionalidad de subida de archivos ICS desde la UI:

1. **Sube un archivo ICS**: Verifica que se puede subir un archivo `.ics` desde la UI
2. **Mensaje de éxito**: Verifica que aparece el snackbar/alert de éxito después de subir
3. **Toggle activo**: Verifica que el toggle "Calendario: ICS" queda activo

**Requisitos**:
- El backend debe estar ejecutándose en `http://127.0.0.1:8081`
- El archivo de prueba `backend/tests/data/sample.ics` debe existir

## Debugging

Para ejecutar tests en modo debug (con inspector):

```bash
npx playwright test --debug
```

Para ejecutar un test específico en modo debug:

```bash
npx playwright test ics-upload.spec.ts --debug
```

Para ver el reporte HTML después de ejecutar tests:

```bash
npx playwright show-report
```

## CI/CD

Para ejecutar tests en CI, asegúrate de:

1. Tener el backend ejecutándose en `http://127.0.0.1:8081`
2. Configurar `CI=true` para usar retries y configuración específica de CI
3. Usar headless mode (por defecto en CI)

```bash
CI=true npm run test:e2e
```

