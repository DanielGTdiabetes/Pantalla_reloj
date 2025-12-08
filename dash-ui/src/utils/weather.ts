export const capitalize = (value: string): string => {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
};

const frozenKeywords = [
  "snow",
  "sleet",
  "hail",
  "aguanieve",
  "nieve",
  "granizo",
];

const normalize = (value: string | null | undefined): string => {
  return (value || "").trim();
};

export const sanitizeWeatherCondition = (
  rawCondition: string | null,
  temperatureC?: number | null
): string => {
  const condition = normalize(rawCondition);
  const lower = condition.toLowerCase();
  const hasFrozenKeyword = frozenKeywords.some((kw) => lower.includes(kw));
  const temp = typeof temperatureC === "number" && Number.isFinite(temperatureC)
    ? temperatureC
    : null;

  let result = condition || "Sin datos";
  if (temp !== null && temp > 11.5 && hasFrozenKeyword) {
    if (lower.includes("tormenta") || lower.includes("storm")) {
      result = "Tormenta";
    } else if (lower.includes("lluv")) {
      result = "Lluvia";
    } else if (lower.includes("niebla")) {
      result = "Niebla";
    } else {
      result = "Nublado";
    }
  }

  return capitalize(result);
};

const pickIconName = (condition: string): string => {
  const c = condition.toLowerCase();

  if (c.includes("tormenta") || c.includes("thunder") || c.includes("storm")) return "thunderstorm";
  if (c.includes("lluvia") || c.includes("rain") || c.includes("shower")) return "rain";
  if (c.includes("llovizna") || c.includes("drizzle")) return "drizzle";
  if (c.includes("nieve") || c.includes("snow") || c.includes("sleet") || c.includes("hail")) return "snow";
  if (c.includes("niebla") || c.includes("fog") || c.includes("bruma") || c.includes("mist")) return "fog";
  if (c.includes("cubierto") || c.includes("overcast")) return "overcast";
  if (c.includes("parcial") || c.includes("partly")) return "partly-cloudy";
  if (c.includes("nublado") || c.includes("cloud")) return "cloudy";
  if (c.includes("sol") || c.includes("sunny") || c.includes("clear") || c.includes("despejado")) return "sunny";

  return "unknown";
};

export const resolveWeatherIcon = (
  condition: string | null,
  options?: { isNight?: boolean }
): string => {
  const iconName = pickIconName(condition || "");
  const isNight = options?.isNight ?? false;
  const bucket = isNight ? "night" : "day";
  return `/icons/weather/${bucket}/${iconName}.svg`;
};
