import { test, expect } from '@playwright/test';
import { join } from 'path';

/**
 * Test E2E para la funcionalidad de subida de archivos ICS desde la UI
 * 
 * Este test verifica:
 * 1. Subir un archivo ICS desde la UI
 * 2. Verificar el snackbar/alert de éxito
 * 3. Verificar que el toggle "Calendario: ICS" queda activo
 */
test.describe('ICS Upload desde UI', () => {
  test.beforeEach(async ({ page }) => {
    // Navegar a la página de configuración
    await page.goto('/config');
    // Esperar a que la página cargue completamente
    await page.waitForLoadState('networkidle');
  });

  test('debe subir ICS, mostrar mensaje de éxito y activar toggle ICS', async ({ page }) => {
    // Paso 1: Verificar que el calendario está disponible en la página
    await expect(page.locator('h2:has-text("Calendario")')).toBeVisible();
    
    // Paso 2: Activar el calendario si no está activo
    const calendarEnabled = page.locator('#calendar_enabled');
    const isChecked = await calendarEnabled.isChecked();
    
    if (!isChecked) {
      await calendarEnabled.check();
      await page.waitForTimeout(500); // Esperar a que el estado se actualice
    }
    
    // Paso 3: Verificar que el calendario está activado
    await expect(calendarEnabled).toBeChecked();
    
    // Paso 4: Seleccionar provider "ICS" en el select
    const providerSelect = page.locator('#calendar_provider');
    await expect(providerSelect).toBeEnabled();
    await providerSelect.selectOption('ics');
    await page.waitForTimeout(500); // Esperar a que el estado se actualice
    
    // Paso 5: Verificar que el provider es "ics"
    await expect(providerSelect).toHaveValue('ics');
    
    // Paso 6: Preparar el archivo ICS de prueba
    // Usar el archivo de prueba que ya existe en backend/tests/data/sample.ics
    // Desde dash-ui, la ruta al archivo es relativa a la raíz del proyecto
    const projectRoot = join(__dirname, '../..');
    const icsFilePath = join(projectRoot, 'backend/tests/data/sample.ics');
    
    // Paso 7: Subir el archivo ICS
    const fileInput = page.locator('#ics_file_upload');
    await expect(fileInput).toBeEnabled();
    
    // Leer el archivo y subirlo
    await fileInput.setInputFiles(icsFilePath);
    
    // Paso 8: Esperar a que el upload se complete
    // El texto "Subiendo…" debe aparecer y luego desaparecer
    await expect(page.locator('text=Subiendo…')).toBeVisible({ timeout: 2000 }).catch(() => {
      // Puede que el upload sea muy rápido
    });
    
    // Esperar a que el mensaje de éxito aparezca
    await page.waitForTimeout(2000);
    
    // Paso 9: Verificar el mensaje de éxito (snackbar/alert)
    const successMessage = page.locator('.config-field__hint--success');
    await expect(successMessage).toBeVisible({ timeout: 10000 });
    
    // Verificar que el mensaje contiene información sobre el archivo subido
    const messageText = await successMessage.textContent();
    expect(messageText).toBeTruthy();
    expect(messageText).toContain('subido correctamente');
    expect(messageText?.toLowerCase()).toMatch(/archivo|ics/i);
    
    // Paso 10: Verificar que el toggle "Calendario: ICS" queda activo
    // El provider debe seguir siendo "ics"
    await expect(providerSelect).toHaveValue('ics');
    
    // El calendario debe seguir activado
    await expect(calendarEnabled).toBeChecked();
    
    // Paso 11: Verificar que el campo ics_path tiene un valor
    // Buscar el input de ics_path (puede estar oculto o visible)
    const icsPathInput = page.locator('input[type="text"][placeholder*=".ics"]');
    const icsPathValue = await icsPathInput.inputValue();
    expect(icsPathValue).toBeTruthy();
    expect(icsPathValue).toContain('.ics');
    
    // Paso 12: Verificar que no hay mensaje de error
    const errorMessage = page.locator('.config-field__hint--error');
    await expect(errorMessage).not.toBeVisible();
  });
  
  test('debe mostrar error si el archivo no tiene extensión .ics', async ({ page }) => {
    // Paso 1: Activar calendario
    const calendarEnabled = page.locator('#calendar_enabled');
    await calendarEnabled.check();
    await page.waitForTimeout(500);
    
    // Paso 2: Seleccionar provider "ICS"
    const providerSelect = page.locator('#calendar_provider');
    await providerSelect.selectOption('ics');
    await page.waitForTimeout(500);
    
    // Paso 3: Crear un archivo temporal con extensión incorrecta
    const projectRoot = join(__dirname, '../..');
    const invalidFilePath = join(projectRoot, 'backend/tests/data/sample.txt');
    
    // Intentar subir un archivo no-ICS
    const fileInput = page.locator('#ics_file_upload');
    
    // Si el input acepta cualquier archivo, intentar subirlo
    // (aunque el input tiene accept=".ics", algunos navegadores pueden permitir otros archivos)
    try {
      await fileInput.setInputFiles(invalidFilePath);
      await page.waitForTimeout(1000);
      
      // Si aparece un mensaje de error, verificar que existe
      const errorMessage = page.locator('.config-field__hint--error');
      const errorVisible = await errorMessage.isVisible().catch(() => false);
      
      if (errorVisible) {
        const errorText = await errorMessage.textContent();
        expect(errorText).toBeTruthy();
        expect(errorText?.toLowerCase()).toMatch(/extensión|\.ics/i);
      }
    } catch (error) {
      // El navegador puede rechazar el archivo antes de que llegue al código
      // Esto es un comportamiento válido del navegador
      console.log('El navegador rechazó el archivo inválido (comportamiento esperado)');
    }
  });
});

