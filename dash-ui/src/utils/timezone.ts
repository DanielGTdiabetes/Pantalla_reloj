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
    const fallback = getSystemTimezone() ?? "Europe/Madrid";
    if (typeof console !== "undefined" && console.warn) {
      console.warn("[config] timezone missing, using Europe/Madrid fallback");
    }
    return fallback;
  }
  
  // Usar getters seguros para evitar crashes
  // Intentar display.timezone (v1) con null-safe access
  const display = config?.display as Record<string, unknown> | undefined;
  const tzFromDisplay = display?.timezone;
  if (typeof tzFromDisplay === "string" && tzFromDisplay.trim()) {
    return tzFromDisplay.trim();
  }
  
  // Intentar general.timezone (v2 o normalizado) con null-safe access
  const general = config?.general as Record<string, unknown> | undefined;
  const tzFromGeneral = general?.timezone;
  if (typeof tzFromGeneral === "string" && tzFromGeneral.trim()) {
    return tzFromGeneral.trim();
  }
  
  // Usar timezone del sistema si está disponible
  const systemTz = getSystemTimezone();
  if (systemTz) {
    return systemTz;
  }
  
  // Fallback seguro con advertencia
  if (typeof console !== "undefined" && console.warn) {
    console.warn("[config] timezone missing, using Europe/Madrid fallback");
  }
  return "Europe/Madrid";
}

