import { API_BASE_URL, apiRequest } from './config';

export interface CalendarEvent {
  title: string;
  start: string;
  end?: string | null;
  allDay: boolean;
  notify: boolean;
}

export interface CalendarStatus {
  mode: 'url' | 'ics';
  url?: string | null;
  icsPath?: string | null;
  exists: boolean;
  size?: number | null;
  mtime?: string | null;
}

export interface CalendarOperationResponse extends CalendarStatus {
  ok: boolean;
  message?: string;
}

export async function fetchTodayEvents(): Promise<CalendarEvent[]> {
  return await apiRequest<CalendarEvent[]>('/calendar/today');
}

export async function fetchCalendarStatus(): Promise<CalendarStatus> {
  return await apiRequest<CalendarStatus>('/calendar/status');
}

export async function deleteCalendarFile(): Promise<CalendarOperationResponse> {
  return await apiRequest<CalendarOperationResponse>('/calendar/file', {
    method: 'DELETE',
  });
}

export function uploadCalendarFile(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<CalendarOperationResponse> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('file', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE_URL}/calendar/upload`);
    xhr.responseType = 'json';
    xhr.timeout = 60_000;

    xhr.upload.onprogress = (event) => {
      if (!onProgress) return;
      if (event.lengthComputable && event.total > 0) {
        onProgress((event.loaded / event.total) * 100);
      } else if (file.size > 0) {
        onProgress((event.loaded / file.size) * 100);
      }
    };

    xhr.onload = () => {
      const payload = parseXhrJson(xhr);
      if (xhr.status >= 200 && xhr.status < 300) {
        if (onProgress) onProgress(100);
        resolve(payload as CalendarOperationResponse);
        return;
      }
      const message =
        (payload && (payload.detail || payload.message)) || `Error ${xhr.status}`;
      reject(new Error(typeof message === 'string' ? message : `Error ${xhr.status}`));
    };

    xhr.onerror = () => {
      reject(new Error('Error de red al subir el archivo .ics'));
    };

    xhr.ontimeout = () => {
      reject(new Error('Tiempo de espera agotado al subir el archivo .ics'));
    };

    xhr.send(formData);
  });
}

function parseXhrJson(xhr: XMLHttpRequest): any {
  if (xhr.responseType === 'json' && xhr.response !== null) {
    return xhr.response;
  }
  const text = xhr.responseText;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    console.warn('Respuesta JSON no válida en subida de calendario', error);
    return null;
  }
}
