import { LayoutGroup, motion } from 'framer-motion';
import type { ThemeKey } from '../styles/theme';
import { THEMES } from '../styles/theme';

interface ThemeSelectorProps {
  theme: ThemeKey;
  onChange: (theme: ThemeKey) => void;
  tone?: 'light' | 'dark';
}

const ThemeSelector = ({ theme, onChange, tone = 'dark' }: ThemeSelectorProps) => {
  return (
    <section aria-label="Selector de tema" role="radiogroup" className="mx-auto flex max-w-4xl flex-wrap justify-center gap-3">
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
              className={`group relative flex min-w-[180px] flex-col gap-1 rounded-2xl border px-4 py-3 text-left transition reduced-motion ${
                tone === 'light'
                  ? isActive
                    ? 'border-slate-400/70 bg-white/70 text-slate-900 shadow-lg shadow-slate-300/50'
                    : 'border-slate-300/60 bg-white/40 text-slate-800 hover:border-slate-400'
                  : isActive
                  ? 'border-cyan-400/40 bg-cyan-400/20 text-slate-100 shadow-lg shadow-cyan-500/30'
                  : 'border-white/15 bg-white/10 text-slate-200 hover:border-white/30'
              }`}
              role="radio"
              aria-checked={isActive}
            >
              <span
                className={`text-xs uppercase tracking-[0.4em] ${
                  tone === 'light' ? 'text-slate-600/80' : 'text-slate-200/70'
                }`}
              >
                {option.name}
              </span>
              <span className={`text-sm ${tone === 'light' ? 'text-slate-700/80' : 'text-slate-200/80'}`}>
                {option.description}
              </span>
              {isActive && (
                <motion.span
                  layoutId="theme-active-glow"
                  className={`absolute inset-0 -z-10 rounded-2xl border ${
                    tone === 'light' ? 'border-slate-200/60' : 'border-cyan-400/30'
                  }`}
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
