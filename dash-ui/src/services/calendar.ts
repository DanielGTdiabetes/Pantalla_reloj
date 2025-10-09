import { apiRequest } from './config';

export interface CalendarEvent {
  title: string;
  start: string;
  end?: string | null;
  allDay: boolean;
  notify: boolean;
}

export async function fetchTodayEvents(): Promise<CalendarEvent[]> {
  return await apiRequest<CalendarEvent[]>('/calendar/today');
}
