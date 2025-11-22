import React from "react";

type AnimatedWeatherIconProps = {
  condition: string | null;
  size?: number;
  className?: string;
};

/**
 * Componente de sol animado con rayos rotando
 */
const AnimatedSun: React.FC<{ size: number; className?: string }> = ({ size, className }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={`animated-weather-icon animated-weather-icon--sun ${className || ""}`}
      aria-label="Sol"
    >
      <defs>
        <radialGradient id="sunGradient">
          <stop offset="0%" stopColor="#FFD700" />
          <stop offset="50%" stopColor="#FFA500" />
          <stop offset="100%" stopColor="#FF8C00" />
        </radialGradient>
      </defs>
      {/* Rayos exteriores */}
      {[...Array(8)].map((_, i) => {
        const angle = (i * 360) / 8;
        const rad = (angle * Math.PI) / 180;
        const x1 = 50 + 35 * Math.cos(rad);
        const y1 = 50 + 35 * Math.sin(rad);
        const x2 = 50 + 45 * Math.cos(rad);
        const y2 = 50 + 45 * Math.sin(rad);
        return (
          <line
            key={`ray-${i}`}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="url(#sunGradient)"
            strokeWidth="3"
            className="sun-ray"
          />
        );
      })}
      {/* Círculo central del sol */}
      <circle cx="50" cy="50" r="25" fill="url(#sunGradient)" className="sun-core" />
    </svg>
  );
};

/**
 * Componente de nubes animadas moviéndose
 */
const AnimatedClouds: React.FC<{ size: number; className?: string }> = ({ size, className }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={`animated-weather-icon animated-weather-icon--cloud ${className || ""}`}
      aria-label="Nubes"
    >
      <defs>
        <linearGradient id="cloudGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#E0E0E0" />
          <stop offset="100%" stopColor="#B0B0B0" />
        </linearGradient>
      </defs>
      {/* Nube principal */}
      <ellipse cx="50" cy="60" rx="30" ry="20" fill="url(#cloudGradient)" className="cloud-main" />
      <ellipse cx="35" cy="55" rx="20" ry="15" fill="url(#cloudGradient)" className="cloud-left" />
      <ellipse cx="65" cy="55" rx="20" ry="15" fill="url(#cloudGradient)" className="cloud-right" />
    </svg>
  );
};

/**
 * Componente de lluvia animada
 */
const AnimatedRain: React.FC<{ size: number; className?: string }> = ({ size, className }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={`animated-weather-icon animated-weather-icon--rain ${className || ""}`}
      aria-label="Lluvia"
    >
      {/* Nube de fondo */}
      <ellipse cx="50" cy="40" rx="25" ry="15" fill="#808080" opacity="0.6" />
      <ellipse cx="40" cy="38" rx="15" ry="10" fill="#808080" opacity="0.6" />
      <ellipse cx="60" cy="38" rx="15" ry="10" fill="#808080" opacity="0.6" />
      {/* Gotas de lluvia */}
      {[...Array(6)].map((_, i) => {
        const x = 30 + (i * 8);
        const delay = i * 0.1;
        return (
          <line
            key={`drop-${i}`}
            x1={x}
            y1={55 + (i % 2) * 5}
            x2={x}
            y2={65 + (i % 2) * 5}
            stroke="#4A90E2"
            strokeWidth="2"
            className="rain-drop"
            style={{ animationDelay: `${delay}s` }}
          />
        );
      })}
    </svg>
  );
};

/**
 * Componente de nieve animada
 */
const AnimatedSnow: React.FC<{ size: number; className?: string }> = ({ size, className }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={`animated-weather-icon animated-weather-icon--snow ${className || ""}`}
      aria-label="Nieve"
    >
      {/* Nube de fondo */}
      <ellipse cx="50" cy="40" rx="25" ry="15" fill="#E0E0E0" opacity="0.7" />
      <ellipse cx="40" cy="38" rx="15" ry="10" fill="#E0E0E0" opacity="0.7" />
      <ellipse cx="60" cy="38" rx="15" ry="10" fill="#E0E0E0" opacity="0.7" />
      {/* Copos de nieve */}
      {[...Array(8)].map((_, i) => {
        const x = 25 + (i % 4) * 16;
        const y = 55 + Math.floor(i / 4) * 20;
        const delay = i * 0.15;
        return (
          <g key={`flake-${i}`} className="snowflake" style={{ animationDelay: `${delay}s` }}>
            <circle cx={x} cy={y} r="3" fill="#FFFFFF" />
            <line x1={x} y1={y - 5} x2={x} y2={y + 5} stroke="#FFFFFF" strokeWidth="1" />
            <line x1={x - 5} y1={y} x2={x + 5} y2={y} stroke="#FFFFFF" strokeWidth="1" />
          </g>
        );
      })}
    </svg>
  );
};

/**
 * Componente de tormenta con rayo parpadeante
 */
const AnimatedThunderstorm: React.FC<{ size: number; className?: string }> = ({ size, className }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={`animated-weather-icon animated-weather-icon--thunderstorm ${className || ""}`}
      aria-label="Tormenta"
    >
      {/* Nube oscura */}
      <ellipse cx="50" cy="40" rx="25" ry="15" fill="#404040" />
      <ellipse cx="40" cy="38" rx="15" ry="10" fill="#404040" />
      <ellipse cx="60" cy="38" rx="15" ry="10" fill="#404040" />
      {/* Rayo */}
      <path
        d="M 50 45 L 45 60 L 50 60 L 48 75 L 55 55 L 50 55 Z"
        fill="#FFD700"
        className="lightning"
      />
      {/* Gotas de lluvia */}
      {[...Array(4)].map((_, i) => (
        <line
          key={`storm-drop-${i}`}
          x1={35 + i * 8}
          y1={60}
          x2={35 + i * 8}
          y2={70}
          stroke="#4A90E2"
          strokeWidth="2"
          className="rain-drop"
        />
      ))}
    </svg>
  );
};

/**
 * Componente de niebla con opacidad variable
 */
const AnimatedFog: React.FC<{ size: number; className?: string }> = ({ size, className }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={`animated-weather-icon animated-weather-icon--fog ${className || ""}`}
      aria-label="Niebla"
    >
      {/* Capas de niebla */}
      {[...Array(4)].map((_, i) => (
        <ellipse
          key={`fog-${i}`}
          cx={50}
          cy={40 + i * 15}
          rx={30 - i * 3}
          ry={8}
          fill="#C0C0C0"
          opacity={0.4 + i * 0.15}
          className="fog-layer"
          style={{ animationDelay: `${i * 0.2}s` }}
        />
      ))}
    </svg>
  );
};

/**
 * Componente de parcialmente nublado (sol con nubes)
 */
const AnimatedPartlyCloudy: React.FC<{ size: number; className?: string }> = ({ size, className }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={`animated-weather-icon animated-weather-icon--partly-cloudy ${className || ""}`}
      aria-label="Parcialmente nublado"
    >
      <defs>
        <radialGradient id="partlySunGradient">
          <stop offset="0%" stopColor="#FFD700" />
          <stop offset="100%" stopColor="#FFA500" />
        </radialGradient>
        <linearGradient id="partlyCloudGradient">
          <stop offset="0%" stopColor="#E0E0E0" />
          <stop offset="100%" stopColor="#B0B0B0" />
        </linearGradient>
      </defs>
      {/* Sol parcialmente visible */}
      <circle cx="35" cy="35" r="15" fill="url(#partlySunGradient)" className="sun-core" />
      {/* Nube pasando */}
      <ellipse cx="60" cy="50" rx="20" ry="12" fill="url(#partlyCloudGradient)" className="cloud-main" />
      <ellipse cx="50" cy="48" rx="12" ry="8" fill="url(#partlyCloudGradient)" className="cloud-left" />
      <ellipse cx="70" cy="48" rx="12" ry="8" fill="url(#partlyCloudGradient)" className="cloud-right" />
    </svg>
  );
};

/**
 * Componente principal que selecciona el icono animado según la condición
 */
export const AnimatedWeatherIcon: React.FC<AnimatedWeatherIconProps> = ({
  condition,
  size = 80,
  className = ""
}) => {
  if (!condition) {
    return <AnimatedClouds size={size} className={className} />;
  }

  const conditionLower = condition.toLowerCase().trim();

  // Mapeo de condiciones a iconos animados
  if (conditionLower.includes("sol") || conditionLower.includes("sunny") || conditionLower.includes("clear") || conditionLower.includes("despejado")) {
    return <AnimatedSun size={size} className={className} />;
  }
  
  if (conditionLower.includes("tormenta") || conditionLower.includes("storm") || conditionLower.includes("rayo") || conditionLower.includes("thunder")) {
    return <AnimatedThunderstorm size={size} className={className} />;
  }
  
  if (conditionLower.includes("nieve") || conditionLower.includes("snow")) {
    return <AnimatedSnow size={size} className={className} />;
  }
  
  if (conditionLower.includes("lluvia") || conditionLower.includes("rain") || conditionLower.includes("precipitación")) {
    return <AnimatedRain size={size} className={className} />;
  }
  
  if (conditionLower.includes("niebla") || conditionLower.includes("fog") || conditionLower.includes("mist") || conditionLower.includes("neblina")) {
    return <AnimatedFog size={size} className={className} />;
  }
  
  if (conditionLower.includes("parcial") || conditionLower.includes("partly") || conditionLower.includes("intervalos")) {
    return <AnimatedPartlyCloudy size={size} className={className} />;
  }
  
  // Por defecto: nubes
  return <AnimatedClouds size={size} className={className} />;
};

export default AnimatedWeatherIcon;

