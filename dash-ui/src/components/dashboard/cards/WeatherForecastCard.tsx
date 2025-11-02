import { CloudIcon } from "../../icons";

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

  return (
    <div className="card weather-forecast-card">
      <div className="weather-forecast-card__header">
        <CloudIcon className="card-icon" aria-hidden="true" />
        <h2>Pronóstico Semanal</h2>
      </div>
      <div className="weather-forecast-card__content">
        {forecastDays.length > 0 ? (
          <div className="weather-forecast-card__list">
            {forecastDays.map((day, index) => {
              const dayName = day.dayName || formatDayName(day.date);
              const iconPath = getWeatherIcon(day.condition);
              
              return (
                <div key={`forecast-${index}`} className="weather-forecast-card__day">
                  <div className="weather-forecast-card__day-header">
                    <span className="weather-forecast-card__day-name">{dayName}</span>
                    <img
                      src={iconPath}
                      alt={day.condition || "Condición climática"}
                      className="weather-forecast-card__icon"
                      style={{ width: "32px", height: "32px" }}
                      onError={(e) => {
                        console.warn(`[WeatherForecastCard] Error al cargar icono: ${iconPath} para ${day.condition}`);
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </div>
                  <div className="weather-forecast-card__day-temps">
                    <span className="weather-forecast-card__temp-max">
                      {formatTemperature(day.temperature.max, unit)}
                    </span>
                    <span className="weather-forecast-card__temp-min">
                      {formatTemperature(day.temperature.min, unit)}
                    </span>
                  </div>
                  {day.precipitation !== null && day.precipitation !== undefined && (
                    <span className="weather-forecast-card__precipitation">
                      <img
                        src="/icons/weather/rainy.svg"
                        alt="Precipitación"
                        style={{ width: "16px", height: "16px", verticalAlign: "middle", marginRight: "4px" }}
                        onError={(e) => {
                          console.warn(`[WeatherForecastCard] Error al cargar icono de precipitación`);
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                      {Math.round(day.precipitation)}%
                    </span>
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
