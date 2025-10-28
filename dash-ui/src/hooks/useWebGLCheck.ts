import { useMemo } from "react";

type WebGLCheckResult = {
  supported: boolean;
  reason: string | null;
};

const runWebGLCheck = (): WebGLCheckResult => {
  if (typeof window === "undefined") {
    return { supported: true, reason: null };
  }

  try {
    const canvas = document.createElement("canvas");
    const webgl2 = canvas.getContext("webgl2", { preserveDrawingBuffer: false });
    if (webgl2) {
      return { supported: true, reason: null };
    }
    const webgl =
      canvas.getContext("webgl", { preserveDrawingBuffer: false }) ||
      canvas.getContext("experimental-webgl", { preserveDrawingBuffer: false });
    if (webgl) {
      return { supported: true, reason: null };
    }
    return { supported: false, reason: "No fue posible inicializar un contexto WebGL" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Error desconocido al inicializar WebGL";
    return { supported: false, reason };
  }
};

export const useWebGLCheck = (): WebGLCheckResult => {
  return useMemo(() => {
    const result = runWebGLCheck();
    if (!result.supported) {
      const detail = result.reason ? `: ${result.reason}` : "";
      console.warn(`[map] WebGL no disponible${detail}`);
    }
    return result;
  }, []);
};

export default useWebGLCheck;
