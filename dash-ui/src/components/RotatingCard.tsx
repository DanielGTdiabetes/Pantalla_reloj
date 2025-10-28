import { useEffect, useMemo, useRef, useState } from "react";

const signatureOf = (items: { id: string; duration: number }[]) =>
  items.map((item) => `${item.id}:${item.duration}`).join("|");

export type RotatingCardItem = {
  id: string;
  duration: number;
  render: () => JSX.Element;
};

type RotatingCardProps = {
  cards: RotatingCardItem[];
  disabled?: boolean;
};

const MIN_DURATION = 4000;
const TRANSITION_DURATION = 400;

export const RotatingCard = ({ cards, disabled = false }: RotatingCardProps): JSX.Element => {
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

  const sig = useMemo(() => signatureOf(fallbackCards), [fallbackCards]);
  const prevSigRef = useRef<string>(sig);

  useEffect(() => {
    if (prevSigRef.current !== sig) {
      prevSigRef.current = sig;
      setActiveIndex(0);
    }
  }, [sig]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.info(`[RotatingCard] signature → ${sig}`);
    }
  }, [sig]);

  const cardCount = fallbackCards.length;
  useEffect(() => {
    if (disabled) {
      setActiveIndex(0);
      return;
    }

    setActiveIndex((prev) => (prev >= cardCount ? 0 : prev));
  }, [cardCount, disabled]);

  useEffect(() => {
    if (disabled || cardCount === 0 || isTransitioning) {
      return undefined;
    }

    const current = fallbackCards[activeIndex];
    const duration = Math.max(current?.duration ?? MIN_DURATION, MIN_DURATION);

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
  }, [activeIndex, cardCount, disabled, isTransitioning, sig]);

  useEffect(() => () => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }
  }, []);

  const CurrentCard = (disabled ? fallbackCards[0] : fallbackCards[activeIndex])?.render;
  const isHidden = !disabled && isTransitioning;

  return (
    <div className="rotating-card" role="region" aria-live="polite">
      <div
        className={`rotating-card__content${isHidden ? " rotating-card__content--hidden" : ""}`}
      >
        {CurrentCard ? <CurrentCard /> : null}
      </div>
    </div>
  );
};

export default RotatingCard;
