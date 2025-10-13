import { apiRequest } from './config';

export interface StormStatus {
  stormProb: number;
  nearActivity: boolean;
  radarUrl?: string;
  updatedAt: number;
}

interface StormStatusResponse {
  storm_prob: number;
  near_activity: boolean;
  radar_url?: string;
  updated_at: number;
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
