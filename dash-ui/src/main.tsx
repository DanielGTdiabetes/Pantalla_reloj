import React from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";

import { isSafeMode, isStaticMode, isUltraSafe } from "./lib/flags";
import UltraSafeApp from "./UltraSafeApp";
import "./styles/global.css";

const rootElement = document.getElementById("root") as HTMLElement;
const root = createRoot(rootElement);

if (isUltraSafe()) {
  console.info("[flags] ULTRA-SAFE mode enabled");
  root.render(
    <React.StrictMode>
      <UltraSafeApp />
    </React.StrictMode>
  );
} else {
  void Promise.all([
    import("./App"),
    import("./components/ErrorBoundary")
  ]).then(([{ default: App }, { default: ErrorBoundary }]) => {
    const activeFlags: string[] = [];
    if (isSafeMode()) {
      activeFlags.push("safe");
    }
    if (isStaticMode()) {
      activeFlags.push("static");
    }
    if (activeFlags.length > 0) {
      console.info(`[flags] active: ${activeFlags.join(", ")}`);
    }
    root.render(
      <React.StrictMode>
        <ErrorBoundary>
          <HashRouter>
            <App />
          </HashRouter>
        </ErrorBoundary>
      </React.StrictMode>
    );
  });
}
