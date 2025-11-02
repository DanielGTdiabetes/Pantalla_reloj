/**
 * Sistema de mapeo de condiciones climáticas a iconos full-color ultra-realistas.
 * 
 * Soporta iconos día/noche y fallbacks automáticos.
 */

export type WeatherCondition =
  | "clear"
  | "sunny"
  | "partly-cloudy"
  | "cloudy"
  | "overcast"
  | "rain"
  | "drizzle"
  | "snow"
  | "sleet"
  | "hail"
  | "thunderstorm"
  | "fog"
  | "mist"
  | "dust"
  | "sand"
  | "smoke"
  | "haze"
  | "tornado"
  | "hurricane"
  | "unknown";

export type TimeOfDay = "day" | "night";

/**
 * Normaliza una condición climática del backend a un tipo conocido.
 */
export function normalizeWeatherCondition(condition: string | null | undefined): WeatherCondition {
  if (!condition || typeof condition !== "string") {
    return "unknown";
  }

  const normalized = condition.toLowerCase().trim();

  // Clear/Sunny
  if (normalized.includes("clear") || normalized.includes("sunny") || normalized.includes("despejado")) {
    return "sunny";
  }

  // Partly cloudy
  if (normalized.includes("partly") || normalized.includes("poco nublado") || normalized.includes("parcial")) {
    return "partly-cloudy";
  }

  // Cloudy/Overcast
  if (normalized.includes("overcast") || normalized.includes("nublado") || normalized.includes("cubierto")) {
    return "overcast";
  }
  if (normalized.includes("cloudy") || normalized.includes("nubes")) {
    return "cloudy";
  }

  // Rain
  if (normalized.includes("rain") || normalized.includes("lluvia") || normalized.includes("llover")) {
    if (normalized.includes("drizzle") || normalized.includes("llovizna")) {
      return "drizzle";
    }
    return "rain";
  }

  // Snow
  if (normalized.includes("snow") || normalized.includes("nieve") || normalized.includes("nevando")) {
    return "snow";
  }

  // Sleet
  if (normalized.includes("sleet") || normalized.includes("aguanieve") || normalized.includes("chubasco")) {
    return "sleet";
  }

  // Hail
  if (normalized.includes("hail") || normalized.includes("granizo")) {
    return "hail";
  }

  // Thunderstorm
  if (
    normalized.includes("thunder") ||
    normalized.includes("storm") ||
    normalized.includes("tormenta") ||
    normalized.includes("rayos")
  ) {
    return "thunderstorm";
  }

  // Fog/Mist
  if (normalized.includes("fog") || normalized.includes("niebla")) {
    return "fog";
  }
  if (normalized.includes("mist") || normalized.includes("bruma")) {
    return "mist";
  }

  // Haze
  if (normalized.includes("haze") || normalized.includes("calima")) {
    return "haze";
  }

  // Dust/Sand
  if (normalized.includes("dust") || normalized.includes("polvo")) {
    return "dust";
  }
  if (normalized.includes("sand") || normalized.includes("arena")) {
    return "sand";
  }

  // Smoke
  if (normalized.includes("smoke") || normalized.includes("humo")) {
    return "smoke";
  }

  // Extreme weather
  if (normalized.includes("tornado")) {
    return "tornado";
  }
  if (normalized.includes("hurricane") || normalized.includes("huracán")) {
    return "hurricane";
  }

  return "unknown";
}

/**
 * Determina si es de día o de noche basado en la hora actual.
 */
export function getTimeOfDay(timezone: string): TimeOfDay {
  const now = new Date();
  const hour = new Intl.DateTimeFormat("es-ES", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  }).format(now);

  const hourNum = parseInt(hour, 10);
  // Considerar día entre 6 AM y 8 PM
  return hourNum >= 6 && hourNum < 20 ? "day" : "night";
}

/**
 * Obtiene la ruta del icono full-color para una condición climática.
 */
export function getWeatherIconPath(condition: WeatherCondition, timeOfDay: TimeOfDay): string {
  const basePath = "/icons/weather";
  const timePath = timeOfDay === "day" ? "day" : "night";

  // Mapeo de condiciones a nombres de archivo
  const iconMap: Record<WeatherCondition, string> = {
    clear: "clear",
    sunny: "sunny",
    "partly-cloudy": "partly-cloudy",
    cloudy: "cloudy",
    overcast: "overcast",
    rain: "rain",
    drizzle: "drizzle",
    snow: "snow",
    sleet: "sleet",
    hail: "hail",
    thunderstorm: "thunderstorm",
    fog: "fog",
    mist: "mist",
    dust: "dust",
    sand: "sand",
    smoke: "smoke",
    haze: "haze",
    tornado: "tornado",
    hurricane: "hurricane",
    unknown: "unknown",
  };

  const iconName = iconMap[condition] || "unknown";
  return `${basePath}/${timePath}/${iconName}.svg`;
}

/**
 * Obtiene el emoji fallback para una condición climática.
 */
export function getWeatherIconEmoji(condition: WeatherCondition, timeOfDay: TimeOfDay): string {
  const emojiMap: Record<WeatherCondition, { day: string; night: string }> = {
    clear: { day: "☀️", night: "🌙" },
    sunny: { day: "☀️", night: "🌙" },
    "partly-cloudy": { day: "⛅", night: "☁️" },
    cloudy: { day: "☁️", night: "☁️" },
    overcast: { day: "☁️", night: "☁️" },
    rain: { day: "🌧️", night: "🌧️" },
    drizzle: { day: "🌦️", night: "🌧️" },
    snow: { day: "🌨️", night: "🌨️" },
    sleet: { day: "🌨️", night: "🌨️" },
    hail: { day: "⛈️", night: "⛈️" },
    thunderstorm: { day: "⛈️", night: "⛈️" },
    fog: { day: "🌫️", night: "🌫️" },
    mist: { day: "🌫️", night: "🌫️" },
    dust: { day: "🌪️", night: "🌪️" },
    sand: { day: "🌪️", night: "🌪️" },
    smoke: { day: "💨", night: "💨" },
    haze: { day: "🌫️", night: "🌫️" },
    tornado: { day: "🌪️", night: "🌪️" },
    hurricane: { day: "🌀", night: "🌀" },
    unknown: { day: "❓", night: "❓" },
  };

  return emojiMap[condition]?.[timeOfDay] || "❓";
}
