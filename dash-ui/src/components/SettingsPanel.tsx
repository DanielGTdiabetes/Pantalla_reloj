import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { X, Wifi, Settings2, Waves, Palette, Calendar as CalendarIcon } from 'lucide-react';
import { useDashboardConfig } from '../context/DashboardConfigContext';
import type { DashboardConfig } from '../services/config';
import { connectNetwork, fetchWifiStatus, forgetNetwork, scanNetworks, type WifiNetwork, type WifiStatus } from '../services/wifi';
import { fetchVoices, speakPreview, type VoiceDefinition } from '../services/tts';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

type TabKey = 'weather' | 'wifi' | 'tts' | 'appearance' | 'calendar';

interface TabDefinition {
  key: TabKey;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const TABS: TabDefinition[] = [
  { key: 'weather', label: 'Clima', icon: Waves },
  { key: 'wifi', label: 'Wi-Fi', icon: Wifi },
  { key: 'tts', label: 'Voces', icon: Settings2 },
  { key: 'appearance', label: 'Apariencia', icon: Palette },
  { key: 'calendar', label: 'Calendario', icon: CalendarIcon },
];

const SettingsPanel = ({ open, onClose }: SettingsPanelProps) => {
  const { config, update, refresh } = useDashboardConfig();
  const [activeTab, setActiveTab] = useState<TabKey>('weather');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [weatherForm, setWeatherForm] = useState({
    apiKey: '',
    city: '',
    lat: '',
    lon: '',
    units: 'metric',
  });

  const [wifiStatus, setWifiStatus] = useState<WifiStatus | null>(null);
  const [networks, setNetworks] = useState<WifiNetwork[]>([]);
  const [selectedNetwork, setSelectedNetwork] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [wifiLoading, setWifiLoading] = useState(false);

  const [voices, setVoices] = useState<VoiceDefinition[]>([]);
  const [ttsVoice, setTtsVoice] = useState('');
  const [ttsVolume, setTtsVolume] = useState(0.8);
  const [ttsText, setTtsText] = useState('Hola, esto es una prueba');
  const [ttsLoading, setTtsLoading] = useState(false);

  const [calendarForm, setCalendarForm] = useState({
    enabled: false,
    icsUrl: '',
    maxEvents: 3,
    notifyMinutesBefore: 15,
    icsConfigured: false,
  });

  useEffect(() => {
    if (!open) return;
    setActiveTab('weather');
    if (config) {
      syncWithConfig(config);
    } else {
      refresh().catch(() => {
        // handled by provider
      });
    }
    void loadWifiStatus();
    void loadVoices();
    setMessage(null);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (config && open) {
      syncWithConfig(config);
    }
  }, [config, open]);

  useEffect(() => {
    setMessage(null);
    setError(null);
  }, [activeTab]);

  const syncWithConfig = (cfg: DashboardConfig) => {
    setWeatherForm({
      apiKey: '',
      city: cfg.weather?.city ?? '',
      lat: cfg.weather?.lat?.toString() ?? '',
      lon: cfg.weather?.lon?.toString() ?? '',
      units: cfg.weather?.units ?? 'metric',
    });
    setTtsVoice(cfg.tts?.voice ?? '');
    setTtsVolume(cfg.tts?.volume ?? 0.8);
    setCalendarForm({
      enabled: cfg.calendar?.enabled ?? false,
      icsUrl: '',
      maxEvents: cfg.calendar?.maxEvents ?? 3,
      notifyMinutesBefore: cfg.calendar?.notifyMinutesBefore ?? 15,
      icsConfigured: Boolean(cfg.calendar?.icsConfigured),
    });
  };

  const loadWifiStatus = async () => {
    try {
      const status = await fetchWifiStatus();
      setWifiStatus(status);
    } catch (err) {
      console.warn('Error al obtener estado Wi-Fi', err);
      setError(err instanceof Error ? err.message : 'No se pudo consultar Wi-Fi');
    }
  };

  const loadNetworks = async () => {
    setWifiLoading(true);
    setMessage(null);
    setError(null);
    try {
      const list = await scanNetworks();
      setNetworks(list);
      if (list.length > 0) {
        setSelectedNetwork(list[0].ssid);
      } else {
        setSelectedNetwork('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo escanear redes');
    } finally {
      setWifiLoading(false);
    }
  };

  const loadVoices = async () => {
    try {
      const voicesList = await fetchVoices();
      setVoices(voicesList);
      if (voicesList.length > 0) {
        setTtsVoice((prev) => prev || voicesList[0].id);
      }
    } catch (err) {
      console.warn('No se pudieron cargar voces', err);
    }
  };

  const handleWeatherSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setError(null);
    const payload: DashboardConfig = {
      weather: {
        city: weatherForm.city || undefined,
        units: weatherForm.units as 'metric' | 'imperial',
      },
    };
    if (weatherForm.lat) {
      payload.weather!.lat = Number(weatherForm.lat);
    }
    if (weatherForm.lon) {
      payload.weather!.lon = Number(weatherForm.lon);
    }
    if (weatherForm.apiKey) {
      payload.weather!.apiKey = weatherForm.apiKey;
    }
    try {
      await update(payload);
      setWeatherForm((prev) => ({ ...prev, apiKey: '' }));
      setMessage('Preferencias de clima actualizadas');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar clima');
    }
  };

  const handleWifiConnect = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedNetwork) return;
    setWifiLoading(true);
    setMessage(null);
    setError(null);
    try {
      await connectNetwork(selectedNetwork, wifiPassword || undefined);
      setMessage(`Conectado a ${selectedNetwork}`);
      setWifiPassword('');
      await loadWifiStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo conectar a la red');
    } finally {
      setWifiLoading(false);
    }
  };

  const handleWifiForget = async () => {
    if (!wifiStatus?.ssid) return;
    setWifiLoading(true);
    setMessage(null);
    setError(null);
    try {
      await forgetNetwork(wifiStatus.ssid);
      setMessage(`Red ${wifiStatus.ssid} olvidada`);
      await loadWifiStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo olvidar la red');
    } finally {
      setWifiLoading(false);
    }
  };

  const handleTtsSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setError(null);
    try {
      await update({ tts: { voice: ttsVoice || undefined, volume: ttsVolume } });
      setMessage('Preferencias de voz actualizadas');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar TTS');
    }
  };

  const handleTtsTest = async () => {
    setTtsLoading(true);
    setError(null);
    try {
      await speakPreview(ttsVoice || undefined, ttsText, ttsVolume);
      setMessage('Prueba de voz enviada');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo reproducir la voz');
    } finally {
      setTtsLoading(false);
    }
  };

  const handleAppearanceSave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const value = Number(formData.get('intervalMinutes'));
    setMessage(null);
    setError(null);
    try {
      await update({ background: { intervalMinutes: Number.isFinite(value) ? value : undefined } });
      setMessage('Intervalo de fondos guardado');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar apariencia');
    }
  };

  const currentBackgroundInterval = config?.background?.intervalMinutes ?? 5;

  const handleCalendarSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setError(null);
    const rawMax = Number.isFinite(calendarForm.maxEvents) ? calendarForm.maxEvents : 3;
    const rawNotify = Number.isFinite(calendarForm.notifyMinutesBefore)
      ? calendarForm.notifyMinutesBefore
      : 15;
    const maxEvents = Math.min(Math.max(Math.round(rawMax), 1), 10);
    const notifyMinutes = Math.min(Math.max(Math.round(rawNotify), 0), 360);
    const payload: DashboardConfig = {
      calendar: {
        enabled: calendarForm.enabled,
        maxEvents,
        notifyMinutesBefore: notifyMinutes,
      },
    };
    if (calendarForm.icsUrl.trim()) {
      payload.calendar!.icsUrl = calendarForm.icsUrl.trim();
    }
    try {
      await update(payload);
      setCalendarForm((prev) => ({ ...prev, icsUrl: '' }));
      setMessage('Preferencias de calendario guardadas');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar calendario');
    }
  };

  const activeContent = useMemo(() => {
    switch (activeTab) {
      case 'weather':
        return (
          <form className="space-y-4" onSubmit={handleWeatherSubmit}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="flex flex-col text-sm">
                <span className="text-slate-200/70">API key (nunca se mostrará)</span>
                <input
                  type="password"
                  className="mt-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-slate-100"
                  value={weatherForm.apiKey}
                  onChange={(event) => setWeatherForm((prev) => ({ ...prev, apiKey: event.target.value }))}
                  placeholder="••••••"
                />
              </label>
              <label className="flex flex-col text-sm">
                <span className="text-slate-200/70">Ciudad</span>
                <input
                  type="text"
                  className="mt-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-slate-100"
                  value={weatherForm.city}
                  onChange={(event) => setWeatherForm((prev) => ({ ...prev, city: event.target.value }))}
                  placeholder="Madrid"
                />
              </label>
              <label className="flex flex-col text-sm">
                <span className="text-slate-200/70">Latitud</span>
                <input
                  type="number"
                  step="0.0001"
                  min="-90"
                  max="90"
                  className="mt-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-slate-100"
                  value={weatherForm.lat}
                  onChange={(event) => setWeatherForm((prev) => ({ ...prev, lat: event.target.value }))}
                />
              </label>
              <label className="flex flex-col text-sm">
                <span className="text-slate-200/70">Longitud</span>
                <input
                  type="number"
                  step="0.0001"
                  min="-180"
                  max="180"
                  className="mt-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-slate-100"
                  value={weatherForm.lon}
                  onChange={(event) => setWeatherForm((prev) => ({ ...prev, lon: event.target.value }))}
                />
              </label>
              <label className="flex flex-col text-sm">
                <span className="text-slate-200/70">Unidades</span>
                <select
                  className="mt-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-slate-100"
                  value={weatherForm.units}
                  onChange={(event) => setWeatherForm((prev) => ({ ...prev, units: event.target.value }))}
                >
                  <option value="metric">Métrico (°C)</option>
                  <option value="imperial">Imperial (°F)</option>
                </select>
              </label>
            </div>
            <button
              type="submit"
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-emerald-950 hover:bg-emerald-400"
            >
              Guardar clima
            </button>
          </form>
        );
      case 'wifi':
        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm text-slate-200/80">
                Estado:{' '}
                {wifiStatus?.connected ? (
                  <span className="text-emerald-300">Conectado a {wifiStatus.ssid}</span>
                ) : (
                  <span className="text-rose-300">Sin conexión</span>
                )}
                {wifiStatus?.ip && <span className="ml-2 text-slate-300/70">IP {wifiStatus.ip}</span>}
              </div>
              <div className="flex gap-2">
                <button
                  className="rounded-lg border border-white/10 px-3 py-1 text-xs text-slate-100"
                  onClick={() => void loadWifiStatus()}
                >
                  Actualizar estado
                </button>
                <button
                  className="rounded-lg border border-white/10 px-3 py-1 text-xs text-slate-100"
                  onClick={() => void loadNetworks()}
                  disabled={wifiLoading}
                >
                  {wifiLoading ? 'Buscando…' : 'Escanear redes'}
                </button>
              </div>
            </div>
            {wifiStatus?.ssid && (
              <button
                className="rounded-lg border border-white/10 px-3 py-1 text-xs text-rose-200"
                onClick={() => void handleWifiForget()}
                disabled={wifiLoading}
              >
                Olvidar {wifiStatus.ssid}
              </button>
            )}
            {networks.length > 0 ? (
              <form className="space-y-3" onSubmit={handleWifiConnect}>
                <label className="flex flex-col text-sm">
                  <span className="text-slate-200/70">Red</span>
                  <select
                    className="mt-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-slate-100"
                    value={selectedNetwork}
                    onChange={(event) => setSelectedNetwork(event.target.value)}
                  >
                    {networks.map((network) => (
                      <option key={network.ssid} value={network.ssid}>
                        {network.ssid} · señal {network.signal ?? '—'}%
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col text-sm">
                  <span className="text-slate-200/70">Contraseña (si aplica)</span>
                  <input
                    type="password"
                    className="mt-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-slate-100"
                    value={wifiPassword}
                    onChange={(event) => setWifiPassword(event.target.value)}
                  />
                </label>
                <button
                  type="submit"
                  className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-emerald-950 hover:bg-emerald-400"
                  disabled={wifiLoading}
                >
                  Conectar
                </button>
              </form>
            ) : (
              <p className="text-sm text-slate-300/70">Escanea para mostrar redes disponibles.</p>
            )}
          </div>
        );
      case 'tts':
        return (
          <form className="space-y-4" onSubmit={handleTtsSave}>
            <label className="flex flex-col text-sm">
              <span className="text-slate-200/70">Voz</span>
              <select
                className="mt-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-slate-100"
                value={ttsVoice}
                onChange={(event) => setTtsVoice(event.target.value)}
              >
                {voices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.name} ({voice.lang})
                  </option>
                ))}
                {voices.length === 0 && <option>No hay voces disponibles</option>}
              </select>
            </label>
            <label className="flex flex-col text-sm">
              <span className="text-slate-200/70">Volumen: {(ttsVolume * 100).toFixed(0)}%</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={ttsVolume}
                onChange={(event) => setTtsVolume(Number(event.target.value))}
              />
            </label>
            <label className="flex flex-col text-sm">
              <span className="text-slate-200/70">Texto de prueba</span>
              <input
                type="text"
                className="mt-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-slate-100"
                value={ttsText}
                onChange={(event) => setTtsText(event.target.value)}
              />
            </label>
            <div className="flex gap-3">
              <button
                type="submit"
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-emerald-950 hover:bg-emerald-400"
              >
                Guardar voz
              </button>
              <button
                type="button"
                className="rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-100"
                onClick={() => void handleTtsTest()}
                disabled={ttsLoading}
              >
                {ttsLoading ? 'Reproduciendo…' : 'Probar voz'}
              </button>
            </div>
          </form>
        );
      case 'appearance':
        return (
          <form className="space-y-4" onSubmit={handleAppearanceSave}>
            <label className="flex flex-col text-sm">
              <span className="text-slate-200/70">Intervalo de fondos (minutos)</span>
              <input
                type="number"
                name="intervalMinutes"
                min="1"
                max="60"
                defaultValue={currentBackgroundInterval}
                className="mt-1 w-32 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-slate-100"
              />
            </label>
            <p className="text-xs text-slate-300/70">
              El tema puede cambiarse desde el selector inferior en cualquier momento. Se sincronizará con el backend.
            </p>
            <button
              type="submit"
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-emerald-950 hover:bg-emerald-400"
            >
              Guardar apariencia
            </button>
          </form>
        );
      case 'calendar':
        return (
          <form className="space-y-4" onSubmit={handleCalendarSubmit}>
            <label className="flex items-center justify-between rounded-lg border border-white/10 bg-black/40 px-4 py-2 text-sm">
              <span className="text-slate-200/70">Mostrar agenda del día</span>
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={calendarForm.enabled}
                onChange={(event) =>
                  setCalendarForm((prev) => ({ ...prev, enabled: event.target.checked }))
                }
              />
            </label>
            <label className="flex flex-col text-sm">
              <span className="text-slate-200/70">Enlace privado ICS de Google Calendar</span>
              <input
                type="password"
                className="mt-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-slate-100"
                value={calendarForm.icsUrl}
                onChange={(event) =>
                  setCalendarForm((prev) => ({ ...prev, icsUrl: event.target.value }))
                }
                placeholder="https://calendar.google.com/.../basic.ics"
              />
            </label>
            {calendarForm.icsConfigured && (
              <p className="text-xs text-emerald-300/80">
                Ya hay un enlace guardado. Si pegas uno nuevo, reemplazará el actual.
              </p>
            )}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="flex flex-col text-sm">
                <span className="text-slate-200/70">Eventos a mostrar</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  className="mt-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-slate-100"
                  value={calendarForm.maxEvents}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setCalendarForm((prev) => ({
                      ...prev,
                      maxEvents: Number.isFinite(value) ? value : prev.maxEvents,
                    }));
                  }}
                />
              </label>
              <label className="flex flex-col text-sm">
                <span className="text-slate-200/70">Avisar minutos antes</span>
                <input
                  type="number"
                  min={0}
                  max={360}
                  className="mt-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-slate-100"
                  value={calendarForm.notifyMinutesBefore}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setCalendarForm((prev) => ({
                      ...prev,
                      notifyMinutesBefore: Number.isFinite(value) ? value : prev.notifyMinutesBefore,
                    }));
                  }}
                />
              </label>
            </div>
            <p className="text-xs text-slate-300/70">
              Las alertas se muestran de forma discreta cuando un evento está por comenzar o en curso.
            </p>
            <button
              type="submit"
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-emerald-950 hover:bg-emerald-400"
            >
              Guardar calendario
            </button>
          </form>
        );
      default:
        return null;
    }
  }, [
    activeTab,
    weatherForm,
    networks,
    selectedNetwork,
    wifiPassword,
    wifiStatus,
    wifiLoading,
    voices,
    ttsVoice,
    ttsVolume,
    ttsText,
    ttsLoading,
    currentBackgroundInterval,
    calendarForm,
  ]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/60 px-4 py-8">
      <div className="relative w-full max-w-4xl rounded-3xl border border-white/10 bg-black/80 p-6 text-slate-100 shadow-2xl">
        <button
          onClick={onClose}
          aria-label="Cerrar ajustes"
          className="absolute right-4 top-4 rounded-full border border-white/10 bg-black/60 p-2 text-slate-200 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
        <h2 className="text-lg font-semibold uppercase tracking-[0.35em] text-slate-200">Ajustes</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 rounded-full border px-4 py-1 text-xs uppercase tracking-[0.2em] transition ${
                activeTab === tab.key
                  ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200'
                  : 'border-white/10 bg-white/5 text-slate-200 hover:border-white/20'
              }`}
            >
              <tab.icon className="h-3 w-3" />
              {tab.label}
            </button>
          ))}
        </div>
        <div className="mt-6 max-h-[60vh] overflow-y-auto pr-2 text-sm">
          {activeContent}
        </div>
        {(message || error) && (
          <div className="mt-4 rounded-lg border border-white/10 bg-black/60 px-4 py-2 text-xs">
            {message && <p className="text-emerald-300">{message}</p>}
            {error && <p className="text-rose-300">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsPanel;
