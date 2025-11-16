import React, { useMemo } from "react";

type IconProps = React.SVGProps<SVGSVGElement>;

const createStrokeProps = (props: IconProps): IconProps => ({
  width: "1em",
  height: "1em",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  ...props
});

export const ClockIcon = (props: IconProps) => (
  <svg viewBox="0 0 24 24" {...createStrokeProps(props)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export const CloudIcon = (props: IconProps) => (
  <svg viewBox="0 0 24 24" {...createStrokeProps(props)}>
    <path d="M7 17a4 4 0 0 1 0-8 5 5 0 0 1 9.7-1.4A4.5 4.5 0 1 1 17 17Z" />
  </svg>
);

export const DropletsIcon = (props: IconProps) => (
  <svg viewBox="0 0 24 24" {...createStrokeProps(props)}>
    <path d="M7 12c0 3 2 5 4 5s4-2 4-5c0-2.5-2-5.5-4-7-2 1.5-4 4.5-4 7Z" />
    <path d="M16.5 11c1.5 1.2 2.5 2.8 2.5 4.5a3.5 3.5 0 0 1-3.5 3.5" />
  </svg>
);

export const WindIcon = (props: IconProps) => (
  <svg viewBox="0 0 24 24" {...createStrokeProps(props)}>
    <path d="M4 12h10a2 2 0 1 0-2-2" />
    <path d="M2 16h14a3 3 0 1 1-3 3" />
    <path d="M8 8h6a1.5 1.5 0 1 0-1.5-1.5" />
  </svg>
);

export const NewspaperIcon = (props: IconProps) => (
  <svg viewBox="0 0 24 24" {...createStrokeProps(props)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M7 8h6" />
    <path d="M7 12h10" />
    <path d="M7 16h10" />
  </svg>
);

export const BookOpenIcon = (props: IconProps) => (
  <svg viewBox="0 0 24 24" {...createStrokeProps(props)}>
    <path d="M12 6c-2-1.2-4-2-7-2v14c3 0 5 .8 7 2 2-1.2 4-2 7-2V4c-3 0-5 .8-7 2Z" />
    <path d="M12 6v14" />
  </svg>
);

export const CalendarIcon = (props: IconProps) => (
  <svg viewBox="0 0 24 24" {...createStrokeProps(props)}>
    <rect x="4" y="5" width="16" height="15" rx="2" />
    <path d="M8 3v4" />
    <path d="M16 3v4" />
    <path d="M4 10h16" />
  </svg>
);

export const MoonIcon = (props: IconProps) => (
  <svg viewBox="0 0 24 24" {...createStrokeProps(props)}>
    <path d="M14 3a7 7 0 1 0 7 7 5 5 0 0 1-7-7Z" />
  </svg>
);

export const SproutIcon = (props: IconProps) => (
  <svg viewBox="0 0 24 24" {...createStrokeProps(props)}>
    <path d="M12 22V12" />
    <path d="M12 12c0-4-2-7-7-7 0 5 3 7 7 7Z" />
    <path d="M12 12c0-4 2-7 7-7 0 5-3 7-7 7Z" />
  </svg>
);

export const StarIcon = (props: IconProps) => (
  <svg viewBox="0 0 24 24" {...createStrokeProps(props)}>
    <path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.5L12 16.8l-4.8 2.2.9-5.5L4 9.7l5.4-.8Z" />
  </svg>
);

export const SunriseIcon = (props: IconProps) => {
  const uniqueId = useMemo(() => `sunrise-${Math.random().toString(36).substr(2, 9)}`, []);
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" {...props}>
      <defs>
        {/* Gradiente para el cielo del amanecer */}
        <linearGradient id={`${uniqueId}-sky`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FF6B35" stopOpacity="0.4" />
          <stop offset="50%" stopColor="#F7931E" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#FFD23F" stopOpacity="0.2" />
        </linearGradient>
        {/* Gradiente para el sol */}
        <radialGradient id={`${uniqueId}-sun`} cx="50%" cy="50%">
          <stop offset="0%" stopColor="#FFD23F" />
          <stop offset="70%" stopColor="#F7931E" />
          <stop offset="100%" stopColor="#FF6B35" />
        </radialGradient>
      </defs>
      {/* Fondo del cielo con gradiente */}
      <rect x="0" y="0" width="24" height="20" fill={`url(#${uniqueId}-sky)`} />
      {/* Línea del horizonte */}
      <path d="M2 20h20" stroke="#8B4513" strokeWidth="2.5" strokeLinecap="round" />
      {/* Sol saliendo (mitad visible sobre el horizonte) */}
      <circle cx="12" cy="16" r="4.5" fill={`url(#${uniqueId}-sun)`} />
      <circle cx="12" cy="16" r="3.8" fill="#FFD23F" opacity="0.95" />
      {/* Rayos del sol hacia arriba */}
      <path d="M12 5v3.5" stroke="#FFD23F" strokeWidth="2" strokeLinecap="round" />
      <path d="M8.2 7.2l2.12 2.12" stroke="#FFD23F" strokeWidth="2" strokeLinecap="round" />
      <path d="M15.8 7.2l-2.12 2.12" stroke="#FFD23F" strokeWidth="2" strokeLinecap="round" />
      <path d="M4.5 12h3.5" stroke="#FFD23F" strokeWidth="2" strokeLinecap="round" />
      <path d="M16 12h3.5" stroke="#FFD23F" strokeWidth="2" strokeLinecap="round" />
      <path d="M8.2 16.8l2.12-2.12" stroke="#FFD23F" strokeWidth="2" strokeLinecap="round" />
      <path d="M15.8 16.8l-2.12-2.12" stroke="#FFD23F" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
};

export const SunsetIcon = (props: IconProps) => {
  const uniqueId = useMemo(() => `sunset-${Math.random().toString(36).substr(2, 9)}`, []);
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" {...props}>
      <defs>
        {/* Gradiente para el cielo del atardecer */}
        <linearGradient id={`${uniqueId}-sky`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FF6B35" stopOpacity="0.2" />
          <stop offset="50%" stopColor="#F7931E" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#FF6B35" stopOpacity="0.4" />
        </linearGradient>
        {/* Gradiente para el sol del atardecer (más cálido) */}
        <radialGradient id={`${uniqueId}-sun`} cx="50%" cy="50%">
          <stop offset="0%" stopColor="#FF8C42" />
          <stop offset="60%" stopColor="#FF6B35" />
          <stop offset="100%" stopColor="#E63946" />
        </radialGradient>
      </defs>
      {/* Fondo del cielo con gradiente */}
      <rect x="0" y="4" width="24" height="20" fill={`url(#${uniqueId}-sky)`} />
      {/* Línea del horizonte */}
      <path d="M2 4h20" stroke="#8B4513" strokeWidth="2.5" strokeLinecap="round" />
      {/* Sol poniéndose (mitad visible sobre el horizonte) */}
      <circle cx="12" cy="8" r="4.5" fill={`url(#${uniqueId}-sun)`} />
      <circle cx="12" cy="8" r="3.8" fill="#FF8C42" opacity="0.95" />
      {/* Rayos del sol hacia abajo */}
      <path d="M12 19v3.5" stroke="#FF8C42" strokeWidth="2" strokeLinecap="round" />
      <path d="M8.2 16.8l2.12 2.12" stroke="#FF8C42" strokeWidth="2" strokeLinecap="round" />
      <path d="M15.8 16.8l-2.12 2.12" stroke="#FF8C42" strokeWidth="2" strokeLinecap="round" />
      <path d="M4.5 12h3.5" stroke="#FF8C42" strokeWidth="2" strokeLinecap="round" />
      <path d="M16 12h3.5" stroke="#FF8C42" strokeWidth="2" strokeLinecap="round" />
      <path d="M8.2 7.2l2.12-2.12" stroke="#FF8C42" strokeWidth="2" strokeLinecap="round" />
      <path d="M15.8 7.2l-2.12-2.12" stroke="#FF8C42" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
};