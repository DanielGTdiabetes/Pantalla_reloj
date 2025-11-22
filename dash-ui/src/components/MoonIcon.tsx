/**
 * Componente MoonIcon: Muestra iconos de fase lunar full-color ultra-realistas.
 * 
 * Características:
 * - Iconos SVG detallados de 12 fases lunares
 * - Soporte desde texto o porcentaje de iluminación
 * - Fallback a emoji si falla la carga
 * - Carga lazy de iconos
 */

import React, { useState, useEffect, useMemo } from "react";
import {
  getMoonPhaseFromText,
  getMoonPhaseFromIllumination,
  getMoonIconPath,
  getMoonIconEmoji,
  type MoonPhase,
} from "../lib/moon-icons";

type MoonIconProps = {
  phase?: string | null;
  illumination?: number | null;
  size?: number | string;
  className?: string;
  alt?: string;
};

export const MoonIcon: React.FC<MoonIconProps> = ({
  phase,
  illumination,
  size = 64,
  className = "",
  alt,
}) => {
  const [iconError, setIconError] = useState(false);
  const [iconLoaded, setIconLoaded] = useState(false);

  const moonPhase: MoonPhase = useMemo(() => {
    if (phase) {
      return getMoonPhaseFromText(phase);
    }
    if (illumination !== null && illumination !== undefined) {
      return getMoonPhaseFromIllumination(illumination);
    }
    return "new";
  }, [phase, illumination]);

  const iconPath = useMemo(() => getMoonIconPath(moonPhase), [moonPhase]);
  const emojiFallback = useMemo(() => getMoonIconEmoji(moonPhase), [moonPhase]);

  // Resetear error cuando cambia la fase
  useEffect(() => {
    setIconError(false);
    setIconLoaded(false);
  }, [iconPath]);

  const sizeStyle = typeof size === "number" ? `${size}px` : size;

  // Si falló la carga del icono, mostrar emoji
  if (iconError || !iconPath) {
    return (
      <span
        className={`moon-icon moon-icon--emoji ${className}`}
        style={{ fontSize: sizeStyle, lineHeight: 1 }}
        role="img"
        aria-label={alt || `Fase lunar: ${moonPhase}`}
      >
        {emojiFallback}
      </span>
    );
  }

  return (
    <img
      src={iconPath}
      alt={alt || `Fase lunar: ${moonPhase}`}
      className={`moon-icon moon-icon--image ${className}`}
      style={{
        width: sizeStyle,
        height: sizeStyle,
        objectFit: "contain",
        display: iconLoaded ? "block" : "none",
      }}
      onLoad={() => setIconLoaded(true)}
      onError={() => {
        try {
          setIconError(true);
          setIconLoaded(false);
        } catch (error) {
          // Prevenir que los errores se propaguen a React
          console.warn(`[MoonIcon] Error en manejador onError:`, error);
        }
      }}
      loading="lazy"
    />
  );
};
