import React from "react";

import { GeoScopeMap } from "../components/GeoScopeMap";
import { OverlayRotator } from "../components/OverlayRotator";

export default function Index(): JSX.Element {
  return (
    <div className="layout-root w-screen h-screen flex overflow-hidden bg-black text-white">
      <div className="layout-map flex-1 h-full">
        <GeoScopeMap />
      </div>
      <aside className="layout-aside h-full w-[460px] max-w-[520px] min-w-[400px] border-l border-white/10 bg-black/35 backdrop-blur-sm">
        <OverlayRotator />
      </aside>
    </div>
  );
}
