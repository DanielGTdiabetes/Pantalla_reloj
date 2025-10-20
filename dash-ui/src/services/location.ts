import { apiRequest } from './config';

export interface LocationOverridePayload {
  lat: number;
  lon: number;
}

export interface LocationOverrideResponse {
  ok: boolean;
}

export async function overrideLocation(payload: LocationOverridePayload): Promise<LocationOverrideResponse> {
  return await apiRequest<LocationOverrideResponse>('/location/override', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
