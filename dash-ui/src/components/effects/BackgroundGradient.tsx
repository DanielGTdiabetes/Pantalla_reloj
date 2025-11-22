import React from "react";

import { useTimeBasedGradient } from "../../hooks/useTimeBasedGradient";

export const BackgroundGradient: React.FC = () => {
  const gradient = useTimeBasedGradient();

  return (
    <div
      className="background-gradient"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        background: gradient,
        pointerEvents: "none",
        zIndex: 0,
        transition: "background 5s ease"
      }}
      aria-hidden="true"
    />
  );
};

export default BackgroundGradient;

