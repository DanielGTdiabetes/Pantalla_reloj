import { useEffect, useState } from "react";

type WebglStatus = "checking" | "ready" | "unavailable";

type WebglCheckResult = {
  status: WebglStatus;
  reason: string | null;
};

const checkWebglSupport = (): WebglCheckResult => {
  if (typeof window === "undefined") {
    return { status: "checking", reason: null };
  }

  try {
    const canvas = document.createElement("canvas");
    const webgl2 = canvas.getContext("webgl2", { preserveDrawingBuffer: false });
    if (webgl2) {
      return { status: "ready", reason: null };
    }
    const webgl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (webgl) {
      return { status: "ready", reason: null };
    }
    return { status: "unavailable", reason: "No fue posible inicializar un contexto WebGL" };
  } catch (error) {
    return {
      status: "unavailable",
      reason: error instanceof Error ? error.message : "Error desconocido al inicializar WebGL"
    };
  }
};

export const useWebglStatus = (): WebglCheckResult => {
  const [result, setResult] = useState<WebglCheckResult>(() => checkWebglSupport());

  useEffect(() => {
    if (result.status === "ready") {
      return;
    }
    const handle = window.setTimeout(() => {
      setResult(checkWebglSupport());
    }, 1500);
    return () => window.clearTimeout(handle);
  }, [result.status]);

  return result;
};

export default useWebglStatus;
