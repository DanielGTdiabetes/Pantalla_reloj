/**
 * Sistema de iconos de fase lunar full-color ultra-realistas.
 * 
 * Soporta 8-16 fases lunares con iconos detallados.
 */

export type MoonPhase =
  | "new"
  | "waxing-crescent-1"
  | "waxing-crescent-2"
  | "first-quarter"
  | "waxing-gibbous-1"
  | "waxing-gibbous-2"
  | "full"
  | "waning-gibbous-1"
  | "waning-gibbous-2"
  | "last-quarter"
  | "waning-crescent-1"
  | "waning-crescent-2";

/**
 * Obtiene la fase lunar desde una descripción de texto o porcentaje de iluminación.
 */
export function getMoonPhaseFromText(phase: string | null): MoonPhase {
  if (!phase || typeof phase !== "string") {
    return "new";
  }

  const normalized = phase.toLowerCase().trim();

  if (normalized.includes("nueva") || normalized.includes("new")) {
    return "new";
  }
  if (normalized.includes("llena") || normalized.includes("full")) {
    return "full";
  }
  if (normalized.includes("creciente")) {
    if (normalized.includes("cuarto")) {
      return "first-quarter";
    }
    return "waxing-crescent-1";
  }
  if (normalized.includes("menguante")) {
    if (normalized.includes("cuarto")) {
      return "last-quarter";
    }
    return "waning-crescent-1";
  }
  if (normalized.includes("gibosa") || normalized.includes("gibbous")) {
    if (normalized.includes("creciente") || normalized.includes("waxing")) {
      return "waxing-gibbous-1";
    }
    return "waning-gibbous-1";
  }

  return "new";
}

/**
 * Obtiene la fase lunar desde un porcentaje de iluminación (0-100).
 */
export function getMoonPhaseFromIllumination(illumination: number | null): MoonPhase {
  if (illumination === null || Number.isNaN(illumination)) {
    return "new";
  }

  // Normalizar a 0-100 si viene como decimal
  const illum = illumination > 1 ? illumination : illumination * 100;
  const normalized = Math.max(0, Math.min(100, illum));

  // Mapeo de porcentaje a fase (16 fases posibles)
  if (normalized <= 3) return "new";
  if (normalized <= 12) return "waxing-crescent-1";
  if (normalized <= 25) return "waxing-crescent-2";
  if (normalized <= 37) return "first-quarter";
  if (normalized <= 50) return "waxing-gibbous-1";
  if (normalized <= 62) return "waxing-gibbous-2";
  if (normalized <= 75) return "full";
  if (normalized <= 87) return "waning-gibbous-1";
  if (normalized <= 93) return "waning-gibbous-2";
  if (normalized <= 97) return "last-quarter";
  if (normalized <= 100) return "waning-crescent-1";

  return "new";
}

/**
 * Obtiene la ruta del icono de fase lunar.
 */
export function getMoonIconPath(phase: MoonPhase): string {
  const phaseMap: Record<MoonPhase, string> = {
    "new": "new",
    "waxing-crescent-1": "waxing-crescent-1",
    "waxing-crescent-2": "waxing-crescent-2",
    "first-quarter": "first-quarter",
    "waxing-gibbous-1": "waxing-gibbous-1",
    "waxing-gibbous-2": "waxing-gibbous-2",
    "full": "full",
    "waning-gibbous-1": "waning-gibbous-1",
    "waning-gibbous-2": "waning-gibbous-2",
    "last-quarter": "last-quarter",
    "waning-crescent-1": "waning-crescent-1",
    "waning-crescent-2": "waning-crescent-2",
  };

  const phaseName = phaseMap[phase] || "new";
  return `/icons/astronomy/moon/${phaseName}.svg`;
}

/**
 * Obtiene el emoji fallback para una fase lunar.
 */
export function getMoonIconEmoji(phase: MoonPhase): string {
  const emojiMap: Record<MoonPhase, string> = {
    "new": "🌑",
    "waxing-crescent-1": "🌒",
    "waxing-crescent-2": "🌒",
    "first-quarter": "🌓",
    "waxing-gibbous-1": "🌔",
    "waxing-gibbous-2": "🌔",
    "full": "🌕",
    "waning-gibbous-1": "🌖",
    "waning-gibbous-2": "🌖",
    "last-quarter": "🌗",
    "waning-crescent-1": "🌘",
    "waning-crescent-2": "🌘",
  };

  return emojiMap[phase] || "🌑";
}
