import { LayoutGroup, motion } from 'framer-motion';
import type { ThemeKey } from '../styles/theme';
import { THEMES } from '../styles/theme';

interface ThemeSelectorProps {
  theme: ThemeKey;
  onChange: (theme: ThemeKey) => void;
}

const ThemeSelector = ({ theme, onChange }: ThemeSelectorProps) => {
  return (
    <section
      aria-label="Selector de tema"
      role="radiogroup"
      className="mx-auto flex max-w-4xl flex-wrap justify-center gap-3"
    >
      <LayoutGroup id="theme-selector">
        {THEMES.map((option) => {
          const isActive = option.key === theme;
          return (
            <motion.button
              layout
              key={option.key}
              type="button"
              onClick={() => onChange(option.key)}
              whileTap={{ scale: 0.97 }}
              className={`group relative flex min-w-[180px] flex-col gap-1 rounded-2xl border border-white/10 px-4 py-3 text-left transition reduced-motion ${
                isActive ? 'bg-white/10 shadow-lg shadow-cyan-500/30' : 'bg-black/30'
              }`}
              role="radio"
              aria-checked={isActive}
            >
              <span className="text-xs uppercase tracking-[0.4em] text-slate-200/70">{option.name}</span>
              <span className="text-sm text-slate-200/80">{option.description}</span>
              {isActive && (
                <motion.span
                  layoutId="theme-active-glow"
                  className="absolute inset-0 -z-10 rounded-2xl border border-cyan-400/30"
                  transition={{ type: 'spring', stiffness: 250, damping: 24 }}
                  aria-hidden
                />
              )}
            </motion.button>
          );
        })}
      </LayoutGroup>
    </section>
  );
};

export default ThemeSelector;
