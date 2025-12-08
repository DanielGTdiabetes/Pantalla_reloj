import { METEOBLUE_SYMBOL_TO_KIND, WEATHER_KIND_LABEL, type WeatherKind } from "../types/weather";

export const capitalize = (value: string): string => {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
};

const normalize = (value: string | null | undefined): string => {
  return (value || "").trim();
};

export const sanitizeWeatherCondition = (
  rawCondition: string | null,
  _temperatureC?: number | null
): string => {
  const condition = normalize(rawCondition);
  const result = condition || "Sin datos";
  return capitalize(result);
};

export const guessWeatherKindFromCondition = (condition: string | null | undefined): WeatherKind => {
  const lower = (condition || "").toLowerCase();
  if (!lower) return "unknown";

  if (lower.includes("tormenta") || lower.includes("thunder")) return "thunderstorm";
  if (lower.includes("lluv")) return "rain";
  if (lower.includes("llovizna") || lower.includes("drizzle")) return "rain";
  if (lower.includes("nieve")) return "snow";
  if (lower.includes("aguanieve") || lower.includes("sleet") || lower.includes("granizo")) return "sleet";
  if (lower.includes("niebla") || lower.includes("fog") || lower.includes("bruma") || lower.includes("mist")) return "fog";
  if (lower.includes("nublado") || lower.includes("cloud")) return "cloudy";
  if (lower.includes("parcial") || lower.includes("partly")) return "partly_cloudy";
  if (lower.includes("soleado") || lower.includes("despejado") || lower.includes("sunny") || lower.includes("clear")) return "clear";

  return "unknown";
};

export const mapMeteoblueSymbolToKind = (symbol?: number | null): WeatherKind => {
  if (symbol === null || symbol === undefined) return "unknown";
  return METEOBLUE_SYMBOL_TO_KIND[symbol] ?? "unknown";
};

export const resolveWeatherKind = (options: {
  symbol?: number | null;
  condition?: string | null;
  precipitation?: number | null;
}): WeatherKind => {
  const { symbol, condition, precipitation } = options;
  const symbolKind = mapMeteoblueSymbolToKind(symbol);
  if (symbolKind !== "unknown") return symbolKind;

  const conditionKind = guessWeatherKindFromCondition(condition);
  if (conditionKind !== "unknown") return conditionKind;

  if (typeof precipitation === "number" && precipitation > 0) {
    return "rain";
  }

  return "clear";
};

export const formatWeatherKindLabel = (kind: WeatherKind, fallback?: string | null): string => {
  if (kind in WEATHER_KIND_LABEL) return WEATHER_KIND_LABEL[kind];
  return fallback || WEATHER_KIND_LABEL.unknown;
};
