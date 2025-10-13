import { apiRequest } from './config';

export type WeatherIcon = 'cloud' | 'rain' | 'sun' | 'snow' | 'storm' | 'fog';

export interface WeatherToday {
  temp: number;
  min: number;
  max: number;
  rainProb: number;
  condition: string;
  icon: WeatherIcon;
  city: string;
  updatedAt: number;
  cached?: boolean;
}

export interface WeatherDay {
  day: string;
  date: string;
  min: number;
  max: number;
  rainProb: number;
  stormProb: number;
  condition: string;
  icon: WeatherIcon;
}

interface WeatherTodayResponse {
  temp: number;
  min: number;
  max: number;
  rain_prob: number;
  condition: string;
  icon: WeatherIcon;
  city: string;
  updated_at: number;
  cached?: boolean;
}

interface WeatherWeeklyResponse {
  days: Array<{
    day: string;
    date: string;
    min: number;
    max: number;
    rain_prob: number;
    storm_prob: number;
    condition: string;
    icon: WeatherIcon;
  }>;
  updated_at: number;
  cached?: boolean;
}

function normalizeToday(payload: WeatherTodayResponse): WeatherToday {
  return {
    temp: payload.temp,
    min: payload.min,
    max: payload.max,
    rainProb: payload.rain_prob,
    condition: payload.condition,
    icon: payload.icon,
    city: payload.city,
    updatedAt: payload.updated_at,
    cached: payload.cached,
  };
}

function normalizeWeekly(payload: WeatherWeeklyResponse): WeatherDay[] {
  return payload.days.map((day) => ({
    day: day.day,
    date: day.date,
    min: day.min,
    max: day.max,
    rainProb: day.rain_prob,
    stormProb: day.storm_prob,
    condition: day.condition,
    icon: day.icon,
  }));
}

export async function fetchWeatherToday(): Promise<WeatherToday> {
  const data = await apiRequest<WeatherTodayResponse>('/weather/today');
  return normalizeToday(data);
}

export async function fetchWeatherWeekly(): Promise<WeatherDay[]> {
  const data = await apiRequest<WeatherWeeklyResponse>('/weather/weekly');
  return normalizeWeekly(data);
}
