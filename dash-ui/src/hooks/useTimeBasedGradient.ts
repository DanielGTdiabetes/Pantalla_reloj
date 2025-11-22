import { useEffect, useState } from "react";

/**
 * Hook para calcular el gradiente de fondo según la hora del día
 * @returns String con el gradiente CSS
 */
export const useTimeBasedGradient = (): string => {
  const [gradient, setGradient] = useState<string>("");

  useEffect(() => {
    const updateGradient = () => {
      const now = new Date();
      const hour = now.getHours();
      const minute = now.getMinutes();
      const totalMinutes = hour * 60 + minute;

      // Definir rangos de tiempo (en minutos desde medianoche)
      const DAWN_START = 5 * 60; // 5:00
      const DAWN_END = 7 * 60; // 7:00
      const MORNING_END = 12 * 60; // 12:00
      const NOON_END = 17 * 60; // 17:00
      const SUNSET_START = 17 * 60; // 17:00
      const SUNSET_END = 20 * 60; // 20:00
      const NIGHT_START = 20 * 60; // 20:00
      const NIGHT_END = 24 * 60; // 24:00 (medianoche)

      let newGradient = "";

      if (totalMinutes >= DAWN_START && totalMinutes < DAWN_END) {
        // Amanecer (5:00-7:00): Naranja/rosa/azul
        const progress = (totalMinutes - DAWN_START) / (DAWN_END - DAWN_START);
        newGradient = `linear-gradient(135deg, 
          rgba(255, 140, 0, ${0.3 - progress * 0.1}) 0%,
          rgba(255, 99, 71, ${0.25 - progress * 0.1}) 30%,
          rgba(70, 130, 180, ${0.2 + progress * 0.1}) 100%
        )`;
      } else if (totalMinutes >= DAWN_END && totalMinutes < MORNING_END) {
        // Mañana (7:00-12:00): Azul claro
        newGradient = `linear-gradient(135deg,
          rgba(135, 206, 250, 0.3) 0%,
          rgba(176, 224, 230, 0.25) 50%,
          rgba(255, 255, 255, 0.2) 100%
        )`;
      } else if (totalMinutes >= MORNING_END && totalMinutes < NOON_END) {
        // Mediodía (12:00-17:00): Azul brillante
        newGradient = `linear-gradient(135deg,
          rgba(100, 149, 237, 0.3) 0%,
          rgba(135, 206, 250, 0.25) 50%,
          rgba(176, 224, 230, 0.2) 100%
        )`;
      } else if (totalMinutes >= SUNSET_START && totalMinutes < SUNSET_END) {
        // Atardecer (17:00-20:00): Naranja/morado
        const progress = (totalMinutes - SUNSET_START) / (SUNSET_END - SUNSET_START);
        newGradient = `linear-gradient(135deg,
          rgba(255, 140, 0, ${0.3 - progress * 0.1}) 0%,
          rgba(255, 20, 147, ${0.25 - progress * 0.1}) 50%,
          rgba(138, 43, 226, ${0.2 + progress * 0.1}) 100%
        )`;
      } else {
        // Noche (20:00-5:00): Azul oscuro/negro
        newGradient = `linear-gradient(135deg,
          rgba(25, 25, 112, 0.3) 0%,
          rgba(0, 0, 0, 0.25) 50%,
          rgba(15, 23, 42, 0.2) 100%
        )`;
      }

      setGradient(newGradient);
    };

    // Actualizar inmediatamente
    updateGradient();

    // Actualizar cada minuto para transiciones suaves
    const interval = setInterval(updateGradient, 60000);

    return () => {
      clearInterval(interval);
    };
  }, []);

  return gradient;
};

