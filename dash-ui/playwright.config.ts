import { defineConfig, devices } from '@playwright/test';

/**
 * Configuración de Playwright para tests E2E
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './e2e',
  /* Tiempo máximo para ejecutar un test completo */
  timeout: 30 * 1000,
  expect: {
    /* Tiempo máximo para expect() assertions */
    timeout: 5 * 1000
  },
  /* Ejecutar tests en paralelo */
  fullyParallel: true,
  /* No ejecutar tests en CI a menos que se especifique explícitamente */
  forbidOnly: !!process.env.CI,
  /* Reintentar en CI solo si fallan */
  retries: process.env.CI ? 2 : 0,
  /* Número de workers en CI, usar más en desarrollo local */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter para usar */
  reporter: 'html',
  /* Compartir configuraciones comunes para todos los proyectos */
  use: {
    /* URL base para usar en navegador actions como `await page.goto('/')` */
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5173',
    /* Collect trace cuando se reintenta el test fallido */
    trace: 'on-first-retry',
    /* Screenshot solo cuando falla */
    screenshot: 'only-on-failure',
  },

  /* Configurar proyectos para diferentes navegadores */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Servidor de desarrollo local para tests */
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});

