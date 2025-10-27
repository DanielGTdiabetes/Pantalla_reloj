import React from "react";
import { Route, Routes } from "react-router-dom";

import GeoScopeMap from "./components/GeoScope/GeoScopeMap";
import { RightPanel } from "./components/RightPanel";
import { ConfigPage } from "./pages/ConfigPage";

const DashboardShell: React.FC = () => {
  return (
    <div className="app-shell">
      <div className="map-area">
        <GeoScopeMap />
      </div>
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
    </Routes>
  );
};

export default App;
