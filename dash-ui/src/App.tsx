import React from "react";
import { Route, Routes } from "react-router-dom";

import GeoScopeMap from "./components/GeoScope/GeoScopeMap";
import MapFallback from "./components/MapFallback";
import MapFrame from "./components/MapFrame";
import SafeModePlaceholder from "./components/SafeModePlaceholder";
import { RightPanel } from "./components/RightPanel";
import useConfigWatcher from "./hooks/useConfigWatcher";
import { useConfigStore } from "./state/configStore";
import useWebglStatus from "./hooks/useWebglStatus";
import { ConfigPage } from "./pages/ConfigPage";
import { SAFE_MODE_ENABLED } from "./utils/safeMode";

const DashboardShell: React.FC = () => {
  const { timezone } = useConfigStore((snapshot) => ({
    timezone: snapshot.config?.display.timezone ?? "Europe/Madrid"
  }));
  const webgl = useWebglStatus();
  const safeMode = SAFE_MODE_ENABLED;
  const showFallback = !safeMode && webgl.status === "unavailable";
  const shellClassName = "app-shell";

  return (
    <div className={shellClassName}>
      <MapFrame className="map-area">
        {safeMode ? (
          <SafeModePlaceholder timezone={timezone} />
        ) : showFallback ? (
          <MapFallback timezone={timezone} reason={webgl.reason} />
        ) : (
          <GeoScopeMap />
        )}
      </MapFrame>
      <aside className="side-panel">
        <RightPanel />
      </aside>
    </div>
  );
};

const App: React.FC = () => {
  useConfigWatcher();
  return (
    <Routes>
      <Route path="/" element={<DashboardShell />} />
      <Route path="/config" element={<ConfigPage />} />
    </Routes>
  );
};

export default App;
