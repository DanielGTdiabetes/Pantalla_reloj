import { useCallback, useEffect, useMemo, useState } from 'react';
import Background from '../components/Background';
import GlassPanel from '../components/GlassPanel';
import {
  fetchConfigEnvelope,
  saveConfigPatch,
  saveSecretsPatch,
  type ConfigEnvelope,
  type ConfigUpdate,
} from '../services/config';
import { connectNetwork, fetchWifiStatus, scanNetworks, type WifiNetwork, type WifiStatus } from '../services/wifi';
import { useDashboardConfig } from '../context/DashboardConfigContext';

interface Notice {
  type: 'success' | 'error' | 'info';
  text: string;
}

interface FormState {
  aemetApiKey: string;
  aemetMunicipioId: string;
  weatherCity: string;
  weatherUnits: 'metric' | 'imperial';
  calendarEnabled: boolean;
  calendarIcsUrl: string;
  calendarMaxEvents: string;
  calendarNotifyMinutesBefore: string;
  backgroundMode: 'daily' | 'weather';
  backgroundIntervalMinutes: string;
  backgroundRetainDays: string;
}

const DEFAULT_FORM: FormState = {
  aemetApiKey: '',
  aemetMunicipioId: '',
  weatherCity: '',
  weatherUnits: 'metric',
  calendarEnabled: false,
  calendarIcsUrl: '',
  calendarMaxEvents: '3',
  calendarNotifyMinutesBefore: '15',
  backgroundMode: 'daily',
  backgroundIntervalMinutes: '60',
  backgroundRetainDays: '7',
};

const Config = () => {
  const { refresh: refreshConfig } = useDashboardConfig();
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [envelope, setEnvelope] = useState<ConfigEnvelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [wifiNotice, setWifiNotice] = useState<Notice | null>(null);
  const [wifiStatus, setWifiStatus] = useState<WifiStatus | null>(null);
  const [wifiNetworks, setWifiNetworks] = useState<WifiNetwork[]>([]);
  const [wifiRaw, setWifiRaw] = useState('');
  const [scanningWifi, setScanningWifi] = useState(false);
  const [connectingWifi, setConnectingWifi] = useState(false);
  const [selectedSsid, setSelectedSsid] = useState<string | null>(null);
  const [wifiPassword, setWifiPassword] = useState('');
  const [openAiInput, setOpenAiInput] = useState('');
  const [savingSecrets, setSavingSecrets] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  const openAiDetails = useMemo(() => {
    const secrets = (envelope?.secrets ?? {}) as Record<string, any>;
    const openai = secrets?.openai as { hasKey?: boolean; masked?: string | null } | undefined;
    return {
      hasKey: Boolean(openai?.hasKey),
      masked: typeof openai?.masked === 'string' ? openai.masked : null,
    };
  }, [envelope?.secrets]);

  const buildFormFromConfig = useCallback((configData: Record<string, any> | null): FormState => {
    if (!configData) return DEFAULT_FORM;
    const aemet = (configData.aemet as Record<string, any> | undefined) ?? {};
    const weather = (configData.weather as Record<string, any> | undefined) ?? {};
    const calendar = (configData.calendar as Record<string, any> | undefined) ?? {};
    const background = (configData.background as Record<string, any> | undefined) ?? {};

    return {
      aemetApiKey: typeof aemet.apiKey === 'string' ? aemet.apiKey : '',
      aemetMunicipioId: typeof aemet.municipioId === 'string' ? aemet.municipioId : '',
      weatherCity: typeof weather.city === 'string' ? weather.city : '',
      weatherUnits: weather.units === 'imperial' ? 'imperial' : 'metric',
      calendarEnabled: Boolean(calendar.enabled),
      calendarIcsUrl: typeof calendar.icsUrl === 'string' ? calendar.icsUrl : '',
      calendarMaxEvents:
        typeof calendar.maxEvents === 'number' ? String(calendar.maxEvents) : DEFAULT_FORM.calendarMaxEvents,
      calendarNotifyMinutesBefore:
        typeof calendar.notifyMinutesBefore === 'number'
          ? String(calendar.notifyMinutesBefore)
          : DEFAULT_FORM.calendarNotifyMinutesBefore,
      backgroundMode: background.mode === 'weather' ? 'weather' : 'daily',
      backgroundIntervalMinutes:
        typeof background.intervalMinutes === 'number'
          ? String(background.intervalMinutes)
          : DEFAULT_FORM.backgroundIntervalMinutes,
      backgroundRetainDays:
        typeof background.retainDays === 'number'
          ? String(background.retainDays)
          : DEFAULT_FORM.backgroundRetainDays,
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [configData, wifiData] = await Promise.all([
        fetchConfigEnvelope(),
        fetchWifiStatus().catch(() => null),
      ]);
      setEnvelope(configData);
      setForm(buildFormFromConfig((configData.config as Record<string, any>) ?? null));
      if (wifiData) setWifiStatus(wifiData);
      setNotice(null);
      setWifiNotice(null);
    } catch (error) {
      console.error('Error cargando configuración', error);
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'No se pudo cargar la configuración',
      });
    } finally {
      setLoading(false);
    }
  }, [buildFormFromConfig]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!wifiNotice) return;
    const timeout = window.setTimeout(() => setWifiNotice(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [wifiNotice]);

  const handleFormChange = <T extends keyof FormState>(key: T, value: FormState[T]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const parseInteger = (value: string) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    setNotice(null);
    const patch: ConfigUpdate = {
      aemet: {
        apiKey: form.aemetApiKey || undefined,
        municipioId: form.aemetMunicipioId || undefined,
      },
      weather: {
        city: form.weatherCity || undefined,
        units: form.weatherUnits,
      },
      calendar: {
        enabled: form.calendarEnabled,
        icsUrl: form.calendarIcsUrl || null,
        maxEvents: parseInteger(form.calendarMaxEvents),
        notifyMinutesBefore: parseInteger(form.calendarNotifyMinutesBefore),
      },
      background: {
        mode: form.backgroundMode,
        intervalMinutes: parseInteger(form.backgroundIntervalMinutes),
        retainDays: parseInteger(form.backgroundRetainDays),
      },
    };

    try {
      const updated = await saveConfigPatch(patch);
      setEnvelope(updated);
      setForm(buildFormFromConfig((updated.config as Record<string, any>) ?? null));
      setNotice({ type: 'success', text: 'Configuración guardada' });
      await refreshConfig();
    } catch (error) {
      console.error('No se pudo guardar configuración', error);
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'Error al guardar configuración',
      });
    } finally {
      setSavingConfig(false);
    }
  };

  const handleSaveSecrets = async () => {
    setSavingSecrets(true);
    setNotice(null);
    try {
      const updated = await saveSecretsPatch({ openai: { apiKey: openAiInput || null } });
      setEnvelope(updated);
      setOpenAiInput('');
      setNotice({ type: 'success', text: 'Clave de OpenAI actualizada' });
    } catch (error) {
      console.error('Error guardando secreto', error);
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'No se pudo guardar la clave',
      });
    } finally {
      setSavingSecrets(false);
      try {
        await refreshConfig();
      } catch (error) {
        console.warn('No se pudo refrescar config tras guardar secreto', error);
      }
    }
  };

  const handleScanWifi = async () => {
    setScanningWifi(true);
    try {
      const result = await scanNetworks();
      setWifiNetworks(result.networks ?? []);
      setWifiRaw(result.raw ?? '');
      setWifiNotice({ type: 'info', text: `Se encontraron ${result.networks?.length ?? 0} redes` });
    } catch (error) {
      console.error('Error escaneando redes', error);
      setWifiNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'No se pudo escanear Wi-Fi',
      });
    } finally {
      setScanningWifi(false);
    }
  };

  const handleConnectWifi = async () => {
    if (!selectedSsid) {
      setWifiNotice({ type: 'error', text: 'Selecciona una red para conectar' });
      return;
    }
    setConnectingWifi(true);
    try {
      await connectNetwork(selectedSsid, wifiPassword || undefined);
      const status = await fetchWifiStatus();
      setWifiStatus(status);
      setWifiNotice({ type: 'success', text: `Conectado a ${selectedSsid}` });
    } catch (error) {
      console.error('Error conectando a Wi-Fi', error);
      setWifiNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'No se pudo conectar a la red',
      });
    } finally {
      setConnectingWifi(false);
    }
  };

  const backgroundMinutes = useMemo(() => {
    const configData = (envelope?.config ?? {}) as Record<string, any>;
    const background = (configData.background as Record<string, any> | undefined) ?? {};
    return typeof background.intervalMinutes === 'number' ? background.intervalMinutes : undefined;
  }, [envelope?.config]);

  return (
    <div className="relative flex h-screen w-screen bg-slate-950 text-white">
      <Background refreshMinutes={backgroundMinutes ?? 60} />
      <div className="relative z-10 flex h-full w-full overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-8 px-8 py-10">
          <header className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold text-white/90">Configuración general</h1>
            <p className="text-sm text-white/60">
              Ajusta las integraciones y la conectividad de la pantalla desde este panel administrativo.
            </p>
          </header>

          {notice ? (
            <div
              className={`rounded-xl border px-4 py-3 text-sm ${
                notice.type === 'success'
                  ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100'
                  : notice.type === 'error'
                  ? 'border-red-400/40 bg-red-500/10 text-red-100'
                  : 'border-sky-400/40 bg-sky-500/10 text-sky-100'
              }`}
            >
              {notice.text}
            </div>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-2">
            <GlassPanel className="gap-6">
              <div>
                <h2 className="text-lg font-medium text-white/85">APIs y servicios</h2>
                <p className="text-sm text-white/55">
                  Configura las claves y parámetros de acceso para OpenAI, AEMET y Google Calendar.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs uppercase tracking-wide text-white/50">Clave OpenAI</label>
                  <div className="mt-2 grid gap-2 md:grid-cols-[2fr_1fr]">
                    <input
                      type="text"
                      className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-white/40 focus:outline-none"
                      placeholder={openAiDetails.masked ?? 'sk-••••••'}
                      value={openAiInput}
                      onChange={(event) => setOpenAiInput(event.target.value)}
                    />
                    <button
                      type="button"
                      onClick={handleSaveSecrets}
                      className="rounded-lg bg-emerald-500/80 px-3 py-2 text-sm font-medium text-white shadow-md transition hover:bg-emerald-500"
                      disabled={savingSecrets}
                    >
                      {savingSecrets ? 'Guardando…' : openAiDetails.hasKey ? 'Actualizar clave' : 'Guardar clave'}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-white/45">
                    Estado: {openAiDetails.hasKey ? 'Configurada' : 'Sin configurar'}
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-xs uppercase tracking-wide text-white/50">AEMET API Key</label>
                    <input
                      type="text"
                      className="mt-2 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-white/40 focus:outline-none"
                      value={form.aemetApiKey}
                      onChange={(event) => handleFormChange('aemetApiKey', event.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-wide text-white/50">AEMET Municipio ID</label>
                    <input
                      type="text"
                      className="mt-2 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-white/40 focus:outline-none"
                      value={form.aemetMunicipioId}
                      onChange={(event) => handleFormChange('aemetMunicipioId', event.target.value)}
                    />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-xs uppercase tracking-wide text-white/50">Ciudad para el clima</label>
                    <input
                      type="text"
                      className="mt-2 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-white/40 focus:outline-none"
                      value={form.weatherCity}
                      onChange={(event) => handleFormChange('weatherCity', event.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-wide text-white/50">Unidades</label>
                    <select
                      className="mt-2 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none"
                      value={form.weatherUnits}
                      onChange={(event) =>
                        handleFormChange('weatherUnits', event.target.value === 'imperial' ? 'imperial' : 'metric')
                      }
                    >
                      <option value="metric">Métrico</option>
                      <option value="imperial">Imperial</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wide text-white/50">Google Calendar ICS</label>
                  <input
                    type="url"
                    className="mt-2 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-white/40 focus:outline-none"
                    value={form.calendarIcsUrl}
                    onChange={(event) => handleFormChange('calendarIcsUrl', event.target.value)}
                  />
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <label className="flex items-center gap-2 text-xs text-white/70">
                      <input
                        type="checkbox"
                        checked={form.calendarEnabled}
                        onChange={(event) => handleFormChange('calendarEnabled', event.target.checked)}
                        className="h-4 w-4 rounded border-white/30 bg-white/10 text-emerald-400 focus:ring-emerald-400"
                      />
                      Calendario activo
                    </label>
                    <div>
                      <span className="block text-xs uppercase tracking-wide text-white/50">Máx. eventos</span>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        className="mt-1 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none"
                        value={form.calendarMaxEvents}
                        onChange={(event) => handleFormChange('calendarMaxEvents', event.target.value)}
                      />
                    </div>
                    <div>
                      <span className="block text-xs uppercase tracking-wide text-white/50">Aviso previo (min)</span>
                      <input
                        type="number"
                        min={0}
                        max={360}
                        className="mt-1 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none"
                        value={form.calendarNotifyMinutesBefore}
                        onChange={(event) => handleFormChange('calendarNotifyMinutesBefore', event.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleSaveConfig}
                  className="rounded-lg bg-white/15 px-4 py-2 text-sm font-medium text-white shadow-md transition hover:bg-white/25"
                  disabled={savingConfig || loading}
                >
                  {savingConfig ? 'Guardando…' : 'Guardar cambios'}
                </button>
              </div>
            </GlassPanel>

            <GlassPanel className="gap-6">
              <div>
                <h2 className="text-lg font-medium text-white/85">Fondo dinámico</h2>
                <p className="text-sm text-white/55">
                  Controla el modo de rotación de fondos generados por el backend y su frecuencia.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-xs uppercase tracking-wide text-white/50">Modo</label>
                  <select
                    className="mt-2 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none"
                    value={form.backgroundMode}
                    onChange={(event) =>
                      handleFormChange('backgroundMode', event.target.value === 'weather' ? 'weather' : 'daily')
                    }
                  >
                    <option value="daily">Diario</option>
                    <option value="weather">Según clima</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-wide text-white/50">Intervalo (minutos)</label>
                  <input
                    type="number"
                    min={1}
                    max={240}
                    className="mt-2 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none"
                    value={form.backgroundIntervalMinutes}
                    onChange={(event) => handleFormChange('backgroundIntervalMinutes', event.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-wide text-white/50">Retención (días)</label>
                  <input
                    type="number"
                    min={1}
                    max={90}
                    className="mt-2 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none"
                    value={form.backgroundRetainDays}
                    onChange={(event) => handleFormChange('backgroundRetainDays', event.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-lg font-medium text-white/85">Conectividad Wi-Fi</h3>
                {wifiNotice ? (
                  <div
                    className={`rounded-lg border px-3 py-2 text-xs ${
                      wifiNotice.type === 'success'
                        ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100'
                        : wifiNotice.type === 'error'
                        ? 'border-red-400/40 bg-red-500/10 text-red-100'
                        : 'border-sky-400/40 bg-sky-500/10 text-sky-100'
                    }`}
                  >
                    {wifiNotice.text}
                  </div>
                ) : null}

                <div className="rounded-xl border border-white/15 bg-white/5 p-4 text-sm text-white/80">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-white/50">Estado actual</div>
                      <div className="mt-1 text-base text-white/90">
                        {wifiStatus?.connected
                          ? `Conectado a ${wifiStatus.ssid ?? 'desconocido'}`
                          : 'Sin conexión Wi-Fi'}
                      </div>
                      <div className="text-xs text-white/55">
                        {wifiStatus?.ip ? `IP: ${wifiStatus.ip}` : 'IP no disponible'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleScanWifi}
                      className="rounded-lg bg-white/20 px-3 py-2 text-xs font-medium text-white transition hover:bg-white/30"
                      disabled={scanningWifi}
                    >
                      {scanningWifi ? 'Buscando…' : 'Escanear redes'}
                    </button>
                  </div>
                </div>

                {wifiNetworks.length > 0 ? (
                  <div className="space-y-2">
                    <div className="text-xs uppercase tracking-wide text-white/45">Redes disponibles</div>
                    <div className="max-h-64 space-y-2 overflow-y-auto pr-2">
                      {wifiNetworks.map((network) => (
                        <button
                          key={network.ssid}
                          type="button"
                          onClick={() => setSelectedSsid(network.ssid)}
                          className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition ${
                            selectedSsid === network.ssid
                              ? 'border-emerald-400/50 bg-emerald-500/10 text-emerald-100'
                              : 'border-white/15 bg-white/5 text-white/80 hover:border-white/30 hover:bg-white/10'
                          }`}
                        >
                          <span>{network.ssid}</span>
                          <span className="text-xs text-white/60">{network.signal ?? '–'}%</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {wifiRaw ? (
                  <details className="rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-white/60">
                    <summary className="cursor-pointer text-white/70">Detalle nmcli</summary>
                    <pre className="mt-2 whitespace-pre-wrap break-words text-[11px] text-white/50">{wifiRaw}</pre>
                  </details>
                ) : null}

                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="block text-xs uppercase tracking-wide text-white/50">SSID seleccionado</label>
                    <input
                      type="text"
                      readOnly
                      className="mt-2 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none"
                      value={selectedSsid ?? ''}
                      placeholder="Selecciona una red"
                    />
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-wide text-white/50">Contraseña</label>
                    <input
                      type="password"
                      className="mt-2 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none"
                      value={wifiPassword}
                      onChange={(event) => setWifiPassword(event.target.value)}
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleConnectWifi}
                    className="rounded-lg bg-emerald-500/80 px-4 py-2 text-sm font-medium text-white shadow-md transition hover:bg-emerald-500"
                    disabled={connectingWifi}
                  >
                    {connectingWifi ? 'Conectando…' : 'Conectar' }
                  </button>
                </div>
              </div>
            </GlassPanel>
          </div>

          {loading ? (
            <div className="text-center text-sm text-white/60">Cargando configuración…</div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default Config;
