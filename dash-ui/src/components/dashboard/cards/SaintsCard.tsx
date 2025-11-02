import { StarIcon } from "../../icons";
import { useState, useEffect } from "react";

type SaintsCardProps = {
  saints: string[];
};

const SantoralIconImage: React.FC<{ size?: number; className?: string }> = ({ size = 48, className = "" }) => {
  const [iconError, setIconError] = useState(false);
  const iconPath = "/icons/misc/santoral.svg";
  const emojiFallback = "✨";

  useEffect(() => {
    setIconError(false);
  }, [iconPath]);

  if (iconError || !iconPath) {
    return (
      <span style={{ fontSize: `${size}px`, lineHeight: 1 }} className={className} role="img" aria-label="Santoral">
        {emojiFallback}
      </span>
    );
  }

  return (
    <img
      src={iconPath}
      alt="Santoral"
      className={className}
      style={{ width: `${size}px`, height: `${size}px`, objectFit: "contain" }}
      onError={() => setIconError(true)}
      loading="lazy"
    />
  );
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

  const displayEntries = entries.length > 0 ? entries : ["—"];

  return (
    <div className="card saints-card">
      <div className="saints-card__header">
        <SantoralIconImage size={48} className="card-icon" />
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
