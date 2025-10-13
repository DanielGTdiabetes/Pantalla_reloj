import { BACKEND_BASE_URL } from './config';

export interface DayInfoEfemeride {
  text: string;
  year?: number | null;
  source?: string;
}

export interface DayInfoSantoral {
  name: string;
  source?: string;
}

export interface DayInfoHoliday {
  is_holiday: boolean;
  name?: string | null;
  scope?: 'national' | 'regional' | 'local' | null;
  region?: string | null;
  source?: string;
}

export interface DayInfoPatron {
  place?: string | null;
  name?: string | null;
  source?: string;
}

export interface DayInfoPayload {
  date: string;
  efemerides: DayInfoEfemeride[];
  santoral: DayInfoSantoral[];
  holiday: DayInfoHoliday;
  patron: DayInfoPatron | null;
}

export const fetchDayBrief = async (): Promise<DayInfoPayload> => {
  const response = await fetch(`${BACKEND_BASE_URL}/api/day/brief`);
  if (!response.ok) {
    throw new Error(`Error ${response.status}`);
  }
  return (await response.json()) as DayInfoPayload;
};
