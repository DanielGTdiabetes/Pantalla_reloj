import React from "react";
import { Route, Routes } from "react-router-dom";

import GeoScopeMap from "./components/GeoScope/GeoScopeMap";
import MapFrame from "./components/MapFrame";
import { RightPanel } from "./components/RightPanel";
import { ConfigPage } from "./pages/ConfigPage";
import DiagnosticsAutoPan from "./pages/DiagnosticsAutoPan";

const DashboardShell: React.FC = () => {
  return (
    <div className="app-shell">
      <MapFrame className="map-area">
        <GeoScopeMap />
      </MapFrame>
      <aside className="side-panel">
        <RightPanel />
      </aside>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<DashboardShell />} />
      <Route path="/config" element={<ConfigPage />} />
      <Route path="/diagnostics/auto-pan" element={<DiagnosticsAutoPan />} />
    </Routes>
  );
};

export default App;
