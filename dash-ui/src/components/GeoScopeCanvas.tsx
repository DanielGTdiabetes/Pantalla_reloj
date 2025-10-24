import type { CSSProperties } from 'react';

const gradientStyle: CSSProperties = {
  background: 'radial-gradient(circle at 20% 20%, rgba(64,143,255,0.35), transparent 60%), radial-gradient(circle at 80% 30%, rgba(235,122,255,0.4), transparent 55%), linear-gradient(135deg, #041226 0%, #061f3a 45%, #0a2a4e 100%)',
};

const GeoScopeCanvas = () => {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={gradientStyle}
    >
      <div className="rounded-full border border-white/25 bg-white/5 px-6 py-3 text-sm uppercase tracking-[0.35em] text-white/70 shadow-lg">
        GeoScope base OK
      </div>
    </div>
  );
};

export default GeoScopeCanvas;
