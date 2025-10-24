import { apiRequest } from './config';

export interface StormStatus {
  stormProb: number;
  nearActivity: boolean;
  radarUrl?: string;
  updatedAt: number;
  provider: 'aemet' | 'blitzortung';
  strikeCount: number;
  strikeCoords: Array<[number, number]>;
  lastStrikeKm?: number | null;
  lastStrikeAt?: string | null;
  strikesCount?: number;
  strikesWindowMinutes?: number;
  strikesCountKey?: string | null;
  blitzSource?: string | null;
  blitzConnected?: boolean | null;
  blitzNearestDistanceKm?: number | null;
  blitzAzimuthDeg?: number | null;
  blitzCountRecent?: number;
  blitzLastTimestamp?: string | null;
  blitzRadiusKm?: number | null;
  blitzTimeWindowMin?: number | null;
  blitzLastError?: string | null;
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
  provider?: string;
  strike_count?: number;
  strike_coords?: unknown;
  last_strike_km?: number | null;
  last_strike_at?: string | null;
  strikes_window_minutes?: number | null;
  cached_at?: number | null;
  source?: string;
  connected?: boolean;
  nearest_distance_km?: number | null;
  azimuth_deg?: number | null;
  count_recent?: number | null;
  last_ts?: string | null;
  radius_km?: number | null;
  time_window_min?: number | null;
  [key: string]: unknown;
}

interface RadarAnimationResponse {
  frames: Array<{ url: string; timestamp: number }>;
}

export async function fetchStormStatus(): Promise<StormStatus> {
  const data = await apiRequest<StormStatusResponse>('/storms/status');

  const providerRaw = typeof data.provider === 'string' ? data.provider.toLowerCase() : 'aemet';
  const provider: 'aemet' | 'blitzortung' = providerRaw === 'blitzortung' ? 'blitzortung' : 'aemet';

  const strikeCoords: Array<[number, number]> = [];
  if (Array.isArray(data.strike_coords)) {
    for (const entry of data.strike_coords) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const lat = Number.parseFloat(`${entry[0]}`);
      const lon = Number.parseFloat(`${entry[1]}`);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        strikeCoords.push([lat, lon]);
      }
    }
  }

  let strikeCount = 0;
  if (typeof data.strike_count === 'number' && Number.isFinite(data.strike_count)) {
    strikeCount = Math.max(0, Math.round(data.strike_count));
  } else if (strikeCoords.length) {
    strikeCount = strikeCoords.length;
  }

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

  const blitzSource = typeof data.source === 'string' ? data.source : null;
  const blitzConnected =
    typeof data.connected === 'boolean'
      ? data.connected
      : data.connected === null
      ? null
      : undefined;
  const blitzNearestDistance =
    typeof data.nearest_distance_km === 'number'
      ? data.nearest_distance_km
      : data.nearest_distance_km === null
      ? null
      : undefined;
  const blitzAzimuth =
    typeof data.azimuth_deg === 'number'
      ? data.azimuth_deg
      : data.azimuth_deg === null
      ? null
      : undefined;
  const blitzCountRecent =
    typeof data.count_recent === 'number' && Number.isFinite(data.count_recent)
      ? Math.max(0, Math.round(data.count_recent))
      : undefined;
  const blitzLastTimestamp =
    typeof data.last_ts === 'string'
      ? data.last_ts
      : data.last_ts === null
      ? null
      : undefined;
  const blitzRadius =
    typeof data.radius_km === 'number'
      ? data.radius_km
      : data.radius_km === null
      ? null
      : undefined;
  const blitzWindow =
    typeof data.time_window_min === 'number'
      ? data.time_window_min
      : data.time_window_min === null
      ? null
      : undefined;
  const blitzLastError = typeof data.last_error === 'string' ? data.last_error : null;

  return {
    stormProb: data.storm_prob,
    nearActivity: data.near_activity,
    radarUrl: data.radar_url,
    updatedAt: data.updated_at,
    provider,
    strikeCount,
    strikeCoords,
    lastStrikeKm,
    lastStrikeAt,
    strikesCount,
    strikesWindowMinutes,
    strikesCountKey: strikesCountKey ?? undefined,
    blitzConnected,
    blitzSource,
    blitzNearestDistanceKm: blitzNearestDistance ?? null,
    blitzAzimuthDeg: blitzAzimuth ?? null,
    blitzCountRecent: blitzCountRecent ?? 0,
    blitzLastTimestamp: blitzLastTimestamp ?? null,
    blitzRadiusKm: blitzRadius ?? null,
    blitzTimeWindowMin: blitzWindow ?? null,
    blitzLastError,
  };
}

export async function fetchRadarAnimation(limit = 8): Promise<RadarFrame[]> {
  const payload = await apiRequest<RadarAnimationResponse>(`/storms/radar/animation?limit=${limit}`);
  return payload.frames.map((frame) => ({ url: frame.url, timestamp: frame.timestamp }));
}
