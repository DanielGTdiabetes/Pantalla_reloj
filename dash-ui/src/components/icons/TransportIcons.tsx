import React from "react";

const baseProps = (size = 40, className?: string) => ({
  width: size,
  height: size,
  viewBox: "0 0 160 160",
  fill: "none",
  xmlns: "http://www.w3.org/2000/svg",
  className,
});

export const PlaneIcon: React.FC<{ size?: number; className?: string }> = ({ size = 40, className }) => (
  <svg {...baseProps(size, className)}>
    <defs>
      <linearGradient id="planeBody" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#9ce1ff" />
        <stop offset="100%" stopColor="#2563eb" />
      </linearGradient>
      <linearGradient id="planeWing" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#eff6ff" />
        <stop offset="100%" stopColor="#c7d2fe" />
      </linearGradient>
    </defs>
    <g filter="url(#shadow-plane)">
      <path d="M70 14c6-4 14-4 20 0l10 92-40-2 10-90z" fill="url(#planeBody)" />
      <path d="M40 104l36-12 12 0 32 12-44 12z" fill="url(#planeWing)" />
      <path d="M70 108l-20 34c-1 2 0 4 2 4h12l18-36-12-2z" fill="#bfdbfe" />
      <path d="M90 110l20 34c1 2 4 2 5 0l6-10c1-2 0-4-2-5l-27-21-2 2z" fill="#bfdbfe" />
      <circle cx="80" cy="30" r="10" fill="#1d4ed8" opacity="0.8" />
    </g>
    <filter id="shadow-plane" x="-30" y="-20" width="220" height="220" colorInterpolationFilters="sRGB">
      <feGaussianBlur stdDeviation="6" result="blur" />
      <feOffset dx="0" dy="6" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  </svg>
);

export const ShipIcon: React.FC<{ size?: number; className?: string }> = ({ size = 40, className }) => (
  <svg {...baseProps(size, className)}>
    <defs>
      <linearGradient id="shipHull" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#60a5fa" />
        <stop offset="100%" stopColor="#1e40af" />
      </linearGradient>
      <linearGradient id="shipDeck" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#f8fafc" />
        <stop offset="100%" stopColor="#cbd5e1" />
      </linearGradient>
    </defs>
    <g filter="url(#shadow-ship)">
      <path d="M36 100h88l-10 34c-1 4-5 6-9 6H55c-4 0-8-2-9-6l-10-34z" fill="url(#shipHull)" />
      <path d="M50 72h60l-6 24H56l-6-24z" fill="url(#shipDeck)" />
      <rect x="68" y="48" width="24" height="20" rx="4" fill="#0ea5e9" />
      <rect x="76" y="32" width="8" height="18" rx="4" fill="#e2e8f0" />
      <path d="M80 20c3 0 6 2 6 5s-3 5-6 5-6-2-6-5 3-5 6-5z" fill="#bae6fd" />
      <path d="M40 108h80c-12 10-26 16-40 16s-28-6-40-16z" fill="#0ea5e9" opacity="0.85" />
    </g>
    <filter id="shadow-ship" x="-20" y="-10" width="200" height="200" colorInterpolationFilters="sRGB">
      <feGaussianBlur stdDeviation="5" result="blur" />
      <feOffset dx="0" dy="4" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  </svg>
);

export default PlaneIcon;
