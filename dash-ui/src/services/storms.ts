import { apiRequest } from './config';

export interface StormStatus {
  stormProb: number;
  nearActivity: boolean;
  radarUrl?: string;
  updatedAt: number;
}

export interface RadarFrame {
  url: string;
  timestamp: number;
}

interface StormStatusResponse {
  storm_prob: number;
  near_activity: boolean;
  radar_url?: string;
  updated_at: number;
}

interface RadarAnimationResponse {
  frames: Array<{ url: string; timestamp: number }>;
}

export async function fetchStormStatus(): Promise<StormStatus> {
  const data = await apiRequest<StormStatusResponse>('/storms/status');
  return {
    stormProb: data.storm_prob,
    nearActivity: data.near_activity,
    radarUrl: data.radar_url,
    updatedAt: data.updated_at,
  };
}

export async function fetchRadarAnimation(limit = 8): Promise<RadarFrame[]> {
  const payload = await apiRequest<RadarAnimationResponse>(`/storms/radar/animation?limit=${limit}`);
  return payload.frames.map((frame) => ({ url: frame.url, timestamp: frame.timestamp }));
}
