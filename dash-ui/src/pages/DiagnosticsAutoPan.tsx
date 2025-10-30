import { useEffect, useState } from "react";

import GeoScopeMap, { GEO_SCOPE_AUTOPAN_EVENT } from "../components/GeoScope/GeoScopeMap";

const DEFAULT_STEP_DEG = 0.4;
const DEFAULT_LAT_STEP_DEG = 5;
const DEFAULT_PAUSE_MS = 500;
const DEFAULT_LOOPS = -1;

type AutoPanEventDetail =
  | { mode?: "spin"; bearing?: number }
  | { mode: "serpentine"; lat?: number; lon?: number; band?: number; direction?: "E" | "W" };

type DiagnosticsAutoPanState =
  | { mode: "spin"; bearing: number }
  | { mode: "serpentine"; lat: number; lon: number; band: number; direction: "E" | "W" };

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
  if (!params.has("mode")) {
    params.set("mode", "serpentine");
    changed = true;
  }
  if (!params.has("stepDeg") && !params.has("speed")) {
    params.set("stepDeg", DEFAULT_STEP_DEG.toString());
    changed = true;
  }
  if (!params.has("latStepDeg")) {
    params.set("latStepDeg", DEFAULT_LAT_STEP_DEG.toString());
    changed = true;
  }
  if (!params.has("pauseMs") && !params.has("pause")) {
    params.set("pauseMs", DEFAULT_PAUSE_MS.toString());
    changed = true;
  }
  if (!params.has("loops")) {
    params.set("loops", DEFAULT_LOOPS.toString());
    changed = true;
  }

  if (changed) {
    const query = params.toString();
    const nextUrl = `${window.location.pathname}?${query}${window.location.hash}`;
    window.history.replaceState(null, "", nextUrl);
  }
};

const DiagnosticsAutoPan = () => {
  const [state, setState] = useState<DiagnosticsAutoPanState>({
    mode: "spin",
    bearing: 0
  });

  useEffect(() => {
    ensureDiagnosticsParams();
    if (typeof window === "undefined") {
      return;
    }

    const handleBearing: EventListener = (event) => {
      const detail = (event as CustomEvent<AutoPanEventDetail>).detail;
      if (!detail) {
        return;
      }
      if (detail.mode === "serpentine") {
        const lat = typeof detail.lat === "number" ? detail.lat : 0;
        const lon = typeof detail.lon === "number" ? detail.lon : 0;
        const band = typeof detail.band === "number" ? detail.band : 0;
        const direction = detail.direction === "W" ? "W" : "E";
        setState({ mode: "serpentine", lat, lon, band, direction });
        return;
      }
      const bearing = typeof detail.bearing === "number" ? detail.bearing : 0;
      setState({ mode: "spin", bearing });
    };

    window.addEventListener(GEO_SCOPE_AUTOPAN_EVENT, handleBearing);
    return () => {
      window.removeEventListener(GEO_SCOPE_AUTOPAN_EVENT, handleBearing);
    };
  }, []);

  const label = state.mode === "serpentine" ? "Lat / Lon" : "Bearing";
  const value =
    state.mode === "serpentine"
      ? `${state.lat.toFixed(2)}°, ${state.lon.toFixed(2)}° · band ${state.band} ${state.direction}`
      : `${state.bearing.toFixed(1)}°`;

  return (
    <div className="diagnostics-auto-pan">
      <div className="diagnostics-auto-pan__map" aria-hidden="true">
        <GeoScopeMap />
      </div>
      <div className="diagnostics-auto-pan__overlay">
        <div className="diagnostics-auto-pan__ticker" aria-live="polite">
          <span className="diagnostics-auto-pan__label">{label}</span>
          <span className="diagnostics-auto-pan__value">{value}</span>
        </div>
      </div>
    </div>
  );
};

export default DiagnosticsAutoPan;
