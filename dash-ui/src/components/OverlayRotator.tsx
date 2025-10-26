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

  const hasCards = cards.length > 0;

  return (
    <div className="overlay-rotator" role="complementary" aria-live="polite">
      <div className="overlay-rotator__content">
        {hasCards ? (
          <RotatingCard cards={cards} />
        ) : (
          <div className="overlay-rotator__fallback" role="status">
            <p>Datos no disponibles</p>
          </div>
        )}
        <p className="overlay-rotator__status">{label}</p>
      </div>
    </div>
  );
};

export default OverlayRotator;
