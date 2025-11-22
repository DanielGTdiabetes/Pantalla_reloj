import { useEffect, useState } from "react";

/**
 * Hook para calcular el progreso de rotación de un panel
 * @param duration Duración total del panel en milisegundos
 * @param isActive Si el panel está activo actualmente
 * @returns Progreso de 0 a 100
 */
export const useRotationProgress = (
  duration: number,
  isActive: boolean
): number => {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!isActive || duration <= 0) {
      setProgress(0);
      return;
    }

    // Resetear progreso cuando el panel se activa
    setProgress(0);

    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const newProgress = Math.min((elapsed / duration) * 100, 100);
      setProgress(newProgress);

      if (newProgress >= 100) {
        clearInterval(interval);
      }
    }, 50); // Actualizar cada 50ms para suavidad

    return () => {
      clearInterval(interval);
    };
  }, [duration, isActive]);

  return progress;
};

