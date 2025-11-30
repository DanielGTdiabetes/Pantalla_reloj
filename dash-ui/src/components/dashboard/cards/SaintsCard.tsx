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

  const formatSaintName = (name: string) => {
    if (name === "—") return name;

    // Check if it already has a prefix
    const lower = name.toLowerCase();
    if (lower.startsWith("san ") || lower.startsWith("santa ") || lower.startsWith("santo ")) {
      return name;
    }

    // Simple heuristic for gender (Spanish)
    // Ends in 'a' -> Santa (exceptions exist, but good enough for simple logic)
    // Otherwise -> San
    // Exception: Maria -> Santa Maria
    if (lower === "maría" || lower === "maria" || name.endsWith("a")) {
      return `Santa ${name}`;
    }
    return `San ${name}`;
  };

  return (
    <div className="card saints-card saints-card-enhanced">
      <div className="saints-card__header">
        <SantoralIconImage size={48} className="card-icon" />
        <h2>Santoral</h2>
      </div>
      <div className="saints-card__scroller">
        <div className="saints-list">
          {displayEntries.map((entry, index) => (
            <div key={`saints-${index}-${entry.substring(0, 10)}`} className="saint-item">
              <span className="saint-icon">✝</span>
              <span className="saint-name large-text">{formatSaintName(entry)}</span>
            </div>
          ))}
        </div>
        <div className="saints-card__gradient" aria-hidden="true" />
      </div>
    </div>
  );
};

export default SaintsCard;
