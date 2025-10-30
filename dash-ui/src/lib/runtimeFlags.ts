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

const parseNumber = (value: string | null | undefined): number | undefined => {
  if (value == null) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
};

type NodeProcess = { env?: { NODE_ENV?: string } };

const getNodeProcess = (): NodeProcess | undefined => {
  if (typeof globalThis === "undefined") {
    return undefined;
  }
  const candidate = (globalThis as { process?: NodeProcess }).process;
  if (candidate && typeof candidate === "object") {
    return candidate;
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

const getLocalStorageValue = (key: string): string | null => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const storage = window.localStorage;
    if (!storage) {
      return null;
    }
    if (storage.getItem(key) != null) {
      return storage.getItem(key);
    }
    // Allow uppercase variants such as KIOSK_MODE
    return storage.getItem(key.toUpperCase());
  } catch {
    return null;
  }
};

const readBooleanFlag = (key: string): boolean | undefined => {
  const params = getSearchParams();
  const fromQuery = parseBoolean(params.get(key));
  if (typeof fromQuery === "boolean") {
    return fromQuery;
  }
  const fromStorage = getLocalStorageValue(key);
  return parseBoolean(fromStorage);
};

const readNumberFlag = (key: string): number | undefined => {
  const params = getSearchParams();
  const fromQuery = parseNumber(params.get(key));
  if (typeof fromQuery === "number") {
    return fromQuery;
  }
  const fromStorage = getLocalStorageValue(key);
  return parseNumber(fromStorage);
};

const kioskEnabledFromEnv = () => {
  const envValue = import.meta.env.VITE_KIOSK;
  return envValue === "true" || envValue === "1";
};

const isProduction = (): boolean => {
  if (typeof import.meta !== "undefined" && typeof import.meta.env !== "undefined") {
    return Boolean(import.meta.env.PROD);
  }
  const nodeProcess = getNodeProcess();
  if (typeof nodeProcess?.env?.NODE_ENV === "string") {
    return nodeProcess.env.NODE_ENV === "production";
  }
  return false;
};

const isLocalHostname = (hostname: string): boolean => {
  if (!hostname) {
    return false;
  }
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return true;
  }
  if (/^10\.\d+\.\d+\.\d+$/.test(hostname)) {
    return true;
  }
  if (/^192\.168\.\d+\.\d+$/.test(hostname)) {
    return true;
  }
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(hostname)) {
    return true;
  }
  if (/^0?::1$/.test(hostname)) {
    return true;
  }
  return false;
};

type KioskWindow = Window & {
  __KIOSK__?: {
    ENABLED?: boolean;
    REDUCED_MOTION?: boolean;
  };
};

const kioskWindow: KioskWindow | undefined =
  typeof window !== "undefined" ? (window as KioskWindow) : undefined;

const kioskModeStored = parseBoolean(getLocalStorageValue("KIOSK_MODE")) === true;

const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";
const chromeLike = /Chrome/i.test(userAgent);
const kioskClassFlag = /--class=pantalla-kiosk/i.test(userAgent);

const kioskEnabledRuntime = kioskWindow?.__KIOSK__?.ENABLED;

const initialKioskLikely = Boolean(
  kioskEnabledRuntime ??
    (kioskModeStored ||
      kioskEnabledFromEnv() ||
      (isProduction() && chromeLike && !kioskClassFlag))
);

const state = {
  kioskLikely: initialKioskLikely,
  kioskResolved: false,
  kioskProbePromise: null as Promise<boolean> | null
};

const ensureKioskProbe = (): Promise<boolean> => {
  if (state.kioskProbePromise) {
    return state.kioskProbePromise;
  }
  if (typeof window === "undefined") {
    state.kioskResolved = true;
    return Promise.resolve(state.kioskLikely);
  }
  const hostname = window.location.hostname;
  if (!isLocalHostname(hostname)) {
    state.kioskResolved = true;
    return Promise.resolve(state.kioskLikely);
  }

  state.kioskProbePromise = fetch("/api/health", {
    cache: "no-store",
    method: "GET"
  })
    .then((response) => {
      if (response.ok) {
        state.kioskLikely = true;
      }
      state.kioskResolved = true;
      return state.kioskLikely;
    })
    .catch(() => {
      state.kioskResolved = true;
      return state.kioskLikely;
    });

  return state.kioskProbePromise;
};

const getAutopanOverride = (): boolean | undefined => readBooleanFlag("autopan");
const getReducedOverride = (): boolean | undefined => {
  const explicit = readBooleanFlag("reduced");
  if (typeof kioskWindow?.__KIOSK__?.REDUCED_MOTION === "boolean") {
    return kioskWindow.__KIOSK__!.REDUCED_MOTION;
  }
  return explicit;
};

export const kioskRuntime = {
  isLikelyKiosk(): boolean {
    return state.kioskLikely;
  },
  async ensureKioskDetection(): Promise<boolean> {
    return ensureKioskProbe();
  },
  isKioskResolved(): boolean {
    return state.kioskResolved;
  },
  getAutopanOverride(): boolean | undefined {
    return getAutopanOverride();
  },
  isAutopanForcedOn(): boolean {
    return getAutopanOverride() === true;
  },
  isAutopanForcedOff(): boolean {
    return getAutopanOverride() === false;
  },
  getSpeedOverride(defaultSpeed: number, fallbackSpeed: number): number {
    const override = readNumberFlag("speed");
    if (typeof override === "number" && override > 0) {
      return override;
    }
    const speed = Number.isFinite(defaultSpeed) && defaultSpeed > 0 ? defaultSpeed : fallbackSpeed;
    return Math.max(speed, fallbackSpeed);
  },
  shouldRespectReducedMotion(defaultRespect: boolean): boolean {
    if (this.isAutopanForcedOn()) {
      return false;
    }
    const reducedOverride = getReducedOverride();
    if (typeof reducedOverride === "boolean") {
      return reducedOverride;
    }
    if (this.isLikelyKiosk()) {
      return false;
    }
    return defaultRespect;
  },
  isMotionForced(): boolean {
    if (this.isAutopanForcedOn()) {
      return true;
    }
    if (!this.isLikelyKiosk()) {
      return false;
    }
    const reducedOverride = getReducedOverride();
    if (typeof reducedOverride === "boolean") {
      return reducedOverride === false;
    }
    return true;
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
