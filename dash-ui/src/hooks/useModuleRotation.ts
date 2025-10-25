import { useEffect, useMemo, useState } from "react";

import type { DisplayModule } from "../types/config";

export const useModuleRotation = (modules: DisplayModule[], cycleSeconds: number) => {
  const enabledModules = useMemo(
    () => modules.filter((module) => module.enabled),
    [modules]
  );

  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (enabledModules.length === 0) {
      return;
    }

    const duration = Math.max(cycleSeconds, 5) * 1000;
    const timer = window.setInterval(() => {
      setIndex((prev) => (prev + 1) % enabledModules.length);
    }, duration);

    return () => window.clearInterval(timer);
  }, [enabledModules, cycleSeconds]);

  useEffect(() => {
    setIndex(0);
  }, [enabledModules.length]);

  return {
    modules: enabledModules,
    active: enabledModules[index] ?? null,
    index,
  };
};
