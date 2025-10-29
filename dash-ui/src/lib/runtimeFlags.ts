const parseBoolean = (value: string | null | undefined): boolean | undefined => {
  if (value == null) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no") {
    return false;
  }
  return undefined;
};

const getSearchParams = (): URLSearchParams => {
  if (typeof window === "undefined") {
    return new URLSearchParams();
  }
  try {
    return new URLSearchParams(window.location.search);
  } catch {
    return new URLSearchParams();
  }
};

const kioskEnabledFromEnv = () => {
  const envValue = import.meta.env.VITE_KIOSK;
  return envValue === "true" || envValue === "1";
};

type KioskWindow = Window & {
  __KIOSK__?: {
    ENABLED?: boolean;
    REDUCED_MOTION?: boolean;
  };
};

const kioskWindow: KioskWindow | undefined =
  typeof window !== "undefined" ? (window as KioskWindow) : undefined;

const kioskEnabled = Boolean(kioskWindow?.__KIOSK__?.ENABLED ?? kioskEnabledFromEnv());

const params = getSearchParams();
const reducedOverrideFromQuery = parseBoolean(params.get("reduced"));
const reducedMotionOverride =
  typeof kioskWindow?.__KIOSK__?.REDUCED_MOTION === "boolean"
    ? kioskWindow.__KIOSK__!.REDUCED_MOTION
    : reducedOverrideFromQuery;

export const kioskRuntime = {
  enabled: kioskEnabled,
  reducedMotionOverride,
  shouldRespectReducedMotion(defaultRespect: boolean): boolean {
    if (!kioskEnabled) {
      return defaultRespect;
    }

    if (typeof reducedMotionOverride === "boolean") {
      return reducedMotionOverride;
    }

    return defaultRespect;
  },
  isMotionForced(): boolean {
    return kioskEnabled && reducedMotionOverride === false;
  }
};

export default kioskRuntime;

declare global {
  interface Window {
    __KIOSK__?: {
      ENABLED?: boolean;
      REDUCED_MOTION?: boolean;
    };
  }
}
