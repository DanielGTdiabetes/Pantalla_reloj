/**
 * Componente WeatherIcon: Muestra iconos climáticos full-color ultra-realistas.
 * 
 * Características:
 * - Iconos SVG con gradientes y detalles
 * - Soporte día/noche automático
 * - Fallback a emoji si falla la carga
 * - Carga lazy de iconos
 */

import React, { useState, useEffect, useMemo } from "react";
import { normalizeWeatherCondition, getWeatherIconPath, getWeatherIconEmoji, getTimeOfDay, type WeatherCondition, type TimeOfDay } from "../lib/weather-icons";

type WeatherIconProps = {
  condition?: string | null;
  timezone?: string;
  size?: number | string;
  className?: string;
  alt?: string;
};

export const WeatherIcon: React.FC<WeatherIconProps> = ({
  condition,
  timezone = "Europe/Madrid",
  size = 64,
  className = "",
  alt,
}) => {
  const [iconError, setIconError] = useState(false);
  const [iconLoaded, setIconLoaded] = useState(false);

  const normalizedCondition = useMemo(
    () => normalizeWeatherCondition(condition),
    [condition]
  );

  const timeOfDay = useMemo(() => getTimeOfDay(timezone), [timezone]);

  const iconPath = useMemo(
    () => getWeatherIconPath(normalizedCondition, timeOfDay),
    [normalizedCondition, timeOfDay]
  );

  const emojiFallback = useMemo(
    () => getWeatherIconEmoji(normalizedCondition, timeOfDay),
    [normalizedCondition, timeOfDay]
  );

  // Resetear error cuando cambia la condición
  useEffect(() => {
    setIconError(false);
    setIconLoaded(false);
  }, [iconPath]);

  const sizeStyle = typeof size === "number" ? `${size}px` : size;

  // Si falló la carga del icono, mostrar emoji
  if (iconError || !iconPath) {
    return (
      <span
        className={`weather-icon weather-icon--emoji ${className}`}
        style={{ fontSize: sizeStyle, lineHeight: 1 }}
        role="img"
        aria-label={alt || `Icono del clima: ${normalizedCondition}`}
      >
        {emojiFallback}
      </span>
    );
  }

  return (
    <img
      src={iconPath}
      alt={alt || `Icono del clima: ${normalizedCondition}`}
      className={`weather-icon weather-icon--image ${className}`}
      style={{
        width: sizeStyle,
        height: sizeStyle,
        objectFit: "contain",
        display: iconLoaded ? "block" : "none",
      }}
      onLoad={() => setIconLoaded(true)}
      onError={() => {
        setIconError(true);
        setIconLoaded(false);
      }}
      loading="lazy"
    />
  );
};
