import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DynamicBackground from '../components/DynamicBackground';
import SceneEffects from '../components/SceneEffects';
import { BACKEND_BASE_URL } from '../services/config';

type NoticeType = 'success' | 'error' | 'info';

interface Notice {
  type: NoticeType;
  text: string;
}

interface ConfigStatus {
  hasOpenAI: boolean;
  configPath: string;
  envPath: string;
}

interface WifiItem {
  ssid: string;
  signal?: number;
  security?: string;
}

interface ConfigDraft {
  aemetApiKey: string;
  aemetMunicipioId: string;
  weatherCity: string;
  backgroundInterval: string;
  localeLanguage: string;
}

const DEFAULT_DRAFT: ConfigDraft = {
  aemetApiKey: '',
  aemetMunicipioId: '',
  weatherCity: '',
  backgroundInterval: '',
  localeLanguage: '',
};

async function parseError(response: Response): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data?.detail === 'string') return data.detail;
    if (typeof data?.message === 'string') return data.message;
  } catch (error) {
    // ignore
  }
  return response.statusText || 'Error inesperado';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BACKEND_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return (await response.json()) as T;
}

const buildDraftFromConfig = (config: Record<string, unknown> | null): ConfigDraft => {
  if (!config) return DEFAULT_DRAFT;
  const raw = (config.config as Record<string, any> | undefined) ?? {};
  const locale = (raw.locale as Record<string, unknown> | undefined) ?? {};
  const background = (raw.background as Record<string, unknown> | undefined) ?? {};
  const aemet = (raw.aemet as Record<string, unknown> | undefined) ?? {};
  const weather = (raw.weather as Record<string, unknown> | undefined) ?? {};
  return {
    aemetApiKey: typeof aemet.apiKey === 'string' ? aemet.apiKey : '',
    aemetMunicipioId: typeof aemet.municipioId === 'string' ? aemet.municipioId : '',
    weatherCity: typeof weather.city === 'string' ? weather.city : '',
    backgroundInterval:
      typeof background.intervalMinutes === 'number'
        ? String(background.intervalMinutes)
        : typeof background.intervalMinutes === 'string'
        ? background.intervalMinutes
        : '',
    localeLanguage: typeof locale.language === 'string' ? locale.language : '',
  };
};

const Settings = () => {
  const navigate = useNavigate();
  const [notice, setNotice] = useState<Notice | null>(null);
  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [draft, setDraft] = useState<ConfigDraft>(DEFAULT_DRAFT);
  const [initialDraft, setInitialDraft] = useState<ConfigDraft>(DEFAULT_DRAFT);
  const [openAiKey, setOpenAiKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [loading, setLoading] = useState(true);
  const [wifiNetworks, setWifiNetworks] = useState<WifiItem[]>([]);
  const [wifiRaw, setWifiRaw] = useState('');
  const [scanningWifi, setScanningWifi] = useState(false);
  const [wifiMessage, setWifiMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        const [statusPayload, configPayload] = await Promise.all([
          request<ConfigStatus>('/api/config/status'),
          request<Record<string, unknown>>('/api/config'),
        ]);
        setStatus(statusPayload);
        const nextDraft = buildDraftFromConfig(configPayload);
        setDraft(nextDraft);
        setInitialDraft(nextDraft);
      } catch (error) {
        console.error('Error cargando ajustes', error);
        setNotice({
          type: 'error',
          text: error instanceof Error ? error.message : 'No se pudieron cargar los ajustes',
        });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const openAiStateLabel = useMemo(() => {
    if (!status) return 'Desconocido';
    return status.hasOpenAI ? 'Configurada' : 'Sin configurar';
  }, [status]);

  const buildConfigPatch = () => {
    const patch: Record<string, unknown> = {};
    const initial = initialDraft;

    if (draft.aemetApiKey !== initial.aemetApiKey || draft.aemetMunicipioId !== initial.aemetMunicipioId) {
      const payload: Record<string, string> = {};
      if (draft.aemetApiKey !== initial.aemetApiKey) {
        payload.apiKey = draft.aemetApiKey.trim();
      }
      if (draft.aemetMunicipioId !== initial.aemetMunicipioId) {
        payload.municipioId = draft.aemetMunicipioId.trim();
      }
      patch.aemet = payload;
    }

    if (draft.weatherCity !== initial.weatherCity) {
      patch.weather = { city: draft.weatherCity.trim() };
    }

    if (draft.backgroundInterval !== initial.backgroundInterval) {
      const trimmed = draft.backgroundInterval.trim();
      const minutes = Number.parseInt(trimmed, 10);
      if (!trimmed || Number.isNaN(minutes) || minutes <= 0) {
        throw new Error('Intervalo de actualización inválido');
      }
      patch.background = { intervalMinutes: minutes };
    }

    if (draft.localeLanguage !== initial.localeLanguage) {
      patch.locale = { language: draft.localeLanguage.trim() };
    }

    if (Object.keys(patch).length === 0) {
      throw new Error('No hay cambios para guardar');
    }

    return patch;
  };

  const handleSaveConfig = async () => {
    try {
      setSavingConfig(true);
      const patch = buildConfigPatch();
      const result = await request<Record<string, unknown>>('/api/config', {
        method: 'POST',
        body: JSON.stringify(patch),
      });
      const nextDraft = buildDraftFromConfig(result);
      setDraft(nextDraft);
      setInitialDraft(nextDraft);
      setNotice({ type: 'success', text: 'Configuración guardada correctamente' });
    } catch (error) {
      if (error instanceof Error) {
        setNotice({ type: 'error', text: error.message });
      } else {
        setNotice({ type: 'error', text: 'No se pudo guardar la configuración' });
      }
    } finally {
      setSavingConfig(false);
    }
  };

  const handleSaveKey = async () => {
    const trimmed = openAiKey.trim();
    if (!trimmed) {
      setNotice({ type: 'error', text: 'Introduce una clave válida' });
      return;
    }

    try {
      setSavingKey(true);
      await request<Record<string, unknown>>('/api/config/openai', {
        method: 'POST',
        body: JSON.stringify({ key: trimmed }),
      });
      setOpenAiKey('');
      setNotice({ type: 'success', text: 'Clave OpenAI actualizada' });
      const freshStatus = await request<ConfigStatus>('/api/config/status');
      setStatus(freshStatus);
    } catch (error) {
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo guardar la clave' });
    } finally {
      setSavingKey(false);
    }
  };

  const handleScanWifi = async () => {
    try {
      setScanningWifi(true);
      const result = await request<{ items?: WifiItem[]; raw?: string }>('/api/wifi/scan');
      setWifiNetworks(result.items ?? []);
      setWifiRaw(result.raw ?? '');
      setWifiMessage('Escaneo completado');
    } catch (error) {
      setWifiMessage(null);
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo escanear redes Wi-Fi' });
    } finally {
      setScanningWifi(false);
    }
  };

  const handleWifiConnect = async (network: WifiItem) => {
    let psk: string | undefined;
    if (network.security && !/open/i.test(network.security)) {
      const input = window.prompt(`Contraseña para ${network.ssid}`) ?? '';
      if (!input.trim()) {
        setNotice({ type: 'info', text: 'Conexión cancelada' });
        return;
      }
      psk = input.trim();
    }

    try {
      const result = await request<{ ok?: boolean; stdout?: string; stderr?: string }>('/api/wifi/connect', {
        method: 'POST',
        body: JSON.stringify({ ssid: network.ssid, ...(psk ? { psk } : {}) }),
      });
      if (result.ok) {
        setWifiMessage(`Conectado a ${network.ssid}`);
        setNotice({ type: 'success', text: `Conectado a ${network.ssid}` });
      } else {
        const reason = result.stderr || 'No se pudo conectar';
        setWifiMessage(reason);
        setNotice({ type: 'error', text: reason });
      }
    } catch (error) {
      setWifiMessage(null);
      setNotice({ type: 'error', text: error instanceof Error ? error.message : 'No se pudo conectar a la red' });
    }
  };

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
      <DynamicBackground refreshMinutes={60} />
      <SceneEffects />
      <div className="relative z-10 flex h-full w-full max-w-[1920px] flex-col gap-6 px-10 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-semibold text-white">Ajustes</h1>
            <p className="text-sm text-white/70">Gestiona parámetros remotos y conectividad</p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="rounded-full border border-white/40 px-4 py-2 text-sm font-medium text-white transition hover:border-white/80 hover:bg-white/10"
          >
            ← Volver
          </button>
        </div>
        {notice && (
          <div
            className={`rounded-2xl px-4 py-3 text-sm font-medium text-white shadow-lg backdrop-blur ${
              notice.type === 'success'
                ? 'bg-emerald-500/30'
                : notice.type === 'error'
                ? 'bg-rose-500/40'
                : 'bg-white/20'
            }`}
          >
            {notice.text}
          </div>
        )}
        <div className="grid flex-1 grid-cols-3 gap-6 text-white">
          <section className="flex flex-col rounded-3xl bg-black/30 p-6 backdrop-blur-lg">
            <header className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-semibold">OpenAI</h2>
                <p className="text-sm text-white/70">Estado: {openAiStateLabel}</p>
              </div>
            </header>
            <div className="flex flex-col gap-3">
              <input
                type="text"
                value={openAiKey}
                onChange={(event) => setOpenAiKey(event.target.value)}
                placeholder="sk-..."
                className="w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/50 focus:border-white focus:outline-none"
              />
              <button
                type="button"
                onClick={handleSaveKey}
                disabled={savingKey}
                className="rounded-2xl bg-white/20 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {savingKey ? 'Guardando...' : 'Guardar clave'}
              </button>
              {status && (
                <div className="mt-2 space-y-1 text-xs text-white/70">
                  <p>Config: {status.configPath || '—'}</p>
                  <p>Env: {status.envPath || '—'}</p>
                </div>
              )}
            </div>
          </section>
          <section className="flex flex-col rounded-3xl bg-black/30 p-6 backdrop-blur-lg">
            <header className="mb-4">
              <h2 className="text-2xl font-semibold">AEMET y clima</h2>
              <p className="text-sm text-white/70">Configura la fuente de datos meteorológicos</p>
            </header>
            <div className="flex flex-1 flex-col gap-3">
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-white/60">AEMET API Key</label>
                <input
                  type="text"
                  value={draft.aemetApiKey}
                  onChange={(event) => setDraft((prev) => ({ ...prev, aemetApiKey: event.target.value }))}
                  className="w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:border-white focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-white/60">AEMET Municipio ID</label>
                <input
                  type="text"
                  value={draft.aemetMunicipioId}
                  onChange={(event) => setDraft((prev) => ({ ...prev, aemetMunicipioId: event.target.value }))}
                  className="w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:border-white focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-white/60">Ciudad</label>
                <input
                  type="text"
                  value={draft.weatherCity}
                  onChange={(event) => setDraft((prev) => ({ ...prev, weatherCity: event.target.value }))}
                  className="w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:border-white focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-white/60">Intervalo fondos (min)</label>
                <input
                  type="text"
                  value={draft.backgroundInterval}
                  onChange={(event) => setDraft((prev) => ({ ...prev, backgroundInterval: event.target.value }))}
                  className="w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:border-white focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs uppercase tracking-wide text-white/60">Idioma (locale.language)</label>
                <input
                  type="text"
                  value={draft.localeLanguage}
                  onChange={(event) => setDraft((prev) => ({ ...prev, localeLanguage: event.target.value }))}
                  className="w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:border-white focus:outline-none"
                />
              </div>
              <div className="mt-auto pt-2">
                <button
                  type="button"
                  onClick={handleSaveConfig}
                  disabled={savingConfig}
                  className="w-full rounded-2xl bg-white/20 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/30 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingConfig ? 'Guardando...' : 'Guardar configuración'}
                </button>
              </div>
            </div>
          </section>
          <section className="flex flex-col rounded-3xl bg-black/30 p-6 backdrop-blur-lg">
            <header className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-semibold">Wi-Fi</h2>
                <p className="text-sm text-white/70">Gestiona redes disponibles</p>
              </div>
              <button
                type="button"
                onClick={handleScanWifi}
                disabled={scanningWifi}
                className="rounded-2xl bg-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {scanningWifi ? 'Escaneando...' : 'Escanear'}
              </button>
            </header>
            <div className="flex flex-1 flex-col gap-3 overflow-hidden">
              <div className="flex-1 space-y-2 overflow-y-auto pr-1">
                {wifiNetworks.length === 0 && (
                  <p className="text-sm text-white/60">No hay redes disponibles. {scanningWifi ? 'Buscando...' : 'Pulsa escanear.'}</p>
                )}
                {wifiNetworks.map((network) => (
                  <div
                    key={`${network.ssid}-${network.security ?? 'open'}`}
                    className="flex items-center justify-between rounded-2xl bg-white/10 px-4 py-3 text-sm"
                  >
                    <div>
                      <p className="font-semibold">{network.ssid || '(sin SSID)'}</p>
                      <p className="text-xs text-white/60">
                        {network.signal != null ? `${network.signal}% · ` : ''}
                        {network.security || 'OPEN'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleWifiConnect(network)}
                      className="rounded-full bg-white/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white transition hover:bg-white/30"
                    >
                      Conectar
                    </button>
                  </div>
                ))}
              </div>
              {wifiMessage && <p className="text-xs text-white/70">{wifiMessage}</p>}
              {wifiRaw && (
                <pre className="max-h-32 overflow-y-auto rounded-2xl bg-black/40 px-3 py-2 text-[11px] text-white/50">
                  {wifiRaw}
                </pre>
              )}
            </div>
          </section>
        </div>
        {loading && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 text-white">
            Cargando ajustes...
          </div>
        )}
      </div>
    </div>
  );
};

export default Settings;
