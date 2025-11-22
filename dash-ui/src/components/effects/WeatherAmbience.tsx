import React from "react";

import { RainEffect } from "./RainEffect";
import { SnowEffect } from "./SnowEffect";
import { StarField } from "./StarField";

type WeatherAmbienceProps = {
  condition: string | null;
  isNight: boolean;
  windSpeed?: number;
  intensity?: "light" | "moderate" | "heavy";
};

export const WeatherAmbience: React.FC<WeatherAmbienceProps> = ({
  condition,
  isNight,
  windSpeed = 0,
  intensity = "moderate"
}) => {
  if (!condition) {
    // Si es noche y está despejado, mostrar estrellas
    if (isNight) {
      return <StarField density="normal" showShootingStars={true} />;
    }
    return null;
  }

  const conditionLower = condition.toLowerCase().trim();

  // Determinar qué efecto mostrar
  if (conditionLower.includes("nieve") || conditionLower.includes("snow") || conditionLower.includes("nevando")) {
    return <SnowEffect intensity={intensity} windSpeed={windSpeed} />;
  }

  if (
    conditionLower.includes("lluvia") ||
    conditionLower.includes("rain") ||
    conditionLower.includes("lluvioso") ||
    conditionLower.includes("precipitación") ||
    conditionLower.includes("chubascos")
  ) {
    return <RainEffect intensity={intensity} windSpeed={windSpeed} showSplash={true} />;
  }

  // Si está despejado y es noche, mostrar estrellas
  if (
    (conditionLower.includes("despejado") ||
      conditionLower.includes("clear") ||
      conditionLower.includes("soleado") ||
      conditionLower.includes("sunny")) &&
    isNight
  ) {
    return <StarField density="normal" showShootingStars={true} />;
  }

  return null;
};

export default WeatherAmbience;

