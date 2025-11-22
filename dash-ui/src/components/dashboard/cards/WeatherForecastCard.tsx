import { CloudIcon } from "../../icons";
import { AnimatedWeatherIcon } from "../../icons/AnimatedWeatherIcons";

type ForecastDay = {
  date: string;
  dayName?: string;
  condition: string;
  temperature: {
    min: number | null;
    max: number | null;
  };
  precipitation?: number | null;
  wind?: number | null;
  humidity?: number | null;
};

type WeatherForecastCardProps = {
  forecast: ForecastDay[];
  unit?: string;
};

// Normalizar temperatura para gráfico (0-100%)
const normalizeTemp = (temp: number | null, minTemp: number, maxTemp: number): number => {
  if (temp === null || Number.isNaN(temp)) return 0;
  if (maxTemp === minTemp) return 50;
  return ((temp - minTemp) / (maxTemp - minTemp)) * 100;
};

// Obtener color según temperatura
const getTempColor = (temp: number | null, isMax: boolean): string => {
  if (temp === null || Number.isNaN(temp)) return "#868e96";
  if (temp >= 25) return isMax ? "#ff6b6b" : "#ff8787";
  if (temp >= 15) return isMax ? "#ffd43b" : "#ffe066";
  if (temp >= 5) return isMax ? "#4dabf7" : "#74c0fc";
  return isMax ? "#339af0" : "#51cf66";
};

const getWeatherIcon = (condition: string | null): string => {
  if (!condition) {
    return "/icons/weather/cloudy.svg";
  }

  const conditionLower = condition.toLowerCase().trim();

  // Mapeo de condiciones climáticas a iconos SVG
  const iconMap: Record<string, string> = {
    // Soleado
    "soleado": "sunny",
    "sunny": "sunny",
    "clear": "sunny",
    "despejado": "sunny",
    "cielo despejado": "sunny",

    // Parcialmente nublado
    "parcialmente nublado": "partly-cloudy",
    "partly cloudy": "partly-cloudy",
    "poco nuboso": "partly-cloudy",
    "intervalos nubosos": "partly-cloudy",
    "nubes y claros": "partly-cloudy",

    // Nublado
    "nublado": "cloudy",
    "cloudy": "cloudy",
    "cubierto": "cloudy",
    "muy nuboso": "cloudy",
    "nuboso": "cloudy",

    // Lluvia
    "lluvia": "rainy",
    "rainy": "rainy",
    "rain": "rainy",
    "lluvioso": "rainy",
    "precipitaciones": "rainy",
    "chubascos": "rainy",
    "lluvias": "rainy",

    // Tormenta
    "tormenta": "stormy",
    "storm": "stormy",
    "stormy": "stormy",
    "tormentas": "stormy",
    "temporal": "stormy",
    "tormenta eléctrica": "stormy",

    // Nieve
    "nieve": "snowy",
    "snow": "snowy",
    "snowy": "snowy",
    "nevadas": "snowy",
    "nevando": "snowy",

    // Niebla
    "niebla": "misty",
    "mist": "misty",
    "misty": "misty",
    "fog": "misty",
    "neblina": "misty",
    "bruma": "misty",
  };

  // Buscar coincidencia exacta
  if (iconMap[conditionLower]) {
    return `/icons/weather/${iconMap[conditionLower]}.svg`;
  }

  // Buscar coincidencia parcial
  for (const [key, value] of Object.entries(iconMap)) {
    if (conditionLower.includes(key) || key.includes(conditionLower)) {
      return `/icons/weather/${value}.svg`;
    }
  }

  // Fallback: nublado si no hay coincidencia
  return "/icons/weather/cloudy.svg";
};

const formatDayName = (dateStr: string): string => {
  try {
    const date = new Date(dateStr);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Comparar solo fechas (sin hora)
    const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const tomorrowOnly = new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate());

    if (dateOnly.getTime() === todayOnly.getTime()) {
      return "Hoy";
    }
    if (dateOnly.getTime() === tomorrowOnly.getTime()) {
      return "Mañana";
    }

    // Para otros días, usar nombre abreviado
    const days = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
    return days[date.getDay()] || dateStr;
  } catch {
    return dateStr;
  }
};

const formatTemperature = (value: number | null, suffix: string): string => {
  if (value === null || Number.isNaN(value)) {
    return "--";
  }
  return `${Math.round(value)}${suffix}`;
};

export const WeatherForecastCard = ({ forecast, unit = "°C" }: WeatherForecastCardProps): JSX.Element => {
  const forecastDays = forecast.length > 0 ? forecast.slice(0, 7) : [];

  // Calcular min/max globales para normalización
  const allTemps = forecastDays.flatMap(day => [
    day.temperature.min,
    day.temperature.max
  ]).filter((temp): temp is number => temp !== null && !Number.isNaN(temp));
  
  const globalMin = allTemps.length > 0 ? Math.min(...allTemps) : 0;
  const globalMax = allTemps.length > 0 ? Math.max(...allTemps) : 30;

  return (
    <div className="card weather-forecast-card weather-forecast-card-enhanced">
      <div className="weather-forecast-card__header">
        <CloudIcon className="card-icon" aria-hidden="true" />
        <h2>Pronóstico Semanal</h2>
      </div>
      <div className="weather-forecast-card__content">
        {forecastDays.length > 0 ? (
          <div className="forecast-grid">
            {forecastDays.map((day, index) => {
              const dayName = day.dayName || formatDayName(day.date);
              const tempMax = day.temperature.max;
              const tempMin = day.temperature.min;
              const maxHeight = tempMax !== null ? normalizeTemp(tempMax, globalMin, globalMax) : 0;
              const minHeight = tempMin !== null ? normalizeTemp(tempMin, globalMin, globalMax) : 0;
              
              return (
                <div key={`forecast-${index}`} className="forecast-day">
                  <span className="forecast-day__name">{dayName}</span>
                  <AnimatedWeatherIcon 
                    condition={day.condition} 
                    size={40}
                    className="forecast-day__icon"
                  />
                  <div className="temp-bars">
                    {tempMax !== null && (
                      <div 
                        className="temp-bar max" 
                        style={{ 
                          height: `${Math.max(20, maxHeight)}%`,
                          background: getTempColor(tempMax, true)
                        }}
                      >
                        <span className="temp-label">{formatTemperature(tempMax, unit)}</span>
                      </div>
                    )}
                    {tempMin !== null && (
                      <div 
                        className="temp-bar min" 
                        style={{ 
                          height: `${Math.max(20, minHeight)}%`,
                          background: getTempColor(tempMin, false)
                        }}
                      >
                        <span className="temp-label">{formatTemperature(tempMin, unit)}</span>
                      </div>
                    )}
                  </div>
                  {day.precipitation !== null && day.precipitation !== undefined && (
                    <div className="precipitation">
                      <div className="precip-bar">
                        <div 
                          className="precip-bar-fill"
                          style={{ width: `${Math.min(100, day.precipitation)}%` }}
                        />
                      </div>
                      <span style={{ fontSize: "0.75rem", color: "var(--theme-text-muted)" }}>
                        {Math.round(day.precipitation)}%
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="weather-forecast-card__empty">Sin datos de pronóstico disponibles</p>
        )}
      </div>
    </div>
  );
};

export default WeatherForecastCard;
