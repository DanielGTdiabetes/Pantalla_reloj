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
  holidayNames: string[];
  patron: DayInfoPatron | null;
}

export const fetchDayBrief = async (): Promise<DayInfoPayload> => {
  const response = await fetch(`${BACKEND_BASE_URL}/api/day/brief`);
  if (!response.ok) {
    throw new Error(`Error ${response.status}`);
  }
  const raw = await response.json();
  return normalizeDayInfoPayload(raw);
};

function normalizeDayInfoPayload(raw: unknown): DayInfoPayload {
  const record = isRecord(raw) ? raw : {};

  const date = typeof record.date === 'string' ? record.date : new Date().toISOString().slice(0, 10);

  const efemerides = Array.isArray(record.efemerides)
    ? record.efemerides
        .map((item) => normalizeEfemeride(item))
        .filter((item): item is DayInfoEfemeride => Boolean(item))
    : [];

  const santoral = Array.isArray(record.santoral)
    ? record.santoral
        .map((item) => normalizeSantoral(item))
        .filter((item): item is DayInfoSantoral => Boolean(item))
    : [];

  const { holiday, holidayNames } = normalizeHoliday(record);

  const patron = normalizePatron(record.patron);

  return {
    date,
    efemerides,
    santoral,
    holiday,
    holidayNames,
    patron,
  };
}

function normalizeEfemeride(value: unknown): DayInfoEfemeride | null {
  if (typeof value === 'string') {
    const text = sanitizeText(value);
    if (text) return { text };
    return null;
  }
  if (!isRecord(value)) return null;
  const text = sanitizeText(value.text);
  if (!text) return null;
  const year = typeof value.year === 'number' ? value.year : null;
  const source = sanitizeText(value.source);
  const entry: DayInfoEfemeride = { text };
  if (year !== null) entry.year = year;
  if (source) entry.source = source;
  return entry;
}

function normalizeSantoral(value: unknown): DayInfoSantoral | null {
  if (typeof value === 'string') {
    const name = sanitizeText(value);
    if (!name) return null;
    return { name };
  }
  if (!isRecord(value)) return null;
  const name = sanitizeText(value.name ?? value.nombre);
  if (!name) return null;
  const source = sanitizeText(value.source ?? value.fuente);
  const entry: DayInfoSantoral = { name };
  if (source) entry.source = source;
  return entry;
}

function normalizeHoliday(record: Record<string, unknown>): {
  holiday: DayInfoHoliday;
  holidayNames: string[];
} {
  const namesMap = new Map<string, string>();
  let isHoliday = false;
  let scope: 'national' | 'regional' | 'local' | null = null;
  let region: string | null = null;
  let source: string | undefined;

  const visitedSearch = new Set<object>();
  const candidateValues: unknown[] = [];

  const HOLIDAY_VALUE_KEYS = new Set([
    'holiday',
    'holidays',
    'festivo',
    'festivos',
    'festividad',
    'festividades',
    'festivohoy',
    'festivoshoy',
    'festivonacional',
    'festivolocal',
    'nombrefestivo',
    'nombrefestivos',
    'holidayname',
    'holidaynames',
    'nombredefestivo',
    'nombredefestivos',
  ]);

  const HOLIDAY_BOOLEAN_KEYS = new Set([
    'isholiday',
    'isfestive',
    'festivo',
    'festivos',
    'esfestivo',
    'festivohoy',
    'festivoshoy',
    'festivoactual',
  ]);

  function searchCandidates(value: unknown, depth: number) {
    if (!isRecord(value)) return;
    if (visitedSearch.has(value)) return;
    if (depth > 4) return;
    visitedSearch.add(value);
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = normalizeKey(key);
      if (HOLIDAY_VALUE_KEYS.has(normalizedKey)) {
        candidateValues.push(child);
      }
      if (HOLIDAY_BOOLEAN_KEYS.has(normalizedKey) && typeof child === 'boolean') {
        if (child) isHoliday = true;
      }
      if (typeof child === 'object' && child !== null) {
        searchCandidates(child, depth + 1);
      }
    }
  }

  searchCandidates(record, 0);

  const visitedCollect = new Set<object>();

  function collectHolidayInfo(value: unknown, depth: number) {
    if (depth > 5) return;
    if (value === null || value === undefined) return;
    if (typeof value === 'boolean') {
      if (value) isHoliday = true;
      return;
    }
    if (typeof value === 'string' || typeof value === 'number') {
      const label = sanitizeText(value);
      if (label) {
        const key = label.toLowerCase();
        if (!namesMap.has(key)) {
          namesMap.set(key, label);
        }
        isHoliday = true;
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => collectHolidayInfo(item, depth + 1));
      return;
    }
    if (!isRecord(value)) return;
    if (visitedCollect.has(value)) return;
    visitedCollect.add(value);

    const obj = value as Record<string, unknown>;

    if (typeof obj.is_holiday === 'boolean' && obj.is_holiday) {
      isHoliday = true;
    }
    if (typeof obj.isHoliday === 'boolean' && obj.isHoliday) {
      isHoliday = true;
    }
    if (typeof obj.festivo === 'boolean' && obj.festivo) {
      isHoliday = true;
    }
    if (typeof obj.festivoHoy === 'boolean' && obj.festivoHoy) {
      isHoliday = true;
    }

    const scopeCandidate = parseHolidayScope(obj.scope ?? obj.ambito ?? obj.ambit ?? obj.tipo);
    if (scopeCandidate && !scope) {
      scope = scopeCandidate;
    }

    const regionCandidate = sanitizeText(
      obj.region ??
        obj.regionName ??
        obj.comunidad ??
        obj.autonomousCommunity ??
        obj.provincia ??
        obj.municipio ??
        obj.localidad ??
        obj.city ??
        obj.location,
    );
    if (regionCandidate && !region) {
      region = regionCandidate;
    }

    const sourceCandidate = sanitizeText(obj.source ?? obj.fuente ?? obj.provider ?? obj.origin);
    if (sourceCandidate && !source) {
      source = sourceCandidate;
    }

    for (const [key, child] of Object.entries(obj)) {
      const normalizedKey = normalizeKey(key);
      if (
        normalizedKey === 'name' ||
        normalizedKey === 'nombre' ||
        normalizedKey === 'nombrefestivo' ||
        normalizedKey === 'holidayname' ||
        normalizedKey === 'titulo' ||
        normalizedKey === 'title' ||
        normalizedKey === 'descripcion' ||
        normalizedKey === 'description' ||
        normalizedKey === 'label'
      ) {
        collectHolidayInfo(child, depth + 1);
        continue;
      }
      if (normalizedKey.includes('festiv') || normalizedKey.includes('holiday')) {
        collectHolidayInfo(child, depth + 1);
      }
    }
  }

  candidateValues.forEach((value) => collectHolidayInfo(value, 0));

  const holidayNames = Array.from(namesMap.values());

  const primaryName = holidayNames.length > 0 ? holidayNames[0] : null;

  const holiday: DayInfoHoliday = {
    is_holiday: isHoliday || holidayNames.length > 0,
    name: primaryName,
  };

  if (scope) {
    holiday.scope = scope;
  }
  if (region) {
    holiday.region = region;
  }
  if (source) {
    holiday.source = source;
  }

  return { holiday, holidayNames };
}

function normalizePatron(value: unknown): DayInfoPatron | null {
  if (!isRecord(value)) return null;
  const name = sanitizeText(value.name ?? value.nombre);
  const place = sanitizeText(value.place ?? value.city ?? value.localidad);
  if (!name && !place) return null;
  const entry: DayInfoPatron = {};
  if (name) entry.name = name;
  if (place) entry.place = place;
  const source = sanitizeText(value.source ?? value.fuente);
  if (source) entry.source = source;
  return entry;
}

function sanitizeText(value: unknown): string {
  if (typeof value === 'string') {
    return value.replace(/\s+/g, ' ').trim();
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return '';
}

function parseHolidayScope(value: unknown): 'national' | 'regional' | 'local' | null {
  if (typeof value !== 'string') return null;
  const normalized = value.toLowerCase();
  if (normalized.includes('national') || normalized.includes('nacional')) {
    return 'national';
  }
  if (normalized.includes('regional') || normalized.includes('autonom')) {
    return 'regional';
  }
  if (normalized.includes('local') || normalized.includes('municip')) {
    return 'local';
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}

function normalizeKey(key: string): string {
  return key
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z0-9]/g, '');
}
