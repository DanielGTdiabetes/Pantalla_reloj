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
          className="h-16 w-16"
          style={{ margin: "0 auto", display: "block" }}
        />
        <p className="moon-card__phase">{moonPhase ?? "Sin datos"}</p>
        <p className="moon-card__illumination">Iluminación {formatIllumination(illumination)}</p>
      </div>
    </div>
  );
};

export default MoonCard;
