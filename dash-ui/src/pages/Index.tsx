import GeoScopeMap from "../components/GeoScopeMap";
import { OverlayRotator } from "../components/OverlayRotator";

export default function Index(): JSX.Element {
  return (
    <div className="w-screen h-screen overflow-hidden">
      <div className="flex w-full h-full">
        {/* Mapa (2/3) */}
        <div id="map-column" className="h-full w-2/3 relative">
          <GeoScopeMap />
        </div>

        {/* Panel lateral (1/3) */}
        <aside
          className="h-full w-1/3 min-w-[560px] max-w-[860px] border-l border-white/10 bg-black/35 backdrop-blur-sm"
        >
          <OverlayRotator />
        </aside>
      </div>
    </div>
  );
}
