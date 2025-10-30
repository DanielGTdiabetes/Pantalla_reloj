import { useEffect, useState } from "react";

import GeoScopeMap, { GEO_SCOPE_AUTOPAN_EVENT } from "../components/GeoScope/GeoScopeMap";

const DEFAULT_SPEED_PARAM = (6 / 60).toFixed(3);

const ensureDiagnosticsParams = () => {
  if (typeof window === "undefined") {
    return;
  }
  const params = new URLSearchParams(window.location.search);
  let changed = false;
  if (!params.has("autopan")) {
    params.set("autopan", "1");
    changed = true;
  }
  if (!params.has("force")) {
    params.set("force", "1");
    changed = true;
  }
  if (!params.has("reducedMotion")) {
    params.set("reducedMotion", "0");
    changed = true;
  }
  if (!params.has("reduced")) {
    params.set("reduced", "0");
    changed = true;
  }
  if (!params.has("speed")) {
    params.set("speed", DEFAULT_SPEED_PARAM);
    changed = true;
  }

  if (changed) {
    const query = params.toString();
    const nextUrl = `${window.location.pathname}?${query}${window.location.hash}`;
    window.history.replaceState(null, "", nextUrl);
  }
};

const DiagnosticsAutoPan = () => {
  const [bearing, setBearing] = useState(0);

  useEffect(() => {
    ensureDiagnosticsParams();
    if (typeof window === "undefined") {
      return;
    }

    const handleBearing: EventListener = (event) => {
      const detail = (event as CustomEvent<{ bearing?: number }>).detail;
      if (!detail || typeof detail.bearing !== "number") {
        return;
      }
      setBearing(detail.bearing);
    };

    window.addEventListener(GEO_SCOPE_AUTOPAN_EVENT, handleBearing);
    return () => {
      window.removeEventListener(GEO_SCOPE_AUTOPAN_EVENT, handleBearing);
    };
  }, []);

  return (
    <div className="diagnostics-auto-pan">
      <div className="diagnostics-auto-pan__map" aria-hidden="true">
        <GeoScopeMap />
      </div>
      <div className="diagnostics-auto-pan__overlay">
        <div className="diagnostics-auto-pan__ticker" aria-live="polite">
          <span className="diagnostics-auto-pan__label">Bearing</span>
          <span className="diagnostics-auto-pan__value">{bearing.toFixed(1)}°</span>
        </div>
      </div>
    </div>
  );
};

export default DiagnosticsAutoPan;
