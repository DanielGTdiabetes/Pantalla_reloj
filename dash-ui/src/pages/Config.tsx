import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import Background from '../components/Background';
import GlassPanel from '../components/GlassPanel';
import {
  fetchConfigEnvelope,
  saveConfigPatch,
  saveSecretsPatch,
  type ConfigEnvelope,
  type ConfigUpdate,
  type RotatingPanelSectionKey,
} from '../services/config';
import {
  deleteCalendarFile,
  fetchCalendarStatus,
  uploadCalendarFile,
  startGoogleDeviceFlow,
  fetchGoogleDeviceStatus,
  cancelGoogleDeviceFlow,
  fetchGoogleCalendars,
  type CalendarStatus,
  type GoogleDeviceStartResponse,
  type GoogleDeviceStatus,
  type GoogleCalendarListItem,
} from '../services/calendar';
import { connectNetwork, fetchWifiStatus, scanNetworks, type WifiNetwork, type WifiStatus } from '../services/wifi';
import { useDashboardConfig } from '../context/DashboardConfigContext';

const MAX_CALENDAR_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_CALENDAR_TYPES = ['text/calendar', 'text/plain', 'application/octet-stream'];

const ROTATING_PANEL_SECTION_OPTIONS: Array<{
  key: RotatingPanelSectionKey;
  label: string;
  description: string;
}> = [
  {
    key: 'calendar',
    label: 'Calendario',
    description: 'Agenda compacta con los eventos programados para hoy.',
  },
  {
    key: 'season',
    label: 'Temporada',
    description: 'Frutas y hortalizas destacadas para el mes en curso.',
  },
  {
    key: 'weekly',
    label: 'Previsión semanal',
    description: 'Resumen de iconos, lluvias y temperaturas de los próximos días.',
  },
  {
    key: 'lunar',
    label: 'Fase lunar',
    description: 'Estado actual de la luna y porcentaje de iluminación.',
  },
];

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${value} B`;
}

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
  calendarProvider: 'none' | 'ics' | 'url' | 'google';
  calendarMode: 'url' | 'ics';
  calendarUrl: string;
  calendarMaxEvents: string;
  calendarNotifyMinutesBefore: string;
  googleCalendarId: string;
  backgroundMode: 'daily' | 'weather';
  backgroundIntervalMinutes: string;
  backgroundRetainDays: string;
  rotatingPanelEnabled: boolean;
  rotatingPanelIntervalSeconds: string;
  rotatingPanelSections: Record<RotatingPanelSectionKey, boolean>;
}

const DEFAULT_FORM: FormState = {
  aemetApiKey: '',
  aemetMunicipioId: '',
  weatherCity: '',
  weatherUnits: 'metric',
  calendarEnabled: false,
  calendarProvider: 'none',
  calendarMode: 'url',
  calendarUrl: '',
  calendarMaxEvents: '3',
  calendarNotifyMinutesBefore: '15',
  googleCalendarId: 'primary',
  backgroundMode: 'daily',
  backgroundIntervalMinutes: '60',
  backgroundRetainDays: '7',
  rotatingPanelEnabled: true,
  rotatingPanelIntervalSeconds: '7',
  rotatingPanelSections: {
    calendar: true,
    season: true,
    weekly: true,
    lunar: true,
  },
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
  const [calendarStatus, setCalendarStatus] = useState<CalendarStatus | null>(null);
  const [calendarUploadState, setCalendarUploadState] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [calendarUploadMessage, setCalendarUploadMessage] = useState<string | null>(null);
  const [calendarUploadProgress, setCalendarUploadProgress] = useState(0);
  const [calendarDeleting, setCalendarDeleting] = useState(false);
  const [calendarDragActive, setCalendarDragActive] = useState(false);
  const [googleStatus, setGoogleStatus] = useState<GoogleDeviceStatus | null>(null);
  const [googleDeviceInfo, setGoogleDeviceInfo] = useState<GoogleDeviceStartResponse | null>(null);
  const [googleCalendars, setGoogleCalendars] = useState<GoogleCalendarListItem[]>([]);
  const [googleCalendarsLoading, setGoogleCalendarsLoading] = useState(false);
  const [googleActionError, setGoogleActionError] = useState<string | null>(null);
  const googleStatusTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const calendarUploading = calendarUploadState === 'uploading';
  const calendarFileDetails = useMemo(() => {
    if (!calendarStatus) {
      return { updated: null as string | null, size: null as string | null };
    }
    const updated = calendarStatus.mtime ? new Date(calendarStatus.mtime).toLocaleString('es-ES') : null;
    const size = typeof calendarStatus.size === 'number' ? formatBytes(calendarStatus.size) : null;
    return { updated, size };
  }, [calendarStatus]);

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
    const ui = (configData.ui as Record<string, any> | undefined) ?? {};
    const rotating = (ui.rotatingPanel as Record<string, any> | undefined) ?? {};

    const providerValue = typeof calendar.provider === 'string' ? calendar.provider.toLowerCase() : '';
    let calendarProvider: FormState['calendarProvider'];
    if (providerValue === 'google') {
      calendarProvider = 'google';
    } else if (providerValue === 'ics') {
      calendarProvider = 'ics';
    } else if (providerValue === 'url') {
      calendarProvider = 'url';
    } else if (providerValue === 'none') {
      calendarProvider = 'none';
    } else if (!calendar.enabled) {
      calendarProvider = 'none';
    } else if (calendar.icsPath) {
      calendarProvider = 'ics';
    } else {
      calendarProvider = 'url';
    }

    const calendarMode: 'url' | 'ics' = calendarProvider === 'ics' ? 'ics' : 'url';
    const calendarUrlValue =
      typeof calendar.url === 'string'
        ? calendar.url
        : typeof calendar.icsUrl === 'string'
        ? calendar.icsUrl
        : '';

    const sectionsArray = Array.isArray(rotating.sections) ? rotating.sections : [];
    const allowedSections = new Set<RotatingPanelSectionKey>(
      ROTATING_PANEL_SECTION_OPTIONS.map((option) => option.key),
    );
    const sectionSet = new Set<RotatingPanelSectionKey>();
    sectionsArray.forEach((value) => {
      if (allowedSections.has(value as RotatingPanelSectionKey)) {
        sectionSet.add(value as RotatingPanelSectionKey);
      }
    });
    const hasCustomSections = sectionSet.size > 0;

    return {
      aemetApiKey: typeof aemet.apiKey === 'string' ? aemet.apiKey : '',
      aemetMunicipioId: typeof aemet.municipioId === 'string' ? aemet.municipioId : '',
      weatherCity: typeof weather.city === 'string' ? weather.city : '',
      weatherUnits: weather.units === 'imperial' ? 'imperial' : 'metric',
      calendarEnabled: Boolean(calendar.enabled ?? calendarProvider !== 'none'),
      calendarProvider,
      calendarMode,
      calendarUrl: calendarUrlValue,
      calendarMaxEvents:
        typeof calendar.maxEvents === 'number' ? String(calendar.maxEvents) : DEFAULT_FORM.calendarMaxEvents,
      calendarNotifyMinutesBefore:
        typeof calendar.notifyMinutesBefore === 'number'
          ? String(calendar.notifyMinutesBefore)
          : DEFAULT_FORM.calendarNotifyMinutesBefore,
      googleCalendarId:
        typeof (calendar.google as Record<string, any> | undefined)?.calendarId === 'string'
          ? (calendar.google as Record<string, any>).calendarId
          : DEFAULT_FORM.googleCalendarId,
      backgroundMode: background.mode === 'weather' ? 'weather' : 'daily',
      backgroundIntervalMinutes:
        typeof background.intervalMinutes === 'number'
          ? String(background.intervalMinutes)
          : DEFAULT_FORM.backgroundIntervalMinutes,
      backgroundRetainDays:
        typeof background.retainDays === 'number'
          ? String(background.retainDays)
          : DEFAULT_FORM.backgroundRetainDays,
      rotatingPanelEnabled:
        typeof rotating.enabled === 'boolean'
          ? rotating.enabled
          : DEFAULT_FORM.rotatingPanelEnabled,
      rotatingPanelIntervalSeconds:
        typeof rotating.intervalSeconds === 'number'
          ? String(rotating.intervalSeconds)
          : DEFAULT_FORM.rotatingPanelIntervalSeconds,
      rotatingPanelSections: ROTATING_PANEL_SECTION_OPTIONS.reduce(
        (acc, option) => ({
          ...acc,
          [option.key]: hasCustomSections
            ? sectionSet.has(option.key)
            : DEFAULT_FORM.rotatingPanelSections[option.key],
        }),
        {} as Record<RotatingPanelSectionKey, boolean>,
      ),
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [configData, wifiData, calendarData] = await Promise.all([
        fetchConfigEnvelope(),
        fetchWifiStatus().catch(() => null),
        fetchCalendarStatus().catch(() => null),
      ]);
      setEnvelope(configData);
      setForm(buildFormFromConfig((configData.config as Record<string, any>) ?? null));
      if (wifiData) setWifiStatus(wifiData);
      if (calendarData) setCalendarStatus(calendarData as CalendarStatus);
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

  const refreshCalendarState = useCallback(async () => {
    try {
      const [configData, status] = await Promise.all([fetchConfigEnvelope(), fetchCalendarStatus()]);
      setEnvelope(configData);
      setForm(buildFormFromConfig((configData.config as Record<string, any>) ?? null));
      setCalendarStatus(status);
      await refreshConfig();
    } catch (error) {
      console.error('No se pudo refrescar estado de calendario', error);
    }
  }, [buildFormFromConfig, refreshConfig]);

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

  useEffect(() => {
    if (form.calendarProvider !== 'google' || !form.calendarEnabled) {
      if (googleStatusTimerRef.current) {
        window.clearInterval(googleStatusTimerRef.current);
        googleStatusTimerRef.current = null;
      }
      setGoogleStatus((prev) => (prev && prev.authorized ? prev : null));
      setGoogleDeviceInfo(null);
      setGoogleCalendars([]);
      setGoogleCalendarsLoading(false);
      setGoogleActionError(null);
      return;
    }

    let cancelled = false;

    const pollStatus = async () => {
      try {
        const status = await fetchGoogleDeviceStatus();
        if (cancelled) return;
        setGoogleStatus(status);
        if (status.authorized) {
          setGoogleDeviceInfo(null);
        }
      } catch (error) {
        if (cancelled) return;
        console.warn('No se pudo obtener estado de Google Calendar', error);
      }
    };

    void pollStatus();
    googleStatusTimerRef.current = window.setInterval(pollStatus, 3000);

    return () => {
      cancelled = true;
      if (googleStatusTimerRef.current) {
        window.clearInterval(googleStatusTimerRef.current);
        googleStatusTimerRef.current = null;
      }
    };
  }, [form.calendarProvider, form.calendarEnabled]);

  useEffect(() => {
    if (form.calendarProvider !== 'google') {
      return;
    }
    if (!googleStatus?.authorized) {
      setGoogleCalendars([]);
      setGoogleCalendarsLoading(false);
      return;
    }
    if (googleCalendarsLoading || googleCalendars.length > 0) {
      return;
    }
    let cancelled = false;
    setGoogleCalendarsLoading(true);
    setGoogleActionError(null);
    void fetchGoogleCalendars()
      .then((items) => {
        if (cancelled) return;
        setGoogleCalendars(items);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('No se pudieron listar calendarios de Google', error);
        setGoogleActionError(
          error instanceof Error ? error.message : 'No se pudo listar los calendarios de Google',
        );
      })
      .finally(() => {
        if (cancelled) return;
        setGoogleCalendarsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [form.calendarProvider, googleStatus?.authorized, googleCalendars.length, googleCalendarsLoading]);

  const handleFormChange = <T extends keyof FormState>(key: T, value: FormState[T]) => {
    setForm((prev) => {
      if (key === 'calendarEnabled') {
        const enabled = Boolean(value);
        if (!enabled) {
          return { ...prev, calendarEnabled: false, calendarProvider: 'none' };
        }
        const nextProvider = prev.calendarProvider === 'none' ? 'url' : prev.calendarProvider;
        return {
          ...prev,
          calendarEnabled: true,
          calendarProvider: nextProvider,
          calendarMode: nextProvider === 'ics' ? 'ics' : 'url',
        };
      }
      if (key === 'googleCalendarId') {
        return { ...prev, googleCalendarId: value as string };
      }
      return { ...prev, [key]: value };
    });
  };

  const handleCalendarProviderChange = (provider: FormState['calendarProvider']) => {
    setForm((prev) => {
      const wasGoogle = prev.calendarProvider === 'google';
      const next: FormState = {
        ...prev,
        calendarProvider: provider,
        calendarEnabled: provider === 'none' ? false : true,
        calendarMode: provider === 'ics' ? 'ics' : 'url',
      };
      if (wasGoogle && provider !== 'google') {
        setGoogleDeviceInfo(null);
        setGoogleStatus(null);
        setGoogleCalendars([]);
        setGoogleActionError(null);
        void cancelGoogleDeviceFlow().catch(() => undefined);
      }
      if (provider === 'google' && !next.calendarEnabled) {
        next.calendarEnabled = true;
      }
      return next;
    });
  };

  const handleGoogleStart = async () => {
    setGoogleActionError(null);
    try {
      const response = await startGoogleDeviceFlow();
      setGoogleCalendars([]);
      setGoogleCalendarsLoading(false);
      setGoogleDeviceInfo(response);
      setGoogleStatus((prev) => ({
        ...(prev ?? {}),
        authorized: false,
        needs_action: true,
        user_code: response.user_code,
        verification_url: response.verification_url,
      }));
    } catch (error) {
      console.error('No se pudo iniciar la autorización de Google', error);
      setGoogleActionError(
        error instanceof Error ? error.message : 'No se pudo iniciar la autorización con Google',
      );
    }
  };

  const handleGoogleCancel = async () => {
    setGoogleActionError(null);
    try {
      await cancelGoogleDeviceFlow();
      setGoogleDeviceInfo(null);
      setGoogleCalendars([]);
      setGoogleCalendarsLoading(false);
      setGoogleStatus((prev) =>
        prev
          ? {
              ...prev,
              needs_action: false,
              user_code: undefined,
              verification_url: undefined,
            }
          : prev,
      );
    } catch (error) {
      console.error('No se pudo cancelar la autorización de Google', error);
      setGoogleActionError(
        error instanceof Error ? error.message : 'No se pudo cancelar la autorización con Google',
      );
    }
  };

  const handleRotatingSectionToggle = (section: RotatingPanelSectionKey, value: boolean) => {
    setForm((prev) => ({
      ...prev,
      rotatingPanelSections: { ...prev.rotatingPanelSections, [section]: value },
    }));
  };

  const validateCalendarFile = (file: File): string | null => {
    if (!file) return 'Selecciona un archivo .ics';
    const hasValidExtension = file.name.toLowerCase().endsWith('.ics');
    const hasValidType = !file.type || ACCEPTED_CALENDAR_TYPES.includes(file.type);
    if (!hasValidExtension && !hasValidType) {
      return 'Formato no válido. Usa un archivo .ics';
    }
    if (file.size === 0) {
      return 'El archivo está vacío';
    }
    if (file.size > MAX_CALENDAR_FILE_BYTES) {
      return 'El archivo supera el límite de 5 MB';
    }
    return null;
  };

  const handleCalendarFileUpload = useCallback(
    async (file: File) => {
      if (form.calendarProvider !== 'ics') {
        setCalendarUploadState('error');
        setCalendarUploadMessage('Selecciona el proveedor "Archivo ICS" para cargar un archivo.');
        return;
      }
      const validationError = validateCalendarFile(file);
      if (validationError) {
        setCalendarUploadState('error');
        setCalendarUploadMessage(validationError);
        return;
      }

      setCalendarUploadState('uploading');
      setCalendarUploadProgress(0);
      setCalendarUploadMessage(null);

      try {
        const response = await uploadCalendarFile(file, (percent) => {
          if (typeof percent === 'number' && !Number.isNaN(percent)) {
            setCalendarUploadProgress(percent);
          }
        });
        setCalendarUploadState('success');
        setCalendarUploadMessage(response.message ?? 'Archivo ICS actualizado');
        setCalendarStatus(response);
        await refreshCalendarState();
      } catch (error) {
        console.error('No se pudo subir el calendario', error);
        setCalendarUploadState('error');
        setCalendarUploadMessage(
          error instanceof Error ? error.message : 'No se pudo subir el archivo .ics',
        );
      } finally {
        setCalendarUploadProgress(0);
      }
    },
    [form.calendarProvider, refreshCalendarState],
  );

  const handleCalendarFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      void handleCalendarFileUpload(file);
    }
    event.target.value = '';
  };

  const handleCalendarSelectClick = () => {
    if (calendarUploading) return;
    fileInputRef.current?.click();
  };

  const handleCalendarDownload = async () => {
    try {
      const response = await fetch('/api/calendar/download');
      if (!response.ok) {
        let message: string | undefined;
        try {
          const payload = await response.json();
          message = payload?.detail || payload?.message;
        } catch (error) {
          // ignore parse errors
        }
        throw new Error(message || `Error ${response.status}`);
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'calendar.ics';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('No se pudo descargar calendario', error);
      setCalendarUploadState('error');
      setCalendarUploadMessage(
        error instanceof Error ? error.message : 'No se pudo descargar el archivo',
      );
    }
  };

  const handleCalendarDelete = async () => {
    if (calendarDeleting || calendarUploading) return;
    if (!window.confirm('¿Eliminar el archivo .ics actual?')) return;
    setCalendarDeleting(true);
    setCalendarUploadMessage(null);
    try {
      const response = await deleteCalendarFile();
      setCalendarUploadState('success');
      setCalendarUploadMessage(response.message ?? 'Archivo ICS eliminado');
      setCalendarStatus(response);
      await refreshCalendarState();
    } catch (error) {
      console.error('No se pudo eliminar calendario', error);
      setCalendarUploadState('error');
      setCalendarUploadMessage(
        error instanceof Error ? error.message : 'No se pudo eliminar el archivo .ics',
      );
    } finally {
      setCalendarDeleting(false);
    }
  };

  const handleCalendarDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!calendarUploading) {
      setCalendarDragActive(true);
    }
  };

  const handleCalendarDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setCalendarDragActive(false);
  };

  const handleCalendarDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setCalendarDragActive(false);
    if (calendarUploading) return;
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      void handleCalendarFileUpload(file);
    }
  };

  const parseInteger = (value: string) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  const clampNumber = (value: number | undefined, min: number, max: number) => {
    if (typeof value !== 'number') return undefined;
    return Math.min(Math.max(value, min), max);
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
        provider: form.calendarEnabled ? form.calendarProvider : 'none',
        mode: form.calendarMode,
        url: form.calendarProvider === 'url' ? (form.calendarUrl ? form.calendarUrl : null) : null,
        google:
          form.calendarProvider === 'google'
            ? { calendarId: form.googleCalendarId || 'primary' }
            : undefined,
        maxEvents: parseInteger(form.calendarMaxEvents),
        notifyMinutesBefore: parseInteger(form.calendarNotifyMinutesBefore),
      },
      background: {
        mode: form.backgroundMode,
        intervalMinutes: parseInteger(form.backgroundIntervalMinutes),
        retainDays: parseInteger(form.backgroundRetainDays),
      },
    };

    const rotatingInterval = clampNumber(
      parseInteger(form.rotatingPanelIntervalSeconds),
      4,
      30,
    );
    const rotatingSections: RotatingPanelSectionKey[] = ROTATING_PANEL_SECTION_OPTIONS.filter(
      (option) => form.rotatingPanelSections[option.key],
    ).map((option) => option.key);

    const rotatingPanelPatch: {
      enabled: boolean;
      sections: RotatingPanelSectionKey[];
      intervalSeconds?: number;
    } = {
      enabled: form.rotatingPanelEnabled,
      sections: rotatingSections,
    };
    if (typeof rotatingInterval === 'number') {
      rotatingPanelPatch.intervalSeconds = rotatingInterval;
    }

    patch.ui = {
      rotatingPanel: rotatingPanelPatch,
    };

    try {
      const updated = await saveConfigPatch(patch);
      setEnvelope(updated);
      setForm(buildFormFromConfig((updated.config as Record<string, any>) ?? null));
      setNotice({ type: 'success', text: 'Configuración guardada' });
      try {
        const status = await fetchCalendarStatus();
        setCalendarStatus(status);
      } catch (error) {
        console.warn('No se pudo refrescar estado del calendario tras guardar', error);
      }
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
                  <label className="block text-xs uppercase tracking-wide text-white/50">Calendario</label>
                  <div className="mt-2 grid gap-3 md:grid-cols-2">
                    <div>
                      <span className="block text-xs uppercase tracking-wide text-white/50">Proveedor</span>
                      <select
                        className="mt-1 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none"
                        value={form.calendarProvider}
                        onChange={(event) =>
                          handleCalendarProviderChange(event.target.value as FormState['calendarProvider'])
                        }
                      >
                        <option value="none">Ninguno</option>
                        <option value="url">ICS URL</option>
                        <option value="ics">Archivo ICS</option>
                        <option value="google">Google</option>
                      </select>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-white/70">
                      <input
                        type="checkbox"
                        checked={form.calendarEnabled}
                        onChange={(event) => handleFormChange('calendarEnabled', event.target.checked)}
                        className="h-4 w-4 rounded border-white/30 bg-white/10 text-emerald-400 focus:ring-emerald-400"
                        disabled={form.calendarProvider === 'none'}
                      />
                      Calendario activo
                    </label>
                  </div>
                  {form.calendarProvider === 'url' ? (
                    <div className="mt-3 space-y-2">
                      <input
                        type="url"
                        className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-white/40 focus:outline-none"
                        placeholder="https://calendar.google.com/.../basic.ics"
                        value={form.calendarUrl}
                        onChange={(event) => handleFormChange('calendarUrl', event.target.value)}
                      />
                      <p className="text-xs text-white/45">
                        Introduce la dirección ICS de tu calendario remoto. Se conserva aunque uses un archivo local.
                      </p>
                    </div>
                  ) : null}
                  {form.calendarProvider === 'ics' ? (
                    <div className="mt-3 space-y-3">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".ics,text/calendar"
                        className="hidden"
                        onChange={handleCalendarFileChange}
                      />
                      <div
                        onDragOver={handleCalendarDragOver}
                        onDragEnter={handleCalendarDragOver}
                        onDragLeave={handleCalendarDragLeave}
                        onDrop={handleCalendarDrop}
                        className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-sm transition ${
                          calendarDragActive ? 'border-emerald-400 bg-emerald-500/10' : 'border-white/25 bg-white/5'
                        }`}
                      >
                        <p className="text-white/85">Suelta aquí tu archivo .ics</p>
                        <p className="mt-1 text-xs text-white/55">Tamaño máximo: 5 MB</p>
                        <button
                          type="button"
                          onClick={handleCalendarSelectClick}
                          className="mt-3 rounded-md bg-emerald-500/80 px-3 py-2 text-xs font-medium text-white shadow-md transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={calendarUploading}
                        >
                          Seleccionar archivo .ics
                        </button>
                      </div>
                      {calendarUploadState === 'uploading' ? (
                        <div className="h-2 w-full rounded-full bg-white/10">
                          <div
                            className="h-full rounded-full bg-emerald-400 transition-all"
                            style={{ width: `${Math.min(100, Math.round(calendarUploadProgress))}%` }}
                          />
                        </div>
                      ) : null}
                      {calendarUploadState !== 'idle' && calendarUploadMessage ? (
                        <div
                          className={`rounded-md border px-3 py-2 text-xs ${
                            calendarUploadState === 'error'
                              ? 'border-red-400/40 bg-red-500/15 text-red-100'
                              : 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100'
                          }`}
                        >
                          {calendarUploadMessage}
                        </div>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-3 text-xs text-white/70">
                        <button
                          type="button"
                          onClick={handleCalendarDownload}
                          className="rounded-md border border-white/20 px-3 py-2 transition hover:border-white/40 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={!calendarStatus?.exists || calendarUploading}
                        >
                          Descargar ICS actual
                        </button>
                        <button
                          type="button"
                          onClick={handleCalendarDelete}
                          className="rounded-md border border-rose-400/40 px-3 py-2 text-rose-100 transition hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={calendarDeleting || calendarUploading || !calendarStatus?.exists}
                        >
                          {calendarDeleting ? 'Eliminando…' : 'Eliminar archivo'}
                        </button>
                      </div>
                      <div className="space-y-1 text-xs text-white/55">
                        <p>
                          {calendarStatus?.exists
                            ? `Última carga: ${calendarFileDetails.updated ?? 'desconocida'}${
                                calendarFileDetails.size ? ` • ${calendarFileDetails.size}` : ''
                              }`
                            : 'No hay archivo .ics cargado.'}
                        </p>
                        <p>Ruta: {calendarStatus?.icsPath ?? '/etc/pantalla-dash/calendar/calendar.ics'}</p>
                      </div>
                    </div>
                  ) : null}
                  {form.calendarProvider === 'google' ? (
                    <div className="mt-3 space-y-3">
                      {googleStatus && googleStatus.has_credentials === false ? (
                        <div className="rounded-md border border-amber-400/40 bg-amber-500/15 px-3 py-2 text-xs text-amber-100">
                          Configura <code>client_id</code> y <code>client_secret</code> en /etc/pantalla-dash/secrets.json.
                        </div>
                      ) : null}
                      {googleActionError ? (
                        <div className="rounded-md border border-red-400/40 bg-red-500/15 px-3 py-2 text-xs text-red-100">
                          {googleActionError}
                        </div>
                      ) : null}
                      {googleStatus?.authorized ? (
                        <div className="space-y-3">
                          <p className="text-sm text-white/80">
                            Conectado{googleStatus.email ? ` como ${googleStatus.email}` : ''}.
                          </p>
                          <div>
                            <span className="block text-xs uppercase tracking-wide text-white/50">Calendario</span>
                            <select
                              className="mt-1 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none"
                              value={form.googleCalendarId}
                              onChange={(event) => handleFormChange('googleCalendarId', event.target.value)}
                              disabled={googleCalendarsLoading}
                            >
                              <option value="primary">Principal</option>
                              {googleCalendars
                                .filter((calendar) => calendar.id && calendar.id !== 'primary')
                                .map((calendar) => (
                                  <option key={calendar.id} value={calendar.id}>
                                    {calendar.summary || calendar.id}
                                    {calendar.primary ? ' (Principal)' : ''}
                                  </option>
                                ))}
                            </select>
                            {googleCalendarsLoading ? (
                              <p className="mt-1 text-xs text-white/45">Cargando calendarios…</p>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {googleStatus?.needs_action ? (
                            <div className="space-y-2 rounded-md border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
                              <p>
                                Introduce el código{' '}
                                <span className="font-semibold">
                                  {googleStatus.user_code || googleDeviceInfo?.user_code || '—'}
                                </span>{' '}
                                en{' '}
                                <a
                                  href={googleStatus.verification_url || googleDeviceInfo?.verification_url || 'https://www.google.com/device'}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="underline"
                                >
                                  {googleStatus.verification_url || googleDeviceInfo?.verification_url || 'https://www.google.com/device'}
                                </a>
                              </p>
                              <button
                                type="button"
                                onClick={handleGoogleCancel}
                                className="rounded-md border border-white/25 px-3 py-2 text-xs text-white transition hover:border-white/40 hover:bg-white/10"
                              >
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={handleGoogleStart}
                              className="rounded-md bg-emerald-500/80 px-3 py-2 text-xs font-medium text-white shadow-md transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={googleStatus?.has_credentials === false}
                            >
                              Conectar con Google
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ) : null}
                  {form.calendarProvider === 'none' ? (
                    <p className="mt-3 text-xs text-white/45">Selecciona un proveedor para activar el calendario.</p>
                  ) : null}
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
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

            <GlassPanel className="gap-6">
              <div>
                <h2 className="text-lg font-medium text-white/85">Panel rotativo</h2>
                <p className="text-sm text-white/55">
                  Configura el carrusel que muestra calendario, temporada, previsión semanal y fase lunar bajo el reloj.
                </p>
              </div>

              <div className="flex flex-col gap-5">
                <label className="flex items-center gap-3 text-sm text-white/75">
                  <input
                    type="checkbox"
                    checked={form.rotatingPanelEnabled}
                    onChange={(event) => handleFormChange('rotatingPanelEnabled', event.target.checked)}
                    className="h-4 w-4 rounded border-white/30 bg-white/10 text-emerald-400 focus:ring-emerald-400"
                  />
                  Panel activo
                </label>

                <div>
                  <label className="block text-xs uppercase tracking-wide text-white/50">
                    Intervalo (segundos)
                  </label>
                  <input
                    type="number"
                    min={4}
                    max={30}
                    className="mt-2 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    value={form.rotatingPanelIntervalSeconds}
                    onChange={(event) => handleFormChange('rotatingPanelIntervalSeconds', event.target.value)}
                    disabled={!form.rotatingPanelEnabled}
                  />
                  <p className="mt-1 text-xs text-white/45">Rango permitido: 4-30 segundos.</p>
                </div>

                <div>
                  <span className="block text-xs uppercase tracking-wide text-white/50">Secciones visibles</span>
                  <div className="mt-3 flex flex-col gap-3 md:flex-row md:flex-wrap">
                    {ROTATING_PANEL_SECTION_OPTIONS.map((option) => {
                      const checked = form.rotatingPanelSections[option.key];
                      return (
                        <label
                          key={option.key}
                          className={`flex flex-1 min-w-[220px] cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 transition ${
                            checked
                              ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-50'
                              : 'border-white/15 bg-white/5 text-white/80 hover:border-white/30 hover:bg-white/10'
                          } ${!form.rotatingPanelEnabled ? 'cursor-not-allowed opacity-60 hover:border-white/15 hover:bg-white/5' : ''}`}
                        >
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 rounded border-white/30 bg-white/10 text-emerald-400 focus:ring-emerald-400"
                            checked={checked}
                            onChange={(event) => handleRotatingSectionToggle(option.key, event.target.checked)}
                            disabled={!form.rotatingPanelEnabled}
                          />
                          <span className="flex flex-col">
                            <span className="text-sm font-medium text-white/90">{option.label}</span>
                            <span className="text-xs text-white/55">{option.description}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-xs text-white/50">
                    Las secciones sin datos se ocultarán automáticamente hasta que estén disponibles.
                  </p>
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
