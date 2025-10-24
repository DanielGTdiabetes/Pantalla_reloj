import { useMemo } from 'react';
import { useDayBrief } from './useDayBrief';
import type { DayInfoPayload } from '../services/dayinfo';

export type LunarPhaseKey =
  | 'new'
  | 'waxing-crescent'
  | 'first-quarter'
  | 'waxing-gibbous'
  | 'full'
  | 'waning-gibbous'
  | 'last-quarter'
  | 'waning-crescent';

interface LunarPhaseResult {
  text: string | null;
  loading: boolean;
  name: string | null;
  illumination: number | null;
  phaseKey: LunarPhaseKey | null;
  icon: string | null;
}

const SYNODIC_MONTH = 29.53058867;
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

const PHASE_ICONS: Record<LunarPhaseKey, string> = {
  new: '🌑',
  'waxing-crescent': '🌒',
  'first-quarter': '🌓',
  'waxing-gibbous': '🌔',
  full: '🌕',
  'waning-gibbous': '🌖',
  'last-quarter': '🌗',
  'waning-crescent': '🌘',
};

export const useLunarPhase = (): LunarPhaseResult => {
  const { data, loading } = useDayBrief();

  const info = useMemo(() => deriveLunarInfo(data), [data]);
  const effectiveLoading = loading && !info;

  const illuminationValue = info ? Math.round(info.illumination) : null;
  const illuminationText = illuminationValue !== null ? `${illuminationValue}%` : null;
  const icon = info ? PHASE_ICONS[info.phaseKey] ?? '🌙' : null;

  return {
    text: info
      ? `Fase lunar: ${info.name}${illuminationText ? ` (iluminacion ${illuminationText})` : ''}`
      : null,
    loading: effectiveLoading,
    name: info?.name ?? null,
    illumination: illuminationValue,
    phaseKey: info?.phaseKey ?? null,
    icon,
  };
};

interface LunarInfo {
  name: string;
  illumination: number;
  phaseKey: LunarPhaseKey;
}

interface PartialLunarInfo {
  name?: string | null;
  illumination?: number | null;
  phaseKey?: LunarPhaseKey | null;
}

function deriveLunarInfo(payload: DayInfoPayload | null): LunarInfo | null {
  const remote = extractRemoteLunarInfo(payload);
  const computed = computeLunarPhase(payload?.date);

  if (!remote && !computed) {
    return null;
  }

  const name = remote?.name ?? computed?.name ?? null;
  const illumination = normalizeIllumination(
    remote?.illumination ?? computed?.illumination ?? NaN,
  );
  const phaseKey =
    remote?.phaseKey ??
    (name ? phaseKeyFromName(name) : null) ??
    computed?.phaseKey ??
    null;

  if (!name || Number.isNaN(illumination) || !phaseKey) {
    return null;
  }

  return { name, illumination, phaseKey };
}

function extractRemoteLunarInfo(payload: DayInfoPayload | null): PartialLunarInfo | null {
  if (!payload) return null;
  const payloadRecord = payload as unknown as Record<string, unknown>;
  const candidates = [
    payloadRecord?.moon,
    payloadRecord?.lunar,
    payloadRecord?.moon_phase,
    payloadRecord?.moonPhase,
  ];

  for (const candidate of candidates) {
    const parsed = parseLunarCandidate(candidate);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

function parseLunarCandidate(candidate: unknown): PartialLunarInfo | null {
  if (!candidate) return null;

  if (typeof candidate === 'string') {
    return { name: candidate };
  }

  if (typeof candidate === 'object') {
    const record = candidate as Record<string, unknown>;
    const name = pickString(record, ['name', 'phase', 'phase_name', 'phaseName']);
    const illuminationRaw = pickNumber(record, ['illumination', 'percent', 'percentage']);
    const fractionRaw = pickNumber(record, ['fraction', 'fractional']);
    const illumination = normalizeIllumination(
      Number.isFinite(illuminationRaw)
        ? (illuminationRaw as number)
        : Number.isFinite(fractionRaw)
        ? (fractionRaw as number) * 100
        : NaN,
    );

    if (name) {
      return { name, illumination, phaseKey: phaseKeyFromName(name) };
    }
  }

  return null;
}

function computeLunarPhase(dateString: string | undefined): LunarInfo | null {
  const baseDate = dateString ? new Date(`${dateString}T00:00:00`) : new Date();
  if (Number.isNaN(baseDate.getTime())) {
    return null;
  }

  const age = lunarAgeDays(baseDate);
  const illumination = normalizeIllumination(phaseIllumination(age));
  const { key, label } = phaseFromAge(age);
  return { name: label, illumination, phaseKey: key };
}

function lunarAgeDays(date: Date): number {
  const diff = date.getTime() - KNOWN_NEW_MOON;
  const days = diff / (1000 * 60 * 60 * 24);
  let age = days % SYNODIC_MONTH;
  if (age < 0) {
    age += SYNODIC_MONTH;
  }
  return age;
}

function phaseIllumination(age: number): number {
  const illumination = 0.5 * (1 - Math.cos((2 * Math.PI * age) / SYNODIC_MONTH));
  return illumination * 100;
}

const PHASE_TABLE: Array<{ limit: number; key: LunarPhaseKey; label: string }> = [
  { limit: 1.84566, key: 'new', label: 'Luna nueva' },
  { limit: 5.53699, key: 'waxing-crescent', label: 'Luna creciente' },
  { limit: 9.22831, key: 'first-quarter', label: 'Cuarto creciente' },
  { limit: 12.91963, key: 'waxing-gibbous', label: 'Gibosa creciente' },
  { limit: 16.61096, key: 'full', label: 'Luna llena' },
  { limit: 20.30228, key: 'waning-gibbous', label: 'Gibosa menguante' },
  { limit: 23.99361, key: 'last-quarter', label: 'Cuarto menguante' },
  { limit: 27.68493, key: 'waning-crescent', label: 'Luna menguante' },
];

function phaseFromAge(age: number): { key: LunarPhaseKey; label: string } {
  for (const phase of PHASE_TABLE) {
    if (age < phase.limit) {
      return phase;
    }
  }
  return PHASE_TABLE[0];
}

function phaseKeyFromName(name: string): LunarPhaseKey | null {
  const normalized = normalizePhaseName(name);
  if (!normalized) return null;
  if (normalized.includes('nueva')) return 'new';
  if (normalized.includes('llena')) return 'full';
  if (normalized.includes('cuarto') && normalized.includes('creciente')) return 'first-quarter';
  if (normalized.includes('cuarto') && normalized.includes('menguante')) return 'last-quarter';
  if (normalized.includes('gibosa') && normalized.includes('creciente')) return 'waxing-gibbous';
  if (normalized.includes('gibosa') && normalized.includes('menguante')) return 'waning-gibbous';
  if (normalized.includes('creciente')) return 'waxing-crescent';
  if (normalized.includes('menguante')) return 'waning-crescent';
  return null;
}

function normalizePhaseName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeIllumination(value: number): number {
  if (!Number.isFinite(value)) return NaN;
  let normalized = value;
  if (normalized < 0) normalized = 0;
  if (normalized <= 1) {
    normalized *= 100;
  }
  if (normalized > 100) normalized = 100;
  return normalized;
}

function pickString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function pickNumber(source: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}
