import { useMemo } from "react";

export type RotatingCardItem = {
  id: string;
  duration: number;
  render: () => JSX.Element;
};

type RotatingCardProps = {
  cards: RotatingCardItem[];
};

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

  // Mostrar siempre el primer card (la rotación se maneja en OverlayRotator)
  const CurrentCard = fallbackCards[0]?.render;

  return (
    <div className="rotating-card" role="region" aria-live="polite">
      <div className="rotating-card__content">
        {CurrentCard ? <CurrentCard /> : null}
      </div>
    </div>
  );
};

export default RotatingCard;