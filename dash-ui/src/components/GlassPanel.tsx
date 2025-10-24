import type { PropsWithChildren } from 'react';

interface GlassPanelProps extends PropsWithChildren {
  className?: string;
}

const GlassPanel = ({ children, className }: GlassPanelProps) => (
  <div
    className={`glass-panel flex h-full w-full flex-col gap-6 rounded-2xl border border-white/15 bg-transparent px-6 py-6 text-white backdrop-blur-lg md:px-8 md:py-8 ${className ?? ''}`}
  >
    {children}
  </div>
);

export default GlassPanel;
