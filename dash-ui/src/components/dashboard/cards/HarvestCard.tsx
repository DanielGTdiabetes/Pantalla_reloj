import { SproutIcon } from "../../icons";

type HarvestItem = {
  name: string;
  status?: string | null;
};

type HarvestCardProps = {
  items: HarvestItem[];
};

const repeatItems = <T,>(items: T[]): T[] => {
  if (items.length === 0) {
    return items;
  }
  return [...items, ...items];
};

export const HarvestCard = ({ items }: HarvestCardProps): JSX.Element => {
  const entries = items.length > 0 ? items : [{ name: "Sin datos de cultivo" }];
  const repeatedEntries = repeatItems(entries);

  return (
    <div className="card harvest-card">
      <div className="harvest-card__header">
        <SproutIcon className="card-icon" aria-hidden="true" />
        <h2>Cosechas</h2>
      </div>
      <div className="harvest-card__scroller">
        <ul className="harvest-card__list">
          {repeatedEntries.map((entry, index) => (
            // Usar índice completo para garantizar keys únicas (incluso después de duplicar)
            <li key={`harvest-${index}`}>
              <span className="harvest-card__item">{entry.name}</span>
              {entry.status ? <span className="harvest-card__status">{entry.status}</span> : null}
            </li>
          ))}
        </ul>
        <div className="harvest-card__gradient" aria-hidden="true" />
      </div>
    </div>
  );
};

export default HarvestCard;
