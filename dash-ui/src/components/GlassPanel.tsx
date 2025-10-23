import type { PropsWithChildren } from 'react';

interface GlassPanelProps extends PropsWithChildren {
  className?: string;
}

const GlassPanel = ({ children, className }: GlassPanelProps) => (
  <div
    className={`glass-panel flex h-full w-full flex-col gap-4 rounded-[28px] border border-white/15 bg-[rgba(14,18,28,0.22)] p-8 text-white shadow-[0_20px_45px_rgba(0,0,0,0.35)] backdrop-blur-lg backdrop-brightness-[0.95] ${className ?? ''}`}
  >
    {children}
  </div>
);

export default GlassPanel;
