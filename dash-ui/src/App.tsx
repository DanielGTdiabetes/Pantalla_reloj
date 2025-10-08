import { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from './components/Layout';
import Clock from './components/Clock';
import Weather from './components/Weather';
import BackgroundRotator from './components/BackgroundRotator';
import StatusBar from './components/StatusBar';
import ThemeSelector from './components/ThemeSelector';
import SettingsPanel from './components/SettingsPanel';
import { DashboardConfigProvider, useDashboardConfig } from './context/DashboardConfigContext';
import { DEFAULT_BACKGROUND_INTERVAL, DEFAULT_THEME, THEME_STORAGE_KEY, powerSave } from './services/config';
import { THEME_MAP, type ThemeKey } from './styles/theme';

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

const AppContent = () => {
  const { config, update } = useDashboardConfig();
  const [theme, setTheme] = useState<ThemeKey>(() => resolveInitialTheme());
  const [settingsOpen, setSettingsOpen] = useState(false);

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

  useEffect(() => {
    const configuredTheme = config?.theme?.current;
    if (configuredTheme && configuredTheme !== theme && THEME_MAP[configuredTheme]) {
      setTheme(configuredTheme);
    }
  }, [config?.theme?.current]);

  const themeDefinition = useMemo(() => THEME_MAP[theme], [theme]);
  const backgroundInterval = config?.background?.intervalMinutes ?? DEFAULT_BACKGROUND_INTERVAL;

  const handleThemeChange = useCallback(
    (nextTheme: ThemeKey) => {
      setTheme(nextTheme);
      update({ theme: { current: nextTheme } }).catch((error) => {
        console.warn('No se pudo actualizar el tema en backend', error);
      });
    },
    [update]
  );

  return (
    <Layout
      theme={themeDefinition}
      powerSave={powerSave}
      header={<StatusBar themeKey={theme} onOpenSettings={() => setSettingsOpen(true)} />}
      footer={<ThemeSelector theme={theme} onChange={handleThemeChange} />}
    >
      <BackgroundRotator powerSave={powerSave} intervalMinutes={backgroundInterval} />
      <div className="relative z-10 flex flex-col gap-10 items-center justify-center h-full px-8">
        <Clock />
        <Weather />
      </div>
      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </Layout>
  );
};

const App = () => (
  <DashboardConfigProvider>
    <AppContent />
  </DashboardConfigProvider>
);

export default App;
