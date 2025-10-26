import { SproutIcon } from "../../icons";

type HarvestItem = {
  name: string;
  status?: string | null;
};

type HarvestCardProps = {
  items: HarvestItem[];
};

export const HarvestCard = ({ items }: HarvestCardProps): JSX.Element => {
  const entries = items.length > 0 ? items : [{ name: "Sin datos de cultivo" }];

  return (
    <div className="card harvest-card">
      <div className="harvest-card__header">
        <SproutIcon className="card-icon" aria-hidden="true" />
        <h2>Cosechas</h2>
      </div>
      <ul className="harvest-card__list">
        {entries.map((entry, index) => (
          <li key={`${entry.name}-${index}`}>
            <span className="harvest-card__item">{entry.name}</span>
            {entry.status ? <span className="harvest-card__status">{entry.status}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default HarvestCard;
