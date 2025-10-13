import { apiRequest } from './config';

export interface WeatherBriefData {
  title: string;
  tips: string[];
  updatedAt: number;
  cached?: boolean;
}

interface BackendWeatherBrief {
  title: string;
  tips: unknown;
  updated_at?: number;
  updatedAt?: number;
  cached?: boolean;
}

export async function fetchWeatherBrief(): Promise<WeatherBriefData> {
  const raw = await apiRequest<BackendWeatherBrief>('/ai/weather/brief');
  const tips = Array.isArray(raw.tips) ? raw.tips.map((tip) => String(tip)) : [];
  const updatedAt = raw.updatedAt ?? raw.updated_at ?? Date.now();
  return {
    title: raw.title ?? 'Resumen meteorológico',
    tips,
    updatedAt,
    cached: raw.cached ?? false,
  };
}
