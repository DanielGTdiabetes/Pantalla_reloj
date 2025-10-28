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
    let source: EventSource | null = null;
    let reconnectTimer: number | null = null;
    const INITIAL_RETRY = 4000;
    const MAX_RETRY = 60000;
    let retryDelay = INITIAL_RETRY;

    const cleanupSource = () => {
      if (source) {
        source.removeEventListener("config_changed", handleConfigChanged as EventListener);
        source.removeEventListener("error", handleError);
        source.removeEventListener("open", handleOpen);
        source.close();
        source = null;
      }
    };

    const clearReconnect = () => {
      if (reconnectTimer != null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (cancelled || reconnectTimer != null) {
        return;
      }
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, MAX_RETRY);
    };

    function handleConfigChanged(event: MessageEvent) {
      if (cancelled) {
        return;
      }
      const hintedVersion = parseEventVersion(event);
      const currentVersion = getConfigState().version;
      if (typeof hintedVersion === "number" && hintedVersion <= currentVersion) {
        triggerRefresh();
        return;
      }
      triggerRefresh();
    }

    function handleOpen() {
      retryDelay = INITIAL_RETRY;
      clearReconnect();
    }

    function handleError(event: Event) {
      if (!cancelled) {
        console.warn("[config] EventSource error", event);
      }
      if (!source || source.readyState === EventSource.CLOSED) {
        cleanupSource();
        scheduleReconnect();
      }
    }

    const connect = () => {
      if (cancelled) {
        return;
      }
      cleanupSource();
      clearReconnect();
      source = new EventSource(eventsUrl);
      source.addEventListener("config_changed", handleConfigChanged as EventListener);
      source.addEventListener("error", handleError);
      source.addEventListener("open", handleOpen);
    };

    connect();

    return () => {
      cancelled = true;
      cleanupSource();
      clearReconnect();
    };
  }, []);
};

export default useConfigWatcher;
