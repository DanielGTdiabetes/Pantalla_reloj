export type ThemeKey = 'cyberpunkNeon' | 'crtRetro' | 'lightMinimal';

export interface ThemeDefinition {
  key: ThemeKey;
  name: string;
  description: string;
  accent: string;
  accentStrong: string;
  surface: string;
  text: string;
  muted: string;
  decorations: {
    className: string;
    overlay?: string;
  };
}

export const THEMES: ThemeDefinition[] = [
  {
    key: 'cyberpunkNeon',
    name: 'Cyberpunk Neon',
    description: 'Brillo futurista con acentos cian y violeta.',
    accent: 'var(--accent)',
    accentStrong: 'var(--accent-strong)',
    surface: 'rgba(14, 17, 28, 0.75)',
    text: 'var(--text-primary)',
    muted: 'rgba(148, 163, 184, 0.75)',
    decorations: {
      className: 'neon-glow',
      overlay: 'rounded-[32px] bg-cyan-400/10 blur-3xl'
    }
  },
  {
    key: 'crtRetro',
    name: 'CRT Retro',
    description: 'Verde fósforo con líneas de escaneo y curvatura suave.',
    accent: 'var(--accent)',
    accentStrong: 'var(--accent-strong)',
    surface: 'rgba(0, 20, 0, 0.72)',
    text: 'var(--text-primary)',
    muted: 'rgba(203, 213, 225, 0.75)',
    decorations: {
      className: 'crt-overlay',
      overlay: 'rounded-[32px] bg-emerald-400/8 mix-blend-color-dodge'
    }
  },
  {
    key: 'lightMinimal',
    name: 'Light Minimal',
    description: 'Tonos claros con alto contraste y tipografía limpia.',
    accent: 'var(--accent)',
    accentStrong: 'var(--accent-strong)',
    surface: 'rgba(248, 250, 252, 0.85)',
    text: 'var(--text-primary)',
    muted: 'rgba(51, 65, 85, 0.7)',
    decorations: {
      className: 'shadow-lg shadow-slate-200/40',
      overlay: 'rounded-[32px] bg-white/60 backdrop-blur-lg mix-blend-luminosity'
    }
  }
];

export const THEME_MAP = THEMES.reduce<Record<ThemeKey, ThemeDefinition>>((acc, theme) => {
  acc[theme.key] = theme;
  return acc;
}, {} as Record<ThemeKey, ThemeDefinition>);
