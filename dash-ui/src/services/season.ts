import { apiRequest } from './config';

export interface MonthSeason {
  month: number;
  hortalizas: string[];
  frutas: string[];
  nota?: string | null;
  tip: string;
}

interface SeasonResponse {
  month: number;
  hortalizas: string[];
  frutas: string[];
  nota?: string | null;
  tip: string;
}

export async function fetchSeasonMonth(month?: number): Promise<MonthSeason> {
  const query = month ? `?month=${month}` : '';
  const data = await apiRequest<SeasonResponse>(`/season/month${query}`);
  return {
    month: data.month,
    hortalizas: data.hortalizas ?? [],
    frutas: data.frutas ?? [],
    nota: data.nota ?? undefined,
    tip: data.tip,
  };
}
