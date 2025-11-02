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
  
  const illum = Math.round(illumination);
  
  if (illum === 0 || illum < 12.5) {
    return "/icons/moon/moon-0.svg";
  } else if (illum < 37.5) {
    return "/icons/moon/moon-25.svg";
  } else if (illum < 62.5) {
    return "/icons/moon/moon-50.svg";
  } else if (illum < 87.5) {
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
          alt={moonPhase ?? "Fase lunar"} 
          className="moon-card__image"
          style={{ width: "64px", height: "64px", margin: "0 auto", display: "block" }}
        />
        <p className="moon-card__phase">{moonPhase ?? "Sin datos"}</p>
        <p className="moon-card__illumination">Iluminación {formatIllumination(illumination)}</p>
      </div>
    </div>
  );
};

export default MoonCard;
