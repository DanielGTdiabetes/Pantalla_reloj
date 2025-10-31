import { StarIcon } from "../../icons";

type SaintsCardProps = {
  saints: string[];
};

const repeatItems = <T,>(items: T[]): T[] => {
  if (items.length === 0) {
    return items;
  }
  return [...items, ...items];
};

export const SaintsCard = ({ saints }: SaintsCardProps): JSX.Element => {
  const entries = saints.length > 0 ? saints : ["Sin onomásticas registradas"];
  const repeatedEntries = repeatItems(entries);

  return (
    <div className="card saints-card">
      <div className="saints-card__header">
        <StarIcon className="card-icon" aria-hidden="true" />
        <h2>Santoral</h2>
      </div>
      <div className="saints-card__scroller">
        <ul className="saints-card__list">
          {repeatedEntries.map((entry, index) => (
            // Usar índice completo para garantizar keys únicas (incluso después de duplicar)
            <li key={`saints-${index}`}>{entry}</li>
          ))}
        </ul>
        <div className="saints-card__gradient" aria-hidden="true" />
      </div>
    </div>
  );
};

export default SaintsCard;
