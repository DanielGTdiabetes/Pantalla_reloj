import React, { useEffect, useMemo, useState } from "react";

import { OverlayRotator } from "./OverlayRotator";

type DaySlot = "morning" | "afternoon" | "evening" | "night";

const getSlotFromDate = (date: Date): DaySlot => {
  const hour = date.getHours();

  if (hour >= 6 && hour < 11) return "morning";
  if (hour >= 11 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
};

const SLOT_TO_BG: Record<DaySlot, string> = {
  morning: "/img/panels/time/morning.webp",
  afternoon: "/img/panels/time/afternoon.webp",
  evening: "/img/panels/time/evening.webp",
  night: "/img/panels/time/night.webp",
};

export const RightPanel: React.FC = () => {
  const [slot, setSlot] = useState<DaySlot>(getSlotFromDate(new Date()));
  const [backgroundUrl, setBackgroundUrl] = useState<string>(SLOT_TO_BG[getSlotFromDate(new Date())]);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const update = () => {
      setSlot((prev) => {
        const next = getSlotFromDate(new Date());
        return prev === next ? prev : next;
      });
    };

    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, []);

  const backgroundClass = useMemo(() => SLOT_TO_BG[slot], [slot]);

  useEffect(() => {
    setIsVisible(false);
    const id = setTimeout(() => {
      setBackgroundUrl(backgroundClass);
      setIsVisible(true);
    }, 30);

    return () => clearTimeout(id);
  }, [backgroundClass]);

  return (
    <div className="side-panel__inner">
      <div
        className={`side-panel__background ${isVisible ? "is-visible" : ""}`}
        style={{ backgroundImage: `url(${backgroundUrl})` }}
        aria-hidden="true"
      />
      <OverlayRotator />

      <style>{`
        .side-panel__inner {
          position: relative;
          overflow: hidden;
        }

        .side-panel__background {
          position: absolute;
          inset: 0;
          background-size: cover;
          background-position: center;
          opacity: 0;
          transition: opacity 300ms ease-in-out;
          filter: saturate(1.05) brightness(1.05);
          z-index: 0;
        }

        .side-panel__background.is-visible {
          opacity: 1;
        }

        .side-panel__inner > *:not(.side-panel__background) {
          position: relative;
          z-index: 1;
        }
      `}</style>
    </div>
  );
};

export default RightPanel;
