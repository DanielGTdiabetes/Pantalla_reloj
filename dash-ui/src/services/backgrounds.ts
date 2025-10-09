import { API_BASE_URL } from './config';

export interface BackgroundAsset {
  filename: string;
  url: string;
  generatedAt: number;
  mode?: 'daily' | 'weather';
  prompt?: string;
  weatherKey?: string | null;
}

function ensureOk(response: Response): Response {
  if (!response.ok) {
    throw new Error(`Error ${response.status} al cargar fondos`);
  }
  return response;
}

export async function fetchAutoBackgrounds(limit = 6): Promise<BackgroundAsset[]> {
  const response = await ensureOk(
    await fetch(`${API_BASE_URL}/backgrounds/auto?limit=${limit}`, {
      headers: { 'Cache-Control': 'no-cache' },
    }),
  );
  const data = (await response.json()) as BackgroundAsset[];
  return data;
}

export async function fetchCurrentBackground(): Promise<BackgroundAsset | null> {
  const response = await ensureOk(
    await fetch(`${API_BASE_URL}/backgrounds/current`, {
      headers: { 'Cache-Control': 'no-cache' },
    }),
  );
  if (response.status === 204) {
    return null;
  }
  const data = (await response.json()) as BackgroundAsset | null;
  return data;
}
