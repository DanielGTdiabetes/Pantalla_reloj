const SAFE_QUERY_KEY = "safe";

const parseSearch = (search: string): URLSearchParams => {
  if (!search) {
    return new URLSearchParams();
  }
  return new URLSearchParams(search.startsWith("?") ? search : `?${search}`);
};

const hasSafeParam = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }

  const searchParams = parseSearch(window.location.search);
  const safeValue = searchParams.get(SAFE_QUERY_KEY);
  if (isTruthyFlag(safeValue)) {
    return true;
  }

  const hash = window.location.hash ?? "";
  const queryIndex = hash.indexOf("?");
  if (queryIndex === -1) {
    return false;
  }
  const hashQuery = hash.slice(queryIndex + 1);
  const hashParams = parseSearch(hashQuery);
  return isTruthyFlag(hashParams.get(SAFE_QUERY_KEY));
};

const isTruthyFlag = (value: string | null): boolean => {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

const parseEnvFlag = (): boolean => {
  const value = import.meta.env.VITE_SAFE_MODE;
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value === 1;
  }
  if (typeof value === "string") {
    return isTruthyFlag(value);
  }
  return false;
};

export const SAFE_MODE_ENABLED = parseEnvFlag() || hasSafeParam();

if (typeof window !== "undefined") {
  (window as Window & { __SAFE_MODE__?: boolean }).__SAFE_MODE__ = SAFE_MODE_ENABLED;
}

export const SAFE_MODE_BADGE_LABEL = "SAFE MODE";

export default SAFE_MODE_ENABLED;
