import React, { useEffect, useMemo, useState } from "react";

import type { UIScrollSpeed } from "../types/config";

import { AutoScrollText } from "./AutoScrollText";

export type RotatingPanel = {
  id: string;
  title: string;
  content: string;
  direction: "left" | "up";
  enableScroll: boolean;
  speed: UIScrollSpeed;
  gap: number;
};

export type RotatingCardProps = {
  panels: RotatingPanel[];
  rotationEnabled: boolean;
  durationSeconds: number;
  containerClassName?: string;
  panelClassName?: string;
  titleClassName?: string;
  bodyClassName?: string;
};

const MIN_DURATION = 4;

export const RotatingCard: React.FC<RotatingCardProps> = ({
  panels,
  rotationEnabled,
  durationSeconds,
  containerClassName,
  panelClassName,
  titleClassName,
  bodyClassName
}) => {
  const safePanels = useMemo<RotatingPanel[]>(() => {
    if (panels.length > 0) {
      return panels;
    }
    return [
      {
        id: "placeholder",
        title: "Panel informativo",
        content: "Sin contenido disponible",
        direction: "left",
        enableScroll: false,
        speed: "normal",
        gap: 48
      }
    ];
  }, [panels]);

  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex(0);
  }, [safePanels]);

  useEffect(() => {
    if (!rotationEnabled || safePanels.length <= 1) {
      return undefined;
    }
    const interval = window.setInterval(() => {
      setActiveIndex((index) => (index + 1) % safePanels.length);
    }, Math.max(durationSeconds, MIN_DURATION) * 1000);
    return () => window.clearInterval(interval);
  }, [rotationEnabled, durationSeconds, safePanels.length]);

  const containerClasses = useMemo(
    () => ["rotating-card", containerClassName].filter(Boolean).join(" "),
    [containerClassName]
  );
  const titleClasses = useMemo(
    () => ["rotating-card__title", titleClassName].filter(Boolean).join(" "),
    [titleClassName]
  );
  const bodyClasses = useMemo(
    () => ["rotating-card__body", bodyClassName].filter(Boolean).join(" "),
    [bodyClassName]
  );

  return (
    <div className={containerClasses} role="region" aria-live="polite">
      {safePanels.map((panel, index) => {
        const isActive = index === activeIndex;
        return (
          <article
            key={`${panel.id}-${index}`}
            className={["rotating-card__panel", panelClassName, isActive ? "is-active" : ""].filter(Boolean).join(" ")}
            aria-hidden={isActive ? undefined : true}
          >
            <header className="rotating-card__header">
              <h2 className={titleClasses}>{panel.title}</h2>
            </header>
            <div className={bodyClasses}>
              <AutoScrollText
                content={panel.content}
                direction={panel.direction}
                enabled={panel.enableScroll}
                speed={panel.speed}
                gap={panel.gap}
              />
            </div>
          </article>
        );
      })}
    </div>
  );
};
