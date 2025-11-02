import type { ReactNode } from "react";

import "../styles/map-frame.css";

type MapFrameProps = {
  className?: string;
  children?: ReactNode;
};

/**
 * TODO: Explore alternate clipping strategies (e.g., SVG clipPath or CSS mask-image)
 * if we ever need a more advanced pill shape or feathered edge treatment.
 */
export function MapFrame({ className, children }: MapFrameProps) {
  const outerClassName = className ? `map-frame ${className}` : "map-frame";

  return (
    <div className={outerClassName}>
      <div className="map-frame-inner">{children}</div>
    </div>
  );
}

