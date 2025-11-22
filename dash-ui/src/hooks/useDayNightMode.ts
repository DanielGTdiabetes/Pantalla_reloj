import { useEffect, useState } from "react";

/**
 * Hook para detectar y aplicar modo día/noche automáticamente
 * Modo día: 7:00 - 20:00
 * Modo noche: 20:00 - 7:00
 */
export const useDayNightMode = (timezone: string = "Europe/Madrid"): "day" | "night" => {
  const [mode, setMode] = useState<"day" | "night">("day");

  useEffect(() => {
    const updateMode = () => {
      const now = new Date();
      const hour = now.getHours();
      
      // Modo día: 7:00 - 20:00
      // Modo noche: 20:00 - 7:00
      const isDay = hour >= 7 && hour < 20;
      setMode(isDay ? "day" : "night");
      
      // Aplicar atributo data-theme al documento
      document.documentElement.setAttribute("data-theme", isDay ? "day" : "night");
    };

    // Actualizar inmediatamente
    updateMode();

    // Actualizar cada minuto para detectar cambios de modo
    const interval = setInterval(updateMode, 60000);

    return () => {
      clearInterval(interval);
    };
  }, [timezone]);

  return mode;
};

