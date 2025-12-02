import { StarIcon } from "../../icons";
import { useState, useEffect } from "react";



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

export type EnrichedSaint = {
  name: string;
  bio?: string | null;
  image?: string | null;
  url?: string | null;
};

type SaintsCardProps = {
  saints: (string | EnrichedSaint)[];
};

export const SaintsCard = ({ saints }: SaintsCardProps): JSX.Element => {
  const [currentIndex, setCurrentIndex] = useState(0);

  // Normalize data to EnrichedSaint[]
  const entries: EnrichedSaint[] = saints
    .map((entry) => {
      if (typeof entry === "string") {
        return { name: entry.trim() };
      }
      return entry;
    })
    .filter((entry) => entry && entry.name && entry.name !== "" && !entry.name.toLowerCase().includes("object"));

  // Deduplicate
  const uniqueEntries = entries.filter((entry, index, self) =>
    self.findIndex((e) => e.name.toLowerCase() === entry.name.toLowerCase()) === index
  );

  const displayEntries = uniqueEntries.length > 0 ? uniqueEntries : [{ name: "—" }];

  // Rotation logic if we have multiple items
  useEffect(() => {
    if (displayEntries.length <= 1) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % displayEntries.length);
    }, 10000); // 10 seconds per saint
    return () => clearInterval(interval);
  }, [displayEntries.length]);

  const currentSaint = displayEntries[currentIndex];

  const formatSaintName = (name: string) => {
    if (name === "—") return name;
    const lower = name.toLowerCase();
    if (lower.startsWith("san ") || lower.startsWith("santa ") || lower.startsWith("santo ")) {
      return name;
    }
    if (lower === "maría" || lower === "maria" || name.endsWith("a")) {
      return `Santa ${name}`;
    }
    return `San ${name}`;
  };

  const hasImage = !!currentSaint.image;

  return (
    <div className={`card saints-card saints-card-enhanced ${hasImage ? "has-image" : ""}`}>
      {hasImage && (
        <div
          className="saint-background-image"
          style={{ backgroundImage: `url(${currentSaint.image})` }}
        />
      )}
      <div className="saints-card__header">
        <SantoralIconImage size={48} className="card-icon" />
        <h2>Santoral</h2>
      </div>

      <div className="saints-content">
        <div className="saint-display fade-in" key={currentIndex}>
          <h3 className="saint-name-large">{formatSaintName(currentSaint.name)}</h3>
          {currentSaint.bio && (
            <p className="saint-bio">{currentSaint.bio}</p>
          )}
          {!currentSaint.bio && !hasImage && (
            <div className="saint-placeholder">
              <span className="saint-icon-large">✝</span>
            </div>
          )}
        </div>

        {displayEntries.length > 1 && (
          <div className="saint-pagination">
            {displayEntries.map((_, idx) => (
              <span
                key={idx}
                className={`pagination-dot ${idx === currentIndex ? 'active' : ''}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SaintsCard;
