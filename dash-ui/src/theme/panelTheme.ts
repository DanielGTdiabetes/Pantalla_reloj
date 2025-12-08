import type { WeatherKind } from "../types/weather";

export type PanelTimeOfDay = 'night' | 'dawn' | 'day' | 'dusk';

export function getPanelTimeOfDay(now: Date): PanelTimeOfDay {
  const h = now.getHours();
  if (h < 6) return 'night';
  if (h < 9) return 'dawn';
  if (h < 19) return 'day';
  if (h < 22) return 'dusk';
  return 'night';
}

export function getPanelBackgroundClass(timeOfDay: PanelTimeOfDay): string {
  switch (timeOfDay) {
    case 'night':
      return 'panel-bg-night';
    case 'dawn':
      return 'panel-bg-dawn';
    case 'day':
      return 'panel-bg-day';
    case 'dusk':
      return 'panel-bg-dusk';
    default:
      return 'panel-bg-night';
  }
}

export function getWeatherBackgroundClass(kind: WeatherKind | null | undefined, timeOfDay: PanelTimeOfDay): string {
  switch (kind) {
    case 'clear':
      return timeOfDay === 'night' ? 'panel-bg-weather-clear-night' : 'panel-bg-weather-clear-day';
    case 'partly_cloudy':
      return timeOfDay === 'night' ? 'panel-bg-weather-partly-night' : 'panel-bg-weather-partly-day';
    case 'cloudy':
      return 'panel-bg-weather-cloudy';
    case 'fog':
      return 'panel-bg-weather-fog';
    case 'rain':
      return 'panel-bg-weather-rain';
    case 'sleet':
    case 'snow':
      return 'panel-bg-weather-snow';
    case 'thunderstorm':
      return 'panel-bg-weather-storm';
    default:
      return getPanelBackgroundClass(timeOfDay);
  }
}
