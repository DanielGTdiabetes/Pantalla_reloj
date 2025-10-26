import GeoScopeMap from "../components/GeoScopeMap";
import { OverlayRotator } from "../components/OverlayRotator";

export default function Index(): JSX.Element {
  return (
    <div className="fixed inset-0">
      <div className="flex w-full h-full">
        <div className="relative h-full w-2/3 overflow-hidden">
          <GeoScopeMap />
        </div>

        <aside className="h-full w-1/3 shrink-0 grow-0 m-0 border-l border-white/10 bg-black/35 backdrop-blur-sm">
          <div className="h-full w-full p-4">
            <OverlayRotator />
          </div>
        </aside>
      </div>
    </div>
  );
}
