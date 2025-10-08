import { useEffect, useMemo, useState } from 'react';
import Layout from './components/Layout';
import Clock from './components/Clock';
import Weather from './components/Weather';
import BackgroundRotator from './components/BackgroundRotator';
import StatusBar from './components/StatusBar';
import ThemeSelector from './components/ThemeSelector';
import { THEME_MAP, type ThemeKey } from './styles/theme';
import { DEFAULT_THEME, THEME_STORAGE_KEY, powerSave } from './services/config';

function resolveInitialTheme(): ThemeKey {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeKey | null;
    if (stored && THEME_MAP[stored]) {
      return stored;
    }
  } catch (error) {
    console.warn('No se pudo recuperar el tema previo', error);
  }
  return DEFAULT_THEME;
}

const App = () => {
  const [theme, setTheme] = useState<ThemeKey>(() => resolveInitialTheme());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const root = document.documentElement;
    const body = document.body;

    Object.keys(THEME_MAP).forEach((key) => {
      root.classList.remove(`theme-${key}`);
    });
    root.classList.add(`theme-${theme}`);

    if (powerSave) {
      body.classList.add('power-save');
    } else {
      body.classList.remove('power-save');
    }

    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch (error) {
      console.warn('No se pudo persistir el tema', error);
    }
  }, [theme]);

  const themeDefinition = useMemo(() => THEME_MAP[theme], [theme]);

  return (
    <Layout
      theme={themeDefinition}
      powerSave={powerSave}
      header={<StatusBar themeKey={theme} />}
      footer={<ThemeSelector theme={theme} onChange={setTheme} />}
    >
      <BackgroundRotator powerSave={powerSave} />
      <div className="relative z-10 flex flex-col gap-10 items-center justify-center h-full px-8">
        <Clock />
        <Weather />
      </div>
    </Layout>
  );
};

export default App;
