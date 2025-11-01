import React from "react";

import { OverlayRotator } from "./OverlayRotator";

export const RightPanel: React.FC = () => {
  return (
    <div className="side-panel__inner">
      <OverlayRotator />
    </div>
  );
};

export default RightPanel;
