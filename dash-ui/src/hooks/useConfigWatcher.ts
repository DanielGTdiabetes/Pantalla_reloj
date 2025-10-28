import { useEffect } from "react";

import { API_ORIGIN, getConfig, getConfigVersion } from "../lib/api";
import {
  applyConfigPayload,
  getConfigState,
  setConfigError,
  setConfigLoading
} from "../state/configStore";

const API_ERROR_MESSAGE = `No se pudo conectar con el backend en ${API_ORIGIN}`;

type ConfigChangedEvent = {
  version?: number;
};

const parseEventVersion = (event: MessageEvent): number | null => {
  if (!event?.data) {
    return null;
  }
  try {
    const payload = JSON.parse(String(event.data)) as ConfigChangedEvent;
    return typeof payload.version === "number" ? payload.version : null;
  } catch {
    return null;
  }
};

export const useConfigWatcher = () => {
  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      ((window as typeof window & { __PANTALLA_DISABLE_SSE?: boolean }).__PANTALLA_DISABLE_SSE ||
        import.meta.env.VITE_DISABLE_SSE === "1")
    ) {
      return;
    }

    let cancelled = false;
    let refreshRunning = false;
    let refreshQueued = false;

    const performRefresh = async () => {
      try {
        const versionResponse = await getConfigVersion();
        if (cancelled || !versionResponse || typeof versionResponse.version !== "number") {
          return;
        }
        const remoteVersion = versionResponse.version;
        const currentVersion = getConfigState().version;
        if (remoteVersion <= currentVersion) {
          return;
        }
        const payload = await getConfig();
        if (cancelled) {
          return;
        }
        if (payload) {
          applyConfigPayload(payload);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("[config] Failed to refresh configuration", error);
        }
      }
    };

    const triggerRefresh = () => {
      if (refreshRunning) {
        refreshQueued = true;
        return;
      }
      refreshRunning = true;
      void (async () => {
        try {
          await performRefresh();
        } finally {
          refreshRunning = false;
          if (refreshQueued) {
            refreshQueued = false;
            triggerRefresh();
          }
        }
      })();
    };

    const loadInitial = async () => {
      try {
        setConfigLoading(true);
        const payload = await getConfig();
        if (cancelled) {
          return;
        }
        if (payload) {
          applyConfigPayload(payload, { loading: false, error: null });
        } else {
          setConfigError(API_ERROR_MESSAGE);
          setConfigLoading(false);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("[config] Initial load failed", error);
          setConfigError(API_ERROR_MESSAGE);
          setConfigLoading(false);
        }
      }
    };

    void loadInitial();

    const eventsUrl = `${API_ORIGIN}/api/events`;
    const source = new EventSource(eventsUrl);

    const handleConfigChanged = (event: MessageEvent) => {
      if (cancelled) {
        return;
      }
      const hintedVersion = parseEventVersion(event);
      const currentVersion = getConfigState().version;
      if (typeof hintedVersion === "number" && hintedVersion <= currentVersion) {
        // Still check the backend version to honour instructions but skip queuing duplicates.
        triggerRefresh();
        return;
      }
      triggerRefresh();
    };

    const handleError = (event: Event) => {
      if (!cancelled) {
        console.warn("[config] EventSource error", event);
      }
    };

    source.addEventListener("config_changed", handleConfigChanged as EventListener);
    source.addEventListener("error", handleError);

    return () => {
      cancelled = true;
      source.removeEventListener("config_changed", handleConfigChanged as EventListener);
      source.removeEventListener("error", handleError);
      source.close();
    };
  }, []);
};

export default useConfigWatcher;
