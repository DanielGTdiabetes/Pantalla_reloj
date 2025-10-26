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

export const MoonCard = ({ moonPhase, illumination }: MoonCardProps): JSX.Element => {
  return (
    <div className="card moon-card">
      <MoonIcon className="card-icon" aria-hidden="true" />
      <div className="moon-card__body">
        <p className="moon-card__phase">{moonPhase ?? "Sin datos"}</p>
        <p className="moon-card__illumination">Iluminación {formatIllumination(illumination)}</p>
      </div>
    </div>
  );
};

export default MoonCard;
