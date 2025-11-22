import { useEffect, useRef, useState } from "react";

/**
 * Hook para detectar si el usuario prefiere movimiento reducido
 * @returns true si el usuario prefiere movimiento reducido
 */
export const useReducedMotion = (): boolean => {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mediaQuery.matches);

    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mediaQuery.addEventListener("change", handler);

    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  return reducedMotion;
};

/**
 * Función throttle para limitar la frecuencia de ejecución
 * @param func Función a throttlear
 * @param delay Delay en milisegundos
 * @returns Función throttled
 */
export const throttle = <T extends (...args: any[]) => any>(
  func: T,
  delay: number
): ((...args: Parameters<T>) => void) => {
  let lastCall = 0;
  return (...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastCall >= delay) {
      lastCall = now;
      func(...args);
    }
  };
};

/**
 * Función debounce para retrasar la ejecución
 * @param func Función a debouncear
 * @param delay Delay en milisegundos
 * @returns Función debounced
 */
export const debounce = <T extends (...args: any[]) => any>(
  func: T,
  delay: number
): ((...args: Parameters<T>) => void) => {
  let timeoutId: number | null = null;
  return (...args: Parameters<T>) => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = window.setTimeout(() => {
      func(...args);
    }, delay);
  };
};

/**
 * Hook para usar requestAnimationFrame de forma segura
 * @param callback Función a ejecutar en cada frame
 */
export const useAnimationFrame = (callback: (deltaTime: number) => void) => {
  const requestRef = useRef<number | null>(null);
  const previousTimeRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const animate = (time: number) => {
      const prevTime = previousTimeRef.current;
      if (prevTime !== undefined) {
        const deltaTime = time - prevTime;
        callback(deltaTime);
      }
      previousTimeRef.current = time;
      requestRef.current = requestAnimationFrame(animate);
    };

    requestRef.current = requestAnimationFrame(animate);
    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, [callback]);
};

/**
 * Hook para detectar si el dispositivo es de bajo rendimiento
 * @returns true si se detecta bajo rendimiento
 */
export const useLowPerformance = (): boolean => {
  const [lowPerformance, setLowPerformance] = useState(false);

  useEffect(() => {
    // Detectar hardware con pocos cores o memoria limitada
    const hardwareConcurrency = navigator.hardwareConcurrency || 2;
    const deviceMemory = (navigator as any).deviceMemory || 4;

    // Considerar bajo rendimiento si tiene menos de 4 cores o menos de 4GB RAM
    const isLow = hardwareConcurrency < 4 || deviceMemory < 4;

    setLowPerformance(isLow);
  }, []);

  return lowPerformance;
};

