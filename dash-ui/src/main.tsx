import React, { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import "./styles/variables.css";
import "./styles/themes.css";
import "./styles/typography.css";
import "./styles/animations.css";
import "./styles/card-enhancements.css";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  React.createElement(StrictMode, null,
    React.createElement(BrowserRouter, null,
      React.createElement(App, null)
    )
  )
);
