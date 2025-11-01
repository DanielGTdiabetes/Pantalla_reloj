import React from "react";

import { useConfig } from "../lib/useConfig";
import { LayerControls } from "./LayerControls";
import { OverlayRotator } from "./OverlayRotator";

export const RightPanel: React.FC = () => {
  const configState = useConfig();

  return (
    <div className="side-panel__inner">
      <LayerControls configState={configState} />
      <OverlayRotator configState={configState} />
    </div>
  );
};

export default RightPanel;
