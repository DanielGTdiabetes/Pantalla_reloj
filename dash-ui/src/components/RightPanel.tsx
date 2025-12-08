import React, { useEffect, useMemo, useState } from "react";

import { OverlayRotator } from "./OverlayRotator";
import { getPanelBackgroundClass, getPanelTimeOfDay } from "../theme/panelTheme";

export const RightPanel: React.FC = () => {
  const [timeOfDay, setTimeOfDay] = useState(getPanelTimeOfDay(new Date()));

  useEffect(() => {
    const update = () => {
      setTimeOfDay((prev) => {
        const next = getPanelTimeOfDay(new Date());
        return next === prev ? prev : next;
      });
    };

    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, []);

  const backgroundClass = useMemo(() => getPanelBackgroundClass(timeOfDay), [timeOfDay]);

  return (
    <div className={`side-panel__inner ${backgroundClass}`}>
      <OverlayRotator />
    </div>
  );
};

export default RightPanel;
