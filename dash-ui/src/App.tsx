import React from "react";
import { Route, Routes } from "react-router-dom";

import { ConfigPage } from "./pages/ConfigPage";
import Index from "./pages/Index";

const App: React.FC = () => {
  return (
    <Routes>
      <Route path="/" element={<Index />} />
      <Route path="/config" element={<ConfigPage />} />
    </Routes>
  );
};

export default App;
