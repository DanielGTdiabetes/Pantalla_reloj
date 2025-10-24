import type { PropsWithChildren } from 'react';

interface GlassPanelProps extends PropsWithChildren {
  className?: string;
}

const GlassPanel = ({ children, className }: GlassPanelProps) => (
  <div
    className={`glass-panel flex h-full w-full flex-col gap-3 rounded-2xl border border-white/15 bg-white/0 px-4 py-3 text-white backdrop-blur-md md:px-6 md:py-5 ${className ?? ''}`}
  >
    {children}
  </div>
);

export default GlassPanel;
