import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Hook para calcular el progreso de rotación de un panel
 * @param duration Duración total del panel en milisegundos
 * @param isActive Si el panel está activo actualmente
 * @param onComplete Callback cuando se completa el progreso
 * @returns Objeto con progress, isComplete, reset, pause, resume
 */
export interface UseRotationProgressReturn {
  progress: number; // 0-100
  isComplete: boolean;
  reset: () => void;
  pause: () => void;
  resume: () => void;
}

export const useRotationProgress = (
  duration: number,
  isActive: boolean,
  onComplete?: () => void
): UseRotationProgressReturn => {
  const [progress, setProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const startTimeRef = useRef<number | null>(null);
  const pausedTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number | null>(null);
  const onCompleteRef = useRef(onComplete);

  // Mantener referencia actualizada del callback
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const updateProgress = useCallback(() => {
    if (!startTimeRef.current || isPaused) {
      return;
    }

    const now = Date.now();
    const elapsed = now - startTimeRef.current - pausedTimeRef.current;
    const newProgress = Math.min((elapsed / duration) * 100, 100);
    
    setProgress(newProgress);

    if (newProgress >= 100 && !isComplete) {
      setIsComplete(true);
      if (onCompleteRef.current) {
        onCompleteRef.current();
      }
      return;
    }

    if (newProgress < 100 && isActive && !isPaused) {
      animationFrameRef.current = requestAnimationFrame(updateProgress);
    }
  }, [duration, isActive, isPaused, isComplete]);

  const reset = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setProgress(0);
    setIsComplete(false);
    setIsPaused(false);
    startTimeRef.current = null;
    pausedTimeRef.current = 0;
  }, []);

  const pause = useCallback(() => {
    if (!isPaused && startTimeRef.current) {
      setIsPaused(true);
      pausedTimeRef.current += Date.now() - (startTimeRef.current + pausedTimeRef.current);
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    }
  }, [isPaused]);

  const resume = useCallback(() => {
    if (isPaused && isActive && !isComplete) {
      setIsPaused(false);
      if (startTimeRef.current === null) {
        startTimeRef.current = Date.now();
      }
      animationFrameRef.current = requestAnimationFrame(updateProgress);
    }
  }, [isPaused, isActive, isComplete, updateProgress]);

  useEffect(() => {
    if (!isActive || duration <= 0) {
      reset();
      return;
    }

    // Iniciar progreso cuando se activa
    if (startTimeRef.current === null) {
      startTimeRef.current = Date.now();
      pausedTimeRef.current = 0;
      setIsComplete(false);
      setProgress(0);
    }

    if (!isPaused && !isComplete) {
      animationFrameRef.current = requestAnimationFrame(updateProgress);
    }

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isActive, duration, isPaused, isComplete, updateProgress, reset]);

  return {
    progress,
    isComplete,
    reset,
    pause,
    resume
  };
};

