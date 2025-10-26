import React, { useMemo } from "react";

import { RotatingCard, type RotatingCardItem } from "./RotatingCard";

type OverlayRotatorProps = {
  cards: RotatingCardItem[];
  status?: string | null;
  isLoading?: boolean;
};

export const OverlayRotator: React.FC<OverlayRotatorProps> = ({ cards, status, isLoading }) => {
  const label = useMemo(() => {
    if (isLoading) {
      return "Sincronizando datos…";
    }
    if (status && status.trim().length > 0) {
      return status;
    }
    return "datos no disponibles";
  }, [isLoading, status]);

  return (
    <div className="overlay-rotator" role="complementary" aria-live="polite">
      <div className="overlay-rotator__panel">
        <RotatingCard cards={cards} />
        <p className="overlay-rotator__status">{label}</p>
      </div>
    </div>
  );
};

export default OverlayRotator;
