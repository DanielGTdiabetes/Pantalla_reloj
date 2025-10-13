const YES_VALUES = new Set(['1', 'true', 'on', 'yes']);

function flagEnabled(value: string | undefined, defaultValue = true): boolean {
  if (typeof value === 'undefined') {
    return defaultValue;
  }
  const normalized = value.toString().trim().toLowerCase();
  if (normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no') {
    return false;
  }
  if (normalized === '') {
    return defaultValue;
  }
  return YES_VALUES.has(normalized);
}

export const ENABLE_WEBGL = flagEnabled(import.meta.env.VITE_ENABLE_WEBGL, true);
export const ENABLE_LOTTIE = flagEnabled(import.meta.env.VITE_ENABLE_LOTTIE, true);
export const ENABLE_FPS_METER = flagEnabled(import.meta.env.VITE_ENABLE_FPSMETER, false);

export type RuntimeFlags = {
  webgl: boolean;
  lottie: boolean;
  fpsMeter: boolean;
};

export function getRuntimeFlags(): RuntimeFlags {
  return {
    webgl: ENABLE_WEBGL,
    lottie: ENABLE_LOTTIE,
    fpsMeter: ENABLE_FPS_METER,
  };
}
