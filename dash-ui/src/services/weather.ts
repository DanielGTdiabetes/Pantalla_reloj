import { WEATHER_CACHE_KEY } from './config';

type WeatherIcon = 'cloud' | 'rain' | 'sun';

export interface WeatherSnapshot {
  temp: number;
  condition: string;
  icon: WeatherIcon;
  precipProb: number;
  humidity: number;
  updatedAt: number;
}

const MOCK_SEQUENCE: WeatherSnapshot[] = [
  {
    temp: 22,
    condition: 'Nublado parcial',
    icon: 'cloud',
    precipProb: 20,
    humidity: 58,
    updatedAt: Date.now()
  },
  {
    temp: 21,
    condition: 'Lluvia ligera',
    icon: 'rain',
    precipProb: 45,
    humidity: 72,
    updatedAt: Date.now()
  },
  {
    temp: 24,
    condition: 'Despejado',
    icon: 'sun',
    precipProb: 5,
    humidity: 50,
    updatedAt: Date.now()
  }
];

let pointer = 0;

const listeners = new Set<(data: WeatherSnapshot) => void>();
let intervalHandle: number | undefined;

function persist(snapshot: WeatherSnapshot) {
  try {
    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(snapshot));
  } catch (error) {
    console.warn('No se pudo persistir el clima mock', error);
  }
}

function loadCached(): WeatherSnapshot | undefined {
  try {
    const raw = localStorage.getItem(WEATHER_CACHE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as WeatherSnapshot;
    return parsed;
  } catch (error) {
    console.warn('No se pudo leer cache de clima mock', error);
    return undefined;
  }
}

function nextSnapshot(): WeatherSnapshot {
  const base = MOCK_SEQUENCE[pointer];
  pointer = (pointer + 1) % MOCK_SEQUENCE.length;
  const snapshot = { ...base, updatedAt: Date.now() };
  persist(snapshot);
  return snapshot;
}

function dispatch(snapshot: WeatherSnapshot) {
  listeners.forEach((listener) => listener(snapshot));
}

export function subscribeWeather(listener: (data: WeatherSnapshot) => void, pollMinutes = 2) {
  listeners.add(listener);
  let initial = loadCached();
  if (!initial) {
    initial = nextSnapshot();
  }
  listener(initial);

  if (intervalHandle === undefined) {
    const pollInterval = Math.max(1, pollMinutes) * 60_000;
    intervalHandle = window.setInterval(() => {
      const snapshot = nextSnapshot();
      dispatch(snapshot);
    }, pollInterval);
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && intervalHandle !== undefined) {
      window.clearInterval(intervalHandle);
      intervalHandle = undefined;
    }
  };
}

export function getWeatherSnapshot(): WeatherSnapshot {
  const cached = loadCached();
  if (cached) {
    return cached;
  }
  return nextSnapshot();
}
