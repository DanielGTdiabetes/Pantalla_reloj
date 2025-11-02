import GeoScopeMap from "../components/GeoScope/GeoScopeMap";

/**
 * DiagnosticsAutoPan component - deprecated
 * 
 * This component was used for diagnostics of the auto-pan/cinema feature,
 * which has been removed. The component is kept for backward compatibility
 * but only displays the map without any diagnostic overlays.
 */
const DiagnosticsAutoPan = () => {
  return (
    <div className="diagnostics-auto-pan">
      <div className="diagnostics-auto-pan__map" aria-hidden="true">
        <GeoScopeMap />
      </div>
      <div className="diagnostics-auto-pan__overlay">
        <div className="diagnostics-auto-pan__ticker" aria-live="polite">
          <span className="diagnostics-auto-pan__label">Auto-pan diagnostics</span>
          <span className="diagnostics-auto-pan__value">Disabled</span>
        </div>
      </div>
    </div>
  );
};

export default DiagnosticsAutoPan;
