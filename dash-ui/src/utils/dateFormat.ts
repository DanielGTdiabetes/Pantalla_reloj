/**
 * Utilidades para formatear fechas/horas usando el timezone del config.
 */

/**
 * Formatea una fecha/hora ISO usando el timezone del config.
 * @param dtIso - Fecha/hora en formato ISO (p. ej., "2025-01-15T10:30:00Z")
 * @param config - Configuración de la aplicación (opcional)
 * @param options - Opciones adicionales para Intl.DateTimeFormat
 * @returns Fecha/hora formateada en el timezone del config
 */
export function formatLocal(
  dtIso: string | Date | null | undefined,
  config?: Record<string, unknown> | null,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (!dtIso) {
    return "";
  }
  
  // Obtener timezone del config con fallback seguro usando getters seguros
  const display = config?.display as Record<string, unknown> | undefined;
  const general = config?.general as Record<string, unknown> | undefined;
  
  const tzFromDisplay = display?.timezone;
  const tzFromGeneral = general?.timezone;
  
  const tz = (typeof tzFromDisplay === "string" && tzFromDisplay.trim()
    ? tzFromDisplay.trim()
    : typeof tzFromGeneral === "string" && tzFromGeneral.trim()
    ? tzFromGeneral.trim()
    : "Europe/Madrid");
  
  const tzStr = typeof tz === "string" && tz.trim() ? tz.trim() : "Europe/Madrid";
  
  // Convertir a Date si es string
  const date = typeof dtIso === "string" ? new Date(dtIso) : dtIso;
  
  if (isNaN(date.getTime())) {
    if (typeof console !== "undefined" && console.warn) {
      console.warn("[dateFormat] Invalid date:", dtIso);
    }
    return "";
  }
  
  // Opciones por defecto (hora y minuto)
  const defaultOptions: Intl.DateTimeFormatOptions = {
    timeZone: tzStr,
    hour: "2-digit",
    minute: "2-digit",
    ...options,
  };
  
  try {
    return new Intl.DateTimeFormat(undefined, defaultOptions).format(date);
  } catch (error) {
    if (typeof console !== "undefined" && console.warn) {
      console.warn("[dateFormat] Failed to format date with timezone", tzStr, error);
    }
    // Fallback sin timezone
    return new Intl.DateTimeFormat(undefined, { ...defaultOptions, timeZone: undefined }).format(date);
  }
}

/**
 * Formatea una fecha completa (día, mes, año) usando el timezone del config.
 * @param dtIso - Fecha/hora en formato ISO
 * @param config - Configuración de la aplicación (opcional)
 * @returns Fecha formateada (p. ej., "15/01/2025")
 */
export function formatLocalDate(
  dtIso: string | Date | null | undefined,
  config?: Record<string, unknown> | null,
): string {
  return formatLocal(dtIso, config, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/**
 * Formatea una fecha y hora completas usando el timezone del config.
 * @param dtIso - Fecha/hora en formato ISO
 * @param config - Configuración de la aplicación (opcional)
 * @returns Fecha y hora formateadas (p. ej., "15/01/2025, 10:30")
 */
export function formatLocalDateTime(
  dtIso: string | Date | null | undefined,
  config?: Record<string, unknown> | null,
): string {
  return formatLocal(dtIso, config, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

