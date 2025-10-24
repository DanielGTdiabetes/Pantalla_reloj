import { useMemo } from 'react';
import GeoScopeCanvas from '../components/GeoScopeCanvas';
import OverlayPanel, { resolveOverlay } from '../components/OverlayPanel';
import Rotator from '../components/Rotator';
import { useDashboardConfig } from '../context/DashboardConfigContext';

const Display = () => {
  const { config } = useDashboardConfig();

  const overlaySettings = useMemo(() => resolveOverlay(config?.ui?.overlay), [config?.ui?.overlay]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black text-white">
      <GeoScopeCanvas />
      <OverlayPanel>
        <Rotator
          order={overlaySettings.order}
          dwellSeconds={overlaySettings.dwell_seconds}
          transitionMs={overlaySettings.transition_ms}
        />
      </OverlayPanel>
    </div>
  );
};

export default Display;
