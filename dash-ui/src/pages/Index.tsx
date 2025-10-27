import GeoScopeMap from "../components/GeoScope/GeoScopeMap";
import RightPanel from "../components/RightPanel";

export default function Index(): JSX.Element {
  return (
    <div className="app-shell">
      <div className="map-area">
        <GeoScopeMap />
      </div>
      <aside className="side-panel">
        <RightPanel />
      </aside>
    </div>
  );
}
