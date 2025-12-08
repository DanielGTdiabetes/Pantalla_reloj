import React from "react";
import type { WeatherKind } from "../../types/weather";

interface BaseWeatherIconProps {
  animated?: boolean;
  size?: number;
  className?: string;
}

interface WeatherIconProps extends BaseWeatherIconProps {
  kind: WeatherKind;
}

const sharedProps = (size: number, className?: string) => ({
  width: size,
  height: size,
  className,
  viewBox: "0 0 160 160",
  fill: "none",
  xmlns: "http://www.w3.org/2000/svg",
});

const Glow = () => (
  <defs>
    <filter id="shadow" x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
      <feGaussianBlur stdDeviation="6" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
    <linearGradient id="sunGradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#FFE07D" />
      <stop offset="100%" stopColor="#FFB347" />
    </linearGradient>
    <linearGradient id="cloudGradient" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.95" />
      <stop offset="100%" stopColor="#C7D2FE" stopOpacity="0.95" />
    </linearGradient>
    <linearGradient id="rainGradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#7DD3FC" />
      <stop offset="100%" stopColor="#2563EB" />
    </linearGradient>
    <linearGradient id="stormGradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#FDE68A" />
      <stop offset="100%" stopColor="#F59E0B" />
    </linearGradient>
    <linearGradient id="snowGradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#E0F2FE" />
      <stop offset="100%" stopColor="#A5B4FC" />
    </linearGradient>
  </defs>
);

const SunnyIcon = ({ size = 96, animated = true, className }: BaseWeatherIconProps) => (
  <svg {...sharedProps(size, className)}>
    <Glow />
    <g filter="url(#shadow)">
      <circle cx="80" cy="80" r="38" fill="url(#sunGradient)" className={animated ? "wi-spin" : ""} />
      {animated && (
        <g className="wi-pulse" stroke="#FFD166" strokeWidth="4" strokeLinecap="round">
          {Array.from({ length: 8 }).map((_, idx) => {
            const angle = (idx * Math.PI) / 4;
            const x1 = 80 + Math.cos(angle) * 56;
            const y1 = 80 + Math.sin(angle) * 56;
            const x2 = 80 + Math.cos(angle) * 70;
            const y2 = 80 + Math.sin(angle) * 70;
            return <line key={idx} x1={x1} y1={y1} x2={x2} y2={y2} />;
          })}
        </g>
      )}
    </g>
  </svg>
);

const CloudLayers = ({ opacity = 1, offsetY = 0 }: { opacity?: number; offsetY?: number }) => (
  <g opacity={opacity} transform={`translate(0 ${offsetY})`}>
    <path
      d="M40 100c-10 0-18 8-18 18s8 18 18 18h76c12 0 22-10 22-22s-10-22-22-22c-2 0-4 0-6 1-2-16-16-29-32-29-14 0-27 9-31 23-1-1-3-1-5-1z"
      fill="url(#cloudGradient)"
    />
  </g>
);

const PartlyCloudyIcon = ({ size = 96, animated = true, className }: BaseWeatherIconProps) => (
  <svg {...sharedProps(size, className)}>
    <Glow />
    <SunnyIcon size={60} animated={animated} />
    <CloudLayers opacity={1} offsetY={18} />
  </svg>
);

const CloudyIcon = ({ size = 96, className }: BaseWeatherIconProps) => (
  <svg {...sharedProps(size, className)}>
    <Glow />
    <CloudLayers opacity={0.85} offsetY={-4} />
    <CloudLayers opacity={0.95} offsetY={16} />
  </svg>
);

const FogIcon = ({ size = 96, className }: BaseWeatherIconProps) => (
  <svg {...sharedProps(size, className)}>
    <Glow />
    <CloudLayers opacity={0.7} offsetY={8} />
    <g stroke="#C7D2FE" strokeWidth="6" strokeLinecap="round" opacity={0.8}>
      <line x1="40" y1="116" x2="120" y2="116" />
      <line x1="32" y1="130" x2="112" y2="130" />
      <line x1="48" y1="144" x2="128" y2="144" />
    </g>
  </svg>
);

const RainIcon = ({ size = 96, animated = true, className }: BaseWeatherIconProps) => (
  <svg {...sharedProps(size, className)}>
    <Glow />
    <CloudLayers opacity={0.95} />
    <g className={animated ? "wi-fall" : ""}>
      {Array.from({ length: 6 }).map((_, idx) => (
        <rect
          key={idx}
          x={46 + idx * 14}
          y={110 + (idx % 2) * 4}
          width="6"
          height="18"
          rx="3"
          fill="url(#rainGradient)"
          opacity={0.8}
        />
      ))}
    </g>
  </svg>
);

const SleetIcon = ({ size = 96, animated = true, className }: BaseWeatherIconProps) => (
  <svg {...sharedProps(size, className)}>
    <Glow />
    <CloudLayers opacity={0.95} />
    <g className={animated ? "wi-fall" : ""}>
      {Array.from({ length: 3 }).map((_, idx) => (
        <rect key={`r-${idx}`} x={46 + idx * 22} y={110} width="6" height="18" rx="3" fill="url(#rainGradient)" />
      ))}
      {Array.from({ length: 3 }).map((_, idx) => (
        <circle key={`s-${idx}`} cx={60 + idx * 18} cy={136} r="6" fill="url(#snowGradient)" />
      ))}
    </g>
  </svg>
);

const SnowIcon = ({ size = 96, animated = true, className }: BaseWeatherIconProps) => (
  <svg {...sharedProps(size, className)}>
    <Glow />
    <CloudLayers opacity={0.92} />
    <g className={animated ? "wi-fall" : ""}>
      {Array.from({ length: 6 }).map((_, idx) => (
        <path
          key={idx}
          d="M0 -8 L4 0 L0 8 L-4 0Z"
          transform={`translate(${52 + idx * 14} ${126 + (idx % 2) * 6}) rotate(45)`}
          fill="url(#snowGradient)"
          opacity={0.92}
        />
      ))}
    </g>
  </svg>
);

const ThunderIcon = ({ size = 96, animated = true, className }: BaseWeatherIconProps) => (
  <svg {...sharedProps(size, className)}>
    <Glow />
    <CloudLayers opacity={0.9} />
    <polygon
      points="88,102 104,104 86,134 98,132 74,164 82,134 68,134"
      fill="url(#stormGradient)"
      className={animated ? "wi-bounce" : ""}
    />
  </svg>
);

const UnknownIcon = ({ size = 96, className }: BaseWeatherIconProps) => (
  <svg {...sharedProps(size, className)}>
    <Glow />
    <circle cx="80" cy="80" r="42" fill="#1F2937" opacity="0.9" />
    <text x="80" y="94" textAnchor="middle" fontSize="56" fill="#E5E7EB" fontWeight="800">?</text>
  </svg>
);

export const WeatherIcon: React.FC<WeatherIconProps> = ({ kind, animated = true, size = 64, className }) => {
  switch (kind) {
    case "clear":
      return <SunnyIcon animated={animated} size={size} className={className} />;
    case "partly_cloudy":
      return <PartlyCloudyIcon animated={animated} size={size} className={className} />;
    case "cloudy":
      return <CloudyIcon animated={animated} size={size} className={className} />;
    case "fog":
      return <FogIcon animated={animated} size={size} className={className} />;
    case "rain":
      return <RainIcon animated={animated} size={size} className={className} />;
    case "sleet":
      return <SleetIcon animated={animated} size={size} className={className} />;
    case "snow":
      return <SnowIcon animated={animated} size={size} className={className} />;
    case "thunderstorm":
      return <ThunderIcon animated={animated} size={size} className={className} />;
    default:
      return <UnknownIcon animated={animated} size={size} className={className} />;
  }
};

export default WeatherIcon;
