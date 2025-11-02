import { StarIcon } from "../../icons";

type SaintsCardProps = {
  saints: string[];
};

export const SaintsCard = ({ saints }: SaintsCardProps): JSX.Element => {
  // Filtrar entradas vacías y asegurar que sean strings válidos
  const entries = saints
    .map((entry) => (typeof entry === "string" ? entry.trim() : String(entry).trim()))
    .filter((entry) => entry && entry !== "" && entry !== "[object Object]" && !entry.toLowerCase().includes("object"))
    .filter((entry, index, self) => {
      // Eliminar duplicados adicionales (case-insensitive)
      const normalized = entry.toLowerCase();
      return self.findIndex((e) => e.toLowerCase() === normalized) === index;
    });

  const displayEntries = entries.length > 0 ? entries : ["Sin onomásticas registradas"];

  return (
    <div className="card saints-card">
      <div className="saints-card__header">
        <StarIcon className="card-icon" aria-hidden="true" />
        <h2>Santoral</h2>
      </div>
      <div className="saints-card__scroller">
        <ul className="saints-card__list">
          {displayEntries.map((entry, index) => (
            <li key={`saints-${index}-${entry.substring(0, 10)}`}>
              {entry}
            </li>
          ))}
        </ul>
        <div className="saints-card__gradient" aria-hidden="true" />
      </div>
    </div>
  );
};

export default SaintsCard;
