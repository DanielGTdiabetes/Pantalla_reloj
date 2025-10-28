import { useSyncExternalStore } from "react";

import { withConfigDefaults } from "../config/defaults";
import type { AppConfig, AppConfigResponse, ResolvedConfig } from "../types/config";

export type ConfigState = {
  config: AppConfig | null;
  resolved: ResolvedConfig | null;
  version: number;
  loading: boolean;
  error: string | null;
};

const state: ConfigState = {
  config: null,
  resolved: null,
  version: 0,
  loading: true,
  error: null
};

const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of listeners) {
    listener();
  }
};

const setState = (patch: Partial<ConfigState>) => {
  Object.assign(state, patch);
  notify();
};

const cloneResolved = (resolved: ResolvedConfig | null): ResolvedConfig | null => {
  if (!resolved) {
    return null;
  }
  return {
    map: {
      engine: resolved.map.engine,
      type: resolved.map.type,
      style_url: resolved.map.style_url
    }
  };
};

export const applyConfigPayload = (
  payload: AppConfigResponse | null | undefined,
  options?: { loading?: boolean; error?: string | null }
) => {
  if (!payload) {
    return;
  }
  const config = withConfigDefaults(payload);
  const nextVersion = typeof payload.version === "number" ? payload.version : state.version;
  const patch: Partial<ConfigState> = {
    config,
    resolved: cloneResolved(payload.resolved ?? null),
    version: nextVersion,
    loading: options?.loading ?? false,
    error: options?.error ?? null
  };
  setState(patch);
};

export const setConfigLoading = (loading: boolean) => {
  setState({ loading });
};

export const setConfigError = (message: string | null) => {
  setState({ error: message });
};

export const getConfigState = () => state;

const subscribeStore = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useConfigStore = <T>(selector: (snapshot: ConfigState) => T): T => {
  const getSnapshot = () => selector(state);
  return useSyncExternalStore(subscribeStore, getSnapshot, getSnapshot);
};
