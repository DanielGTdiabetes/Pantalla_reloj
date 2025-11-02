/**
 * Utilidades para manejar timezone de forma segura.
 */

/**
 * Obtiene el timezone del sistema si está disponible.
 * @returns Timezone del sistema o null si no está disponible
 */
export function getSystemTimezone(): string | null {
  try {
    if (typeof Intl !== "undefined" && Intl.DateTimeFormat) {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
  } catch {
    // Ignorar errores
  }
  return null;
}

/**
 * Obtiene un timezone seguro desde la configuración.
 * Nunca devuelve undefined/null.
 * 
 * Orden de prioridad:
 * 1. config.display.timezone
 * 2. config.general.timezone (v2)
 * 3. System timezone (Intl.DateTimeFormat)
 * 4. 'Europe/Madrid' (fallback seguro)
 * 
 * @param config - Configuración de la aplicación
 * @returns Timezone válido (nunca undefined/null)
 */
export function safeGetTimezone(config: Record<string, unknown> | null | undefined): string {
  if (!config) {
    return getSystemTimezone() ?? "Europe/Madrid";
  }
  
  // Intentar display.timezone (v1)
  const display = config.display as Record<string, unknown> | undefined;
  if (display && typeof display.timezone === "string" && display.timezone.trim()) {
    return display.timezone.trim();
  }
  
  // Intentar general.timezone (v2 o normalizado)
  const general = config.general as Record<string, unknown> | undefined;
  if (general && typeof general.timezone === "string" && general.timezone.trim()) {
    return general.timezone.trim();
  }
  
  // Usar timezone del sistema si está disponible
  const systemTz = getSystemTimezone();
  if (systemTz) {
    return systemTz;
  }
  
  // Fallback seguro
  return "Europe/Madrid";
}

