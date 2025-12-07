import { MoonIcon } from "../../icons";

type MoonCardProps = {
  moonPhase: string | null;
  illumination: number | null;
};

const formatIllumination = (value: number | null): string => {
  if (value === null || Number.isNaN(value)) {
    return "--";
  }
  return `${Math.round(value)}%`;
};

const getMoonPhaseIcon = (illumination: number | null): string => {
  if (illumination === null || Number.isNaN(illumination)) {
    return "/icons/moon/moon-50.svg";
  }

  // Convertir a decimal (0.0-1.0) si viene como porcentaje (0-100)
  // Si el valor es > 1, asumimos que es porcentaje y lo normalizamos
  const illum = illumination > 1 ? illumination / 100 : illumination;
  const normalized = Math.max(0, Math.min(1, illum));

  if (normalized <= 0.12) {
    return "/icons/moon/moon-0.svg";
  } else if (normalized <= 0.37) {
    return "/icons/moon/moon-25.svg";
  } else if (normalized <= 0.62) {
    return "/icons/moon/moon-50.svg";
  } else if (normalized <= 0.87) {
    return "/icons/moon/moon-75.svg";
  } else {
    return "/icons/moon/moon-100.svg";
  }
};

export const MoonCard = ({ moonPhase, illumination }: MoonCardProps): JSX.Element => {
  const moonIconPath = getMoonPhaseIcon(illumination);

  return (
    <div className="card moon-card">
      <MoonIcon className="card-icon" aria-hidden="true" />
      <div className="moon-card__body">
        <img
          src={moonIconPath}
          alt="Fase lunar"
          className="moon-card__img"
          onError={(e) => {
            try {
              console.warn(`[MoonCard] Error al cargar icono: ${moonIconPath}`);
              const target = e.target as HTMLImageElement;
              if (target) {
                requestAnimationFrame(() => {
                  try {
                    target.style.display = "none";
                  } catch (err) { }
                });
              }
            } catch (error) { }
          }}
        />
        <p className="moon-card__phase">{moonPhase ?? "Sin datos"}</p>
        <p className="moon-card__illumination">Iluminación {formatIllumination(illumination)}</p>
      </div>

      <style>{`
        .moon-card {
          background: linear-gradient(135deg, rgba(8, 15, 30, 0.95), rgba(4, 10, 24, 0.98));
          color: white;
          text-shadow: 0 2px 4px rgba(0,0,0,0.5);
          position: relative;
          border-radius: 1.5rem;
          padding: 1.5rem;
          border: 1px solid rgba(255,255,255,0.1);
        }
        .moon-card__body {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1rem;
        }
        .moon-card__img {
          width: 80px;
          height: 80px;
          filter: drop-shadow(0 0 15px rgba(255,255,255,0.3));
          margin-bottom: 0.5rem;
        }
        .moon-card__phase {
          font-size: 1.75rem;
          font-weight: 700;
          margin: 0;
          line-height: 1.2;
          text-align: center;
        }
        .moon-card__illumination {
          font-size: 1.1rem;
          opacity: 0.7;
          margin: 0;
          text-align: center;
        }
        .card-icon {
            display: none;
        }
      `}</style>
    </div>
  );
};

export default MoonCard;
