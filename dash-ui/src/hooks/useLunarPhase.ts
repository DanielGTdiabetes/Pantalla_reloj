import { useMemo } from 'react';
import { useDayBrief } from './useDayBrief';
import type { DayInfoPayload } from '../services/dayinfo';

interface LunarPhaseResult {
  text: string | null;
  loading: boolean;
}

const SYNODIC_MONTH = 29.53058867;
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

export const useLunarPhase = (): LunarPhaseResult => {
  const { data, loading } = useDayBrief();

  const info = useMemo(() => deriveLunarInfo(data), [data]);
  const effectiveLoading = loading && !info;

  return {
    text: info ? `Fase lunar: ${info.name} (iluminación ${Math.round(info.illumination)}%)` : null,
    loading: effectiveLoading,
  };
};

interface LunarInfo {
  name: string;
  illumination: number;
}

function deriveLunarInfo(payload: DayInfoPayload | null): LunarInfo | null {
  const remote = extractRemoteLunarInfo(payload);
  const computed = computeLunarPhase(payload?.date);

  if (!remote && !computed) {
    return null;
  }

  const name = remote?.name ?? computed?.name;
  const illumination = normalizeIllumination(remote?.illumination ?? computed?.illumination ?? NaN);

  if (!name || Number.isNaN(illumination)) {
    return null;
  }

  return { name, illumination };
}

function extractRemoteLunarInfo(payload: DayInfoPayload | null): LunarInfo | null {
  if (!payload) return null;
  const candidates = [
    (payload as any)?.moon,
    (payload as any)?.lunar,
    (payload as any)?.moon_phase,
    (payload as any)?.moonPhase,
  ];

  for (const candidate of candidates) {
    const parsed = parseLunarCandidate(candidate);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

function parseLunarCandidate(candidate: unknown): LunarInfo | null {
  if (!candidate) return null;

  if (typeof candidate === 'string') {
    return { name: candidate, illumination: NaN };
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
      return { name, illumination };
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
  const name = phaseName(age);
  return { name, illumination };
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

function phaseName(age: number): string {
  const phases: Array<{ limit: number; label: string }> = [
    { limit: 1.84566, label: 'Luna nueva' },
    { limit: 5.53699, label: 'Luna creciente' },
    { limit: 9.22831, label: 'Cuarto creciente' },
    { limit: 12.91963, label: 'Gibosa creciente' },
    { limit: 16.61096, label: 'Luna llena' },
    { limit: 20.30228, label: 'Gibosa menguante' },
    { limit: 23.99361, label: 'Cuarto menguante' },
    { limit: 27.68493, label: 'Luna menguante' },
  ];

  for (const phase of phases) {
    if (age < phase.limit) {
      return phase.label;
    }
  }
  return 'Luna nueva';
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

