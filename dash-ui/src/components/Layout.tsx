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

  return (
    <div className={`relative min-h-screen w-full overflow-hidden ${powerSave ? 'power-save' : ''}`}
      style={{ color: theme.text }}
    >
      <div className="absolute inset-0 bg-neutral-950" aria-hidden />
      {header && (
        <header
          className="relative z-20 flex items-center justify-between px-6 py-4 text-sm uppercase tracking-[0.2em]"
          role="banner"
        >
          {header}
        </header>
      )}
      <main className="relative z-10 flex min-h-[calc(100vh-6rem)] flex-col items-stretch justify-center px-4">
        <div
          className={`relative mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-8 rounded-[32px] border border-white/10 bg-black/40 px-8 py-10 backdrop-blur-xl reduced-motion ${decorationClass}`}
        >
          {overlayClass && <div className={`pointer-events-none absolute inset-0 ${overlayClass}`} aria-hidden />}
          <div className="relative z-10 flex w-full flex-col items-center gap-8">{children}</div>
        </div>
      </main>
      {footer && (
        <footer className="relative z-20 px-6 py-4" role="contentinfo">
          {footer}
        </footer>
      )}
    </div>
  );
};

export default Layout;
