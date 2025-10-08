import type { ThemeKey } from '../styles/theme';
import bg1 from '../assets/backgrounds/1.webp';
import bg2 from '../assets/backgrounds/2.webp';
import bg3 from '../assets/backgrounds/3.webp';
import bg4 from '../assets/backgrounds/4.webp';
import bg5 from '../assets/backgrounds/5.webp';
import bg6 from '../assets/backgrounds/6.webp';

export const BACKGROUND_ROTATION_MINUTES = 5;
export const DEFAULT_THEME: ThemeKey = 'cyberpunkNeon';
export const powerSave = false;
export const ENABLE_NETWORK_PING = true;

export const BACKGROUND_SOURCES = [bg1, bg2, bg3, bg4, bg5, bg6] as const;

export const WEATHER_CACHE_KEY = 'weatherCache';
export const THEME_STORAGE_KEY = 'dashTheme';
