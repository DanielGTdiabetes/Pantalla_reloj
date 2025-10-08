import { useEffect, useMemo, useState } from 'react';
import { Wifi, WifiOff, Settings } from 'lucide-react';
import type { ThemeKey } from '../styles/theme';
import { THEMES } from '../styles/theme';
import { fetchWifiStatus, type WifiStatus } from '../services/wifi';

interface StatusBarProps {
  themeKey: ThemeKey;
  onOpenSettings?: () => void;
}

const StatusBar = ({ themeKey, onOpenSettings }: StatusBarProps) => {
  const [wifiStatus, setWifiStatus] = useState<WifiStatus | null>(null);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadStatus = async () => {
      try {
        const status = await fetchWifiStatus();
        if (!cancelled) {
          setWifiStatus(status);
          setError(null);
          setLastChecked(Date.now());
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Sin respuesta');
          setWifiStatus(null);
          setLastChecked(Date.now());
        }
      }
    };

    loadStatus().catch(() => {
      // handled in error state
    });
    const interval = window.setInterval(() => {
      loadStatus().catch(() => {
        // handled in error state
      });
    }, 90_000);

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
          {wifiStatus?.connected ? (
            <Wifi className="h-4 w-4 text-emerald-400" aria-hidden />
          ) : (
            <WifiOff className="h-4 w-4 text-rose-400" aria-hidden />
          )}
          <span>
            {wifiStatus?.connected
              ? wifiStatus.ssid ?? 'Conectado'
              : error ?? 'Sin conexión'}
          </span>
        </span>
        {wifiStatus?.ip && <span className="text-slate-200/70">IP {wifiStatus.ip}</span>}
        {lastChecked && (
          <span className="text-slate-200/50">
            {new Date(lastChecked).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
        {onOpenSettings && (
          <button
            className="ml-2 flex items-center gap-1 rounded-full border border-white/10 px-3 py-1 text-[10px] uppercase tracking-[0.3em] text-slate-100 hover:border-white/20"
            onClick={onOpenSettings}
            type="button"
          >
            <Settings className="h-3 w-3" />
            Ajustes
          </button>
        )}
      </div>
    </div>
  );
};

export default StatusBar;
