import { useEffect, useMemo, useRef, useState } from "react";

export type RotatingCardItem = {
  id: string;
  duration: number;
  render: () => JSX.Element;
};

type RotatingCardProps = {
  cards: RotatingCardItem[];
};

const MIN_DURATION = 4000;
const TRANSITION_DURATION = 400;

export const RotatingCard = ({ cards }: RotatingCardProps): JSX.Element => {
  const fallbackCards = useMemo<RotatingCardItem[]>(() => {
    if (cards.length > 0) {
      return cards;
    }
    return [
      {
        id: "placeholder",
        duration: 6000,
        render: () => (
          <div className="card card--placeholder">
            <h2>Datos no disponibles</h2>
            <p>No hay módulos activos en este momento.</p>
          </div>
        )
      }
    ];
  }, [cards]);

  const [activeIndex, setActiveIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    setActiveIndex(0);
  }, [fallbackCards]);

  useEffect(() => {
    if (fallbackCards.length === 0) {
      return undefined;
    }

    const current = fallbackCards[activeIndex];
    const duration = Math.max(current.duration, MIN_DURATION);

    timeoutRef.current = window.setTimeout(() => {
      setIsTransitioning(true);
      window.setTimeout(() => {
        setActiveIndex((prev) => (prev + 1) % fallbackCards.length);
        setIsTransitioning(false);
      }, TRANSITION_DURATION);
    }, duration);

    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [activeIndex, fallbackCards]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const CurrentCard = fallbackCards[activeIndex]?.render;

  return (
    <div className="rotating-card" role="region" aria-live="polite">
      <div className={`rotating-card__content${isTransitioning ? " rotating-card__content--hidden" : ""}`}>
        {CurrentCard ? <CurrentCard /> : null}
      </div>
    </div>
  );
};

export default RotatingCard;
