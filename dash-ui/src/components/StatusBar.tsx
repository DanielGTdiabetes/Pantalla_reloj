import { useEffect, useMemo, useState } from 'react';
import { Wifi, WifiOff } from 'lucide-react';
import type { ThemeKey } from '../styles/theme';
import { THEMES } from '../styles/theme';
import { ENABLE_NETWORK_PING } from '../services/config';

interface StatusBarProps {
  themeKey: ThemeKey;
}

const StatusBar = ({ themeKey }: StatusBarProps) => {
  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true));
  const [latency, setLatency] = useState<number | null>(null);
  const [lastChecked, setLastChecked] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!ENABLE_NETWORK_PING || typeof window === 'undefined') return;
    let cancelled = false;

    const ping = async () => {
      if (!navigator.onLine) {
        setLatency(null);
        setIsOnline(false);
        return;
      }
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 1000);
      try {
        const start = performance.now();
        await fetch('/', { method: 'HEAD', cache: 'no-store', signal: controller.signal });
        const end = performance.now();
        if (!cancelled) {
          setLatency(Math.round(end - start));
          setIsOnline(true);
          setLastChecked(Date.now());
        }
      } catch (error) {
        if (!cancelled) {
          setLatency(null);
          setIsOnline(false);
          setLastChecked(Date.now());
          console.warn('Ping offline', error);
        }
      } finally {
        window.clearTimeout(timeoutId);
      }
    };

    ping();
    const interval = window.setInterval(ping, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const themeName = useMemo(() => THEMES.find((theme) => theme.key === themeKey)?.name ?? 'Tema', [themeKey]);

  return (
    <div className="flex w-full items-center justify-between" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-xs tracking-[0.3em] text-slate-200/70">
        <span>Pi Dash</span>
        <span className="hidden md:inline">·</span>
        <span className="uppercase">{themeName}</span>
      </div>
      <div className="flex items-center gap-3 text-xs">
        <span className="flex items-center gap-2">
          {isOnline ? (
            <Wifi className="h-4 w-4 text-emerald-400" aria-hidden />
          ) : (
            <WifiOff className="h-4 w-4 text-rose-400" aria-hidden />
          )}
          <span>{isOnline ? 'Online' : 'Offline'}</span>
        </span>
        {latency !== null && (
          <span className="text-slate-200/70">{latency} ms</span>
        )}
        {lastChecked && (
          <span className="text-slate-200/50">{new Date(lastChecked).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
        )}
      </div>
    </div>
  );
};

export default StatusBar;
