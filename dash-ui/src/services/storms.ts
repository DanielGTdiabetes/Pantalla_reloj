import { apiRequest } from './config';

export interface StormStatus {
  stormProb: number;
  nearActivity: boolean;
  radarUrl?: string;
  updatedAt: number;
  lastStrikeKm?: number | null;
  lastStrikeAt?: string | null;
  strikesCount?: number;
  strikesWindowMinutes?: number;
  strikesCountKey?: string | null;
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
  last_strike_km?: number | null;
  last_strike_at?: string | null;
  strikes_window_minutes?: number | null;
  cached_at?: number | null;
  source?: string;
  [key: string]: unknown;
}

interface RadarAnimationResponse {
  frames: Array<{ url: string; timestamp: number }>;
}

export async function fetchStormStatus(): Promise<StormStatus> {
  const data = await apiRequest<StormStatusResponse>('/storms/status');
  const strikesEntry = Object.entries(data).find(([key]) => key.startsWith('strikes_count_') && key.endsWith('m'));
  let strikesCount: number | undefined;
  let strikesCountKey: string | null = null;
  if (strikesEntry) {
    strikesCountKey = strikesEntry[0];
    const rawValue = strikesEntry[1];
    const numeric =
      typeof rawValue === 'number' ? rawValue : typeof rawValue === 'string' ? Number.parseFloat(rawValue) : Number.NaN;
    if (!Number.isNaN(numeric)) {
      strikesCount = Math.max(0, Math.round(numeric));
    }
  }

  let strikesWindowMinutes: number | undefined;
  if (typeof data.strikes_window_minutes === 'number') {
    strikesWindowMinutes = data.strikes_window_minutes;
  } else if (strikesCountKey) {
    const match = strikesCountKey.match(/strikes_count_(\d+)m/);
    if (match) {
      strikesWindowMinutes = Number.parseInt(match[1] ?? '', 10) || undefined;
    }
  }

  const lastStrikeKm =
    typeof data.last_strike_km === 'number'
      ? data.last_strike_km
      : data.last_strike_km === null
      ? null
      : undefined;
  const lastStrikeAt =
    typeof data.last_strike_at === 'string'
      ? data.last_strike_at
      : data.last_strike_at === null
      ? null
      : undefined;

  return {
    stormProb: data.storm_prob,
    nearActivity: data.near_activity,
    radarUrl: data.radar_url,
    updatedAt: data.updated_at,
    lastStrikeKm,
    lastStrikeAt,
    strikesCount,
    strikesWindowMinutes,
    strikesCountKey: strikesCountKey ?? undefined,
  };
}

export async function fetchRadarAnimation(limit = 8): Promise<RadarFrame[]> {
  const payload = await apiRequest<RadarAnimationResponse>(`/storms/radar/animation?limit=${limit}`);
  return payload.frames.map((frame) => ({ url: frame.url, timestamp: frame.timestamp }));
}
