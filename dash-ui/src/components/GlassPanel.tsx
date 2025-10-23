import type { PropsWithChildren } from 'react';

interface GlassPanelProps extends PropsWithChildren {
  className?: string;
}

const GlassPanel = ({ children, className }: GlassPanelProps) => (
  <div
    className={`glass-panel flex h-full w-full flex-col gap-6 rounded-[28px] border border-white/15 bg-transparent p-6 text-white md:p-8 ${className ?? ''}`}
  >
    {children}
  </div>
);

export default GlassPanel;
