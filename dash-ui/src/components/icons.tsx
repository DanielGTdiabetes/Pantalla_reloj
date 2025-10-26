import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

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
