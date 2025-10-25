import { useEffect, useMemo, useState } from "react";

import type { DisplayModule } from "../types/config";

type RotationOptions = {
  enabled?: boolean;
};

const shouldRotate = (enabledModules: DisplayModule[], options?: RotationOptions) => {
  if (options?.enabled === false) {
    return false;
  }
  return enabledModules.length > 1;
};

export const useModuleRotation = (
  modules: DisplayModule[],
  cycleSeconds: number,
  options?: RotationOptions
) => {
  const enabledModules = useMemo(
    () => modules.filter((module) => module.enabled),
    [modules]
  );

  const [index, setIndex] = useState(0);
  const rotationActive = shouldRotate(enabledModules, options);

  useEffect(() => {
    if (!rotationActive || enabledModules.length === 0) {
      return;
    }

    const duration = Math.max(cycleSeconds, 5) * 1000;
    const timer = window.setInterval(() => {
      setIndex((prev) => (prev + 1) % enabledModules.length);
    }, duration);

    return () => window.clearInterval(timer);
  }, [enabledModules, cycleSeconds, rotationActive]);

  useEffect(() => {
    setIndex(0);
  }, [enabledModules.length, rotationActive]);

  return {
    modules: enabledModules,
    active: rotationActive ? enabledModules[index] ?? null : enabledModules[0] ?? null,
    index: rotationActive ? index : 0,
    rotating: rotationActive,
  };
};
