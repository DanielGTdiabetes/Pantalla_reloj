import { StarIcon } from "../../icons";

type SaintsCardProps = {
  saints: string[];
};

export const SaintsCard = ({ saints }: SaintsCardProps): JSX.Element => {
  const entries = saints.length > 0 ? saints : ["Sin onomásticas registradas"];

  return (
    <div className="card saints-card">
      <div className="saints-card__header">
        <StarIcon className="card-icon" aria-hidden="true" />
        <h2>Santoral</h2>
      </div>
      <ul className="saints-card__list">
        {entries.map((entry, index) => (
          <li key={`${entry}-${index}`}>{entry}</li>
        ))}
      </ul>
    </div>
  );
};

export default SaintsCard;
