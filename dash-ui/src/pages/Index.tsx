import GeoScopeMap from "../components/GeoScope/GeoScopeMap";
import { OverlayRotator } from "../components/OverlayRotator";

export default function Index(): JSX.Element {
  return (
    <div className="fixed inset-0">
      <div className="flex w-full h-full">
        {/* MAPA: ocupa el espacio restante (≈2/3) */}
        <div className="relative flex-1 min-w-0 h-full overflow-hidden">
          <GeoScopeMap />
        </div>

        {/* PANEL DERECHO: 1/3 exacto, pegado al borde */}
        <aside className="h-full w-1/3 shrink-0 grow-0 m-0 border-l border-white/10 bg-black/35 backdrop-blur-sm">
          <div className="h-full w-full p-4">
            <OverlayRotator />
          </div>
        </aside>
      </div>
    </div>
  );
}
