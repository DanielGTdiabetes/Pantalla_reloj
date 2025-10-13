import { useEffect, useState } from 'react';
import { Wifi, WifiOff } from 'lucide-react';
import { fetchWifiStatus, type WifiStatus } from '../services/wifi';

const StatusBar = () => {
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

    void loadStatus();
    const interval = window.setInterval(() => {
      void loadStatus();
    }, 90_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const connectionLabel = wifiStatus?.connected
    ? wifiStatus.ssid ?? 'Conectado'
    : error ?? 'Sin conexión';

  const lastUpdate = lastChecked
    ? new Date(lastChecked).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <header className="flex items-center justify-between rounded-3xl bg-black/40 px-6 py-4 text-xs uppercase tracking-[0.35em] text-slate-100/80 backdrop-blur">
      <div className="flex items-center gap-4 text-shadow-soft">
        <span>Dash 8.8"</span>
        <span className="hidden md:inline">·</span>
        <span className="hidden md:inline">Modo operativo</span>
      </div>
      <div className="flex items-center gap-4 text-shadow-soft">
        <span className="flex items-center gap-2 text-slate-100">
          {wifiStatus?.connected ? (
            <Wifi className="h-4 w-4 text-emerald-300" aria-hidden />
          ) : (
            <WifiOff className="h-4 w-4 text-rose-300" aria-hidden />
          )}
          {connectionLabel}
        </span>
        {wifiStatus?.ip && <span className="text-slate-200/70">IP {wifiStatus.ip}</span>}
        {lastUpdate && <span className="text-slate-200/60">{lastUpdate}</span>}
      </div>
    </header>
  );
};

export default StatusBar;
