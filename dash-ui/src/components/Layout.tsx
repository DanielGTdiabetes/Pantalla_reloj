import type { ReactNode } from 'react';
import type { ThemeDefinition } from '../styles/theme';

interface LayoutProps {
  theme: ThemeDefinition;
  powerSave: boolean;
  children: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
}

const Layout = ({ theme, powerSave, children, header, footer }: LayoutProps) => {
  const decorationClass = theme.decorations.className;
  const overlayClass = theme.decorations.overlay;
  const glassClass = theme.glassTone === 'light' ? 'glass-light' : 'glass';

  return (
    <div className={`relative min-h-screen w-full overflow-hidden ${powerSave ? 'power-save' : ''}`}
      style={{ color: theme.text }}
    >
      <div className="absolute inset-0 bg-neutral-950" aria-hidden />
      {header && (
        <header
          className={`relative z-20 mx-auto mt-6 flex w-full max-w-5xl items-center justify-between gap-6 rounded-[24px] px-6 py-4 text-sm uppercase tracking-[0.2em] glass-surface ${glassClass}`}
          role="banner"
        >
          {header}
        </header>
      )}
      <main className="relative z-10 flex min-h-[calc(100vh-6rem)] flex-col items-stretch justify-center px-4">
        <div
          className={`glass-surface relative mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-8 px-8 py-10 reduced-motion ${glassClass} ${decorationClass}`}
        >
          {overlayClass && <div className={`pointer-events-none absolute inset-0 ${overlayClass}`} aria-hidden />}
          <div className="relative z-10 flex w-full flex-col items-center gap-8">{children}</div>
        </div>
      </main>
      {footer && (
        <footer
          className={`relative z-20 mx-auto mb-6 mt-6 flex w-full max-w-5xl justify-center rounded-[24px] px-6 py-4 glass-surface ${glassClass}`}
          role="contentinfo"
        >
          {footer}
        </footer>
      )}
    </div>
  );
};

export default Layout;
