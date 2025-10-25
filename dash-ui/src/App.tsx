import React from "react";
import { Route, Routes } from "react-router-dom";

import { ConfigProvider } from "./context/ConfigContext";
import { ConfigPage } from "./pages/ConfigPage";
import { DashboardPage } from "./pages/DashboardPage";

const App: React.FC = () => {
  return (
    <ConfigProvider>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/config" element={<ConfigPage />} />
      </Routes>
    </ConfigProvider>
  );
};

export default App;
