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
  fetchWifiInterfaces,
  saveConfigPatch,
  saveSecretsPatch,
  testBlitzConnection,
  type BlitzortungConfig,
  type ConfigEnvelope,
  type ConfigUpdate,
  type RotatingPanelSectionKey,
  type SideInfoSectionKey,
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
import {
  WifiNotSupportedError,
  connectNetwork,
  fetchWifiStatus,
  scanNetworks,
  type WifiNetwork,
  type WifiStatus,
} from '../services/wifi';
import { useDashboardConfig } from '../context/DashboardConfigContext';
import { useStormStatus } from '../context/StormStatusContext';

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

const SIDE_INFO_SECTION_OPTIONS: Array<{
  key: SideInfoSectionKey;
  label: string;
  description: string;
}> = [
  {
    key: 'efemerides',
    label: 'Efemérides',
    description: 'Muestra la efeméride destacada del día, festivos y el santoral opcional.',
  },
  {
    key: 'news',
    label: 'Noticias',
    description: 'Titulares recientes obtenidos de los feeds RSS configurados.',
  },
];

const SIDE_INFO_MIN_INTERVAL_SECONDS = 5;
const SIDE_INFO_MAX_INTERVAL_SECONDS = 30;
const DEFAULT_NEWS_FEEDS = [
  'https://www.elperiodicomediterraneo.com/rss/section/1002',
  'https://www.xatakaciencia.com/index.xml',
];

const WEEKLY_BACKGROUND_INTERVAL_MINUTES = 7 * 24 * 60;

const WIFI_INPUT_CLASS =
  'mt-2 w-full rounded-lg border border-white/20 bg-white/0 px-3 py-2 text-sm text-white placeholder:text-white/45 backdrop-blur-sm focus:border-white/35 focus:outline-none disabled:cursor-not-allowed disabled:opacity-55';
const WIFI_BUTTON_CLASS =
  'rounded-lg border border-white/30 bg-white/0 px-3 py-2 text-xs font-medium text-white transition hover:border-white/50 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:border-white/30 disabled:hover:bg-transparent';

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
  backgroundMode: 'daily' | 'weekly' | 'weather';
  backgroundIntervalMinutes: string;
  backgroundRetainDays: string;
  rotatingPanelEnabled: boolean;
  rotatingPanelIntervalSeconds: string;
  rotatingPanelSections: Record<RotatingPanelSectionKey, boolean>;
  sideInfoEnabled: boolean;
  sideInfoIntervalSeconds: string;
  sideInfoSections: Record<SideInfoSectionKey, boolean>;
  sideInfoShowSantoral: boolean;
  sideInfoShowHolidays: boolean;
  sideInfoNewsEnabled: boolean;
  sideInfoNewsFeeds: string;
  newsServiceEnabled: boolean;
  uiWifiPreferredInterface: string;
  blitzEnabled: boolean;
  blitzHost: string;
  blitzPort: string;
  blitzTopicBase: string;
  blitzRadiusKm: string;
  blitzTimeWindowMin: string;
  uiAppearanceTransparentCards: boolean;
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
  sideInfoEnabled: true,
  sideInfoIntervalSeconds: '10',
  sideInfoSections: {
    efemerides: true,
    news: true,
  },
  sideInfoShowSantoral: true,
  sideInfoShowHolidays: true,
  sideInfoNewsEnabled: true,
  sideInfoNewsFeeds: DEFAULT_NEWS_FEEDS.join('\n'),
  newsServiceEnabled: true,
  uiWifiPreferredInterface: '',
  blitzEnabled: false,
  blitzHost: '',
  blitzPort: '1883',
  blitzTopicBase: 'blitzortung/',
  blitzRadiusKm: '100',
  blitzTimeWindowMin: '30',
  uiAppearanceTransparentCards: false,
};

const Config = () => {
  const { refresh: refreshConfig } = useDashboardConfig();
  const { status: stormStatus } = useStormStatus();
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
  const [availableWifiInterfaces, setAvailableWifiInterfaces] = useState<string[]>([]);
  const [wifiSupported, setWifiSupported] = useState(true);
  const [wifiUnsupportedMessage, setWifiUnsupportedMessage] = useState<string | null>(null);
  const [blitzTestNotice, setBlitzTestNotice] = useState<Notice | null>(null);
  const [testingBlitz, setTestingBlitz] = useState(false);
  const [openAiInput, setOpenAiInput] = useState('');
  const [googleClientIdInput, setGoogleClientIdInput] = useState('');
  const [googleClientSecretInput, setGoogleClientSecretInput] = useState('');
  const [savingOpenAiSecret, setSavingOpenAiSecret] = useState(false);
  const [savingGoogleSecrets, setSavingGoogleSecrets] = useState(false);
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

  const blitzLastEventFormatted = useMemo(() => {
    if (!stormStatus?.blitzLastTimestamp) {
      return null;
    }
    const timestamp = Date.parse(stormStatus.blitzLastTimestamp);
    if (Number.isNaN(timestamp)) {
      return null;
    }
    return new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' }).format(timestamp);
  }, [stormStatus?.blitzLastTimestamp]);

  const blitzSource = stormStatus?.blitzSource ?? null;

  const blitzStatus = useMemo(() => {
    if (!stormStatus || stormStatus.provider !== 'blitzortung') {
      return null;
    }
    return stormStatus;
  }, [stormStatus]);

  const blitzSummary = useMemo(() => {
    if (!blitzStatus) return null;
    const pieces: string[] = [];
    if (typeof blitzStatus.blitzCountRecent === 'number') {
      const windowMinutes = blitzStatus.blitzTimeWindowMin ?? Number.parseInt(form.blitzTimeWindowMin, 10) || 30;
      pieces.push(`Eventos recientes: ${blitzStatus.blitzCountRecent} / ${windowMinutes} min`);
    }
    if (typeof blitzStatus.blitzNearestDistanceKm === 'number') {
      pieces.push(`Distancia mínima: ${blitzStatus.blitzNearestDistanceKm.toFixed(1)} km`);
    }
    if (typeof blitzStatus.blitzAzimuthDeg === 'number') {
      pieces.push(`Azimut: ${Math.round(blitzStatus.blitzAzimuthDeg)}°`);
    }
    if (blitzLastEventFormatted) {
      pieces.push(`Último evento ${blitzLastEventFormatted}`);
    }
    return pieces.length > 0 ? pieces.join(' • ') : null;
  }, [blitzStatus, blitzLastEventFormatted, form.blitzTimeWindowMin]);

  const blitzStatusTone = useMemo(() => {
    if (!form.blitzEnabled) return '';
    if (blitzSource === 'disabled') {
      return 'border-white/20 text-white/75';
    }
    if (blitzStatus?.blitzConnected) {
      return 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100';
    }
    return 'border-amber-400/40 bg-amber-500/10 text-amber-100';
  }, [blitzSource, blitzStatus?.blitzConnected, form.blitzEnabled]);

  const openAiDetails = useMemo(() => {
    const secrets = (envelope?.secrets ?? {}) as Record<string, any>;
    const openai = secrets?.openai as { hasKey?: boolean; masked?: string | null } | undefined;
    return {
      hasKey: Boolean(openai?.hasKey),
      masked: typeof openai?.masked === 'string' ? openai.masked : null,
    };
  }, [envelope?.secrets]);

  const googleSecretDetails = useMemo(() => {
    const secrets = (envelope?.secrets ?? {}) as Record<string, any>;
    const google = secrets?.google as
      | { hasCredentials?: boolean; hasRefreshToken?: boolean }
      | undefined;
    return {
      hasCredentials: Boolean(google?.hasCredentials),
      hasRefreshToken: Boolean(google?.hasRefreshToken),
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
    const uiWifi = (ui.wifi as Record<string, any> | undefined) ?? {};
    const uiBlitz = (ui.blitzortung as Record<string, any> | undefined) ?? {};
    const rootBlitz = (configData.blitzortung as Record<string, any> | undefined) ?? {};
    const blitzSource = Object.keys(rootBlitz).length > 0 ? rootBlitz : uiBlitz;
    const uiAppearance = (ui.appearance as Record<string, any> | undefined) ?? {};

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

    const sideInfo = (ui.sideInfo as Record<string, any> | undefined) ?? {};
    const sideInfoNews = (sideInfo.news as Record<string, any> | undefined) ?? {};
    const newsConfig = (configData.news as Record<string, any> | undefined) ?? {};

    const sideSectionsArray = Array.isArray(sideInfo.sections) ? sideInfo.sections : [];
    const allowedSideSections = new Set<SideInfoSectionKey>(
      SIDE_INFO_SECTION_OPTIONS.map((option) => option.key),
    );
    const sideSectionSet = new Set<SideInfoSectionKey>();
    sideSectionsArray.forEach((value) => {
      if (allowedSideSections.has(value as SideInfoSectionKey)) {
        sideSectionSet.add(value as SideInfoSectionKey);
      }
    });
    const hasCustomSideSections = sideSectionSet.size > 0;

    const newsFeedsList = Array.isArray(newsConfig.feeds)
      ? newsConfig.feeds
          .map((item) => (typeof item === 'string' ? item.trim() : ''))
          .filter((item) => item.length > 0)
      : [];
    const hasFeedsField =
      newsConfig && typeof newsConfig === 'object' && Object.prototype.hasOwnProperty.call(newsConfig, 'feeds');

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
      backgroundMode:
        background.mode === 'weather'
          ? 'weather'
          : background.mode === 'weekly'
          ? 'weekly'
          : 'daily',
      backgroundIntervalMinutes:
        background.mode === 'weekly'
          ? DEFAULT_FORM.backgroundIntervalMinutes
          : typeof background.intervalMinutes === 'number'
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
      sideInfoEnabled:
        typeof sideInfo.enabled === 'boolean' ? sideInfo.enabled : DEFAULT_FORM.sideInfoEnabled,
      sideInfoIntervalSeconds:
        typeof sideInfo.intervalSeconds === 'number'
          ? String(sideInfo.intervalSeconds)
          : DEFAULT_FORM.sideInfoIntervalSeconds,
      sideInfoSections: SIDE_INFO_SECTION_OPTIONS.reduce(
        (acc, option) => ({
          ...acc,
          [option.key]: hasCustomSideSections
            ? sideSectionSet.has(option.key)
            : DEFAULT_FORM.sideInfoSections[option.key],
        }),
        {} as Record<SideInfoSectionKey, boolean>,
      ),
      sideInfoShowSantoral:
        typeof sideInfo.showSantoralWithEfemerides === 'boolean'
          ? sideInfo.showSantoralWithEfemerides
          : DEFAULT_FORM.sideInfoShowSantoral,
      sideInfoShowHolidays:
        typeof sideInfo.showHolidaysWithEfemerides === 'boolean'
          ? sideInfo.showHolidaysWithEfemerides
          : DEFAULT_FORM.sideInfoShowHolidays,
      sideInfoNewsEnabled:
        typeof sideInfoNews.enabled === 'boolean'
          ? sideInfoNews.enabled
          : DEFAULT_FORM.sideInfoNewsEnabled,
      sideInfoNewsFeeds:
        newsFeedsList.length > 0
          ? newsFeedsList.join('\n')
          : hasFeedsField
          ? ''
          : DEFAULT_FORM.sideInfoNewsFeeds,
      newsServiceEnabled:
        typeof newsConfig.enabled === 'boolean'
          ? newsConfig.enabled
          : DEFAULT_FORM.newsServiceEnabled,
      uiWifiPreferredInterface:
        typeof uiWifi.preferredInterface === 'string' && uiWifi.preferredInterface
          ? uiWifi.preferredInterface
          : typeof (configData.wifi as Record<string, any> | undefined)?.preferredInterface === 'string'
          ? (configData.wifi as Record<string, any>).preferredInterface
          : DEFAULT_FORM.uiWifiPreferredInterface,
      blitzEnabled: Boolean(blitzSource.enabled),
      blitzHost: typeof blitzSource.mqtt_host === 'string' ? blitzSource.mqtt_host : DEFAULT_FORM.blitzHost,
      blitzPort:
        typeof blitzSource.mqtt_port === 'number' && Number.isFinite(blitzSource.mqtt_port)
          ? String(blitzSource.mqtt_port)
          : DEFAULT_FORM.blitzPort,
      blitzTopicBase:
        typeof blitzSource.topic_base === 'string' && blitzSource.topic_base
          ? blitzSource.topic_base
          : DEFAULT_FORM.blitzTopicBase,
      blitzRadiusKm:
        typeof blitzSource.radius_km === 'number' && Number.isFinite(blitzSource.radius_km)
          ? String(blitzSource.radius_km)
          : DEFAULT_FORM.blitzRadiusKm,
      blitzTimeWindowMin:
        typeof blitzSource.time_window_min === 'number' && Number.isFinite(blitzSource.time_window_min)
          ? String(blitzSource.time_window_min)
          : DEFAULT_FORM.blitzTimeWindowMin,
      uiAppearanceTransparentCards:
        typeof uiAppearance.transparentCards === 'boolean'
          ? uiAppearance.transparentCards
          : DEFAULT_FORM.uiAppearanceTransparentCards,
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const configData = await fetchConfigEnvelope();
      setEnvelope(configData);
      setForm(buildFormFromConfig((configData.config as Record<string, any>) ?? null));

      let wifiResult: { status: WifiStatus | null; supported: boolean; message: string | null } = {
        status: null,
        supported: true,
        message: null,
      };
      try {
        const status = await fetchWifiStatus();
        wifiResult = { status, supported: true, message: null };
      } catch (error) {
        if (error instanceof WifiNotSupportedError) {
          wifiResult = { status: null, supported: false, message: error.message };
        } else {
          console.warn('No se pudo obtener estado Wi-Fi', error);
          wifiResult = {
            status: null,
            supported: true,
            message: error instanceof Error ? error.message : 'No se pudo cargar el estado Wi-Fi',
          };
        }
      }

      const calendarData = await fetchCalendarStatus().catch(() => null);
      const interfaces = await fetchWifiInterfaces();
      setAvailableWifiInterfaces(Array.isArray(interfaces) ? interfaces : []);
      setBlitzTestNotice(null);

      if (!wifiResult.supported) {
        setWifiSupported(false);
        setWifiUnsupportedMessage(wifiResult.message ?? 'Wi-Fi no soportado en este dispositivo.');
        setWifiStatus(null);
        setWifiNetworks([]);
        setWifiRaw('');
        setWifiNotice({
          type: 'info',
          text: wifiResult.message ?? 'Este dispositivo no dispone de interfaz Wi-Fi compatible.',
        });
      } else {
        setWifiSupported(true);
        setWifiUnsupportedMessage(null);
        setWifiStatus(wifiResult.status);
        if (wifiResult.message) {
          setWifiNotice({ type: 'error', text: wifiResult.message });
        } else {
          setWifiNotice(null);
        }
      }

      if (calendarData) {
        setCalendarStatus(calendarData as CalendarStatus);
      } else {
        setCalendarStatus(null);
      }

      setNotice(null);
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
    setBlitzTestNotice(null);
  }, [
    form.blitzEnabled,
    form.blitzHost,
    form.blitzPort,
    form.blitzTopicBase,
    form.blitzRadiusKm,
    form.blitzTimeWindowMin,
  ]);

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

  const handleSideInfoSectionToggle = (section: SideInfoSectionKey, value: boolean) => {
    setForm((prev) => ({
      ...prev,
      sideInfoSections: { ...prev.sideInfoSections, [section]: value },
    }));
  };

  const handleSideInfoNewsToggle = (value: boolean) => {
    setForm((prev) => ({
      ...prev,
      sideInfoNewsEnabled: value,
      newsServiceEnabled: value,
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

  const buildBlitzPayload = (): BlitzortungConfig => {
    const trimmedHost = form.blitzHost.trim();
    const parsedPort = Number.parseInt(form.blitzPort, 10);
    const portValue =
      Number.isFinite(parsedPort) && parsedPort >= 1 && parsedPort <= 65535
        ? parsedPort
        : Number.parseInt(DEFAULT_FORM.blitzPort, 10);

    const rawTopic = form.blitzTopicBase.trim() || DEFAULT_FORM.blitzTopicBase;
    const cleanedTopic = rawTopic
      .replace(/#+/g, '')
      .replace(/^\/+/, '')
      .replace(/\s+/g, '')
      .replace(/\/+$/, '');
    const topicBase = cleanedTopic ? `${cleanedTopic}/` : DEFAULT_FORM.blitzTopicBase;

    const parsedRadius = Number.parseInt(form.blitzRadiusKm, 10);
    const radiusValue =
      Number.isFinite(parsedRadius) && parsedRadius >= 0
        ? Math.min(Math.max(parsedRadius, 0), 2000)
        : Number.parseInt(DEFAULT_FORM.blitzRadiusKm, 10);

    const parsedWindow = Number.parseInt(form.blitzTimeWindowMin, 10);
    const windowValue =
      Number.isFinite(parsedWindow) && parsedWindow >= 1
        ? Math.min(Math.max(parsedWindow, 1), 360)
        : Number.parseInt(DEFAULT_FORM.blitzTimeWindowMin, 10);

    return {
      enabled: form.blitzEnabled,
      mqtt_host: trimmedHost || null,
      mqtt_port: portValue,
      topic_base: topicBase,
      radius_km: radiusValue,
      time_window_min: windowValue,
    };
  };

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    setNotice(null);

    const feedList = Array.from(
      new Set(
        form.sideInfoNewsFeeds
          .split(/\r?\n/)
          .map((value) => value.trim())
          .filter((value) => value.length > 0),
      ),
    );

    const invalidFeed = feedList.find((feed) => {
      try {
        const url = new URL(feed);
        return !(url.protocol === 'http:' || url.protocol === 'https:');
      } catch (error) {
        return true;
      }
    });

    if (invalidFeed) {
      setNotice({
        type: 'error',
        text: `Feed RSS inválido: ${invalidFeed}`,
      });
      setSavingConfig(false);
      return;
    }

    if (form.blitzEnabled) {
      const host = form.blitzHost.trim();
      const topic = form.blitzTopicBase.trim();
      const port = Number.parseInt(form.blitzPort, 10);
      const radiusValue = Number.parseInt(form.blitzRadiusKm, 10);
      const windowValue = Number.parseInt(form.blitzTimeWindowMin, 10);

      if (!host) {
        setNotice({ type: 'error', text: 'Introduce un host para el broker MQTT de Blitzortung.' });
        setSavingConfig(false);
        return;
      }
      if (!topic) {
        setNotice({ type: 'error', text: 'Introduce un prefijo base para el tópico MQTT.' });
        setSavingConfig(false);
        return;
      }
      if (!Number.isFinite(port) || port < 1 || port > 65535) {
        setNotice({ type: 'error', text: 'El puerto MQTT debe estar entre 1 y 65535.' });
        setSavingConfig(false);
        return;
      }
      if (Number.isNaN(radiusValue) || radiusValue < 0) {
        setNotice({ type: 'error', text: 'El radio debe ser un número mayor o igual que 0.' });
        setSavingConfig(false);
        return;
      }
      if (Number.isNaN(windowValue) || windowValue < 1) {
        setNotice({ type: 'error', text: 'La ventana temporal debe ser un número mayor o igual que 1.' });
        setSavingConfig(false);
        return;
      }
    }

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
        intervalMinutes:
          form.backgroundMode === 'weekly'
            ? WEEKLY_BACKGROUND_INTERVAL_MINUTES
            : parseInteger(form.backgroundIntervalMinutes),
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

    const sideInfoSectionsSelected: SideInfoSectionKey[] = SIDE_INFO_SECTION_OPTIONS.filter(
      (option) => form.sideInfoSections[option.key],
    ).map((option) => option.key);
    if (sideInfoSectionsSelected.length === 0) {
      sideInfoSectionsSelected.push('efemerides');
    }

    const sideInterval = clampNumber(
      parseInteger(form.sideInfoIntervalSeconds),
      SIDE_INFO_MIN_INTERVAL_SECONDS,
      SIDE_INFO_MAX_INTERVAL_SECONDS,
    );

    const sideInfoPatch: {
      enabled: boolean;
      sections: SideInfoSectionKey[];
      intervalSeconds?: number;
      showSantoralWithEfemerides: boolean;
      showHolidaysWithEfemerides: boolean;
      news: { enabled: boolean };
    } = {
      enabled: form.sideInfoEnabled,
      sections: sideInfoSectionsSelected,
      showSantoralWithEfemerides: form.sideInfoShowSantoral,
      showHolidaysWithEfemerides: form.sideInfoShowHolidays,
      news: { enabled: form.sideInfoNewsEnabled },
    };
    if (typeof sideInterval === 'number') {
      sideInfoPatch.intervalSeconds = sideInterval;
    }

    const blitzPatch = buildBlitzPayload();
    const appearancePatch = { transparentCards: form.uiAppearanceTransparentCards };

    patch.blitzortung = blitzPatch;

    patch.ui = {
      rotatingPanel: rotatingPanelPatch,
      sideInfo: sideInfoPatch,
      wifi: {
        preferredInterface: form.uiWifiPreferredInterface.trim(),
      },
      blitzortung: blitzPatch,
      appearance: appearancePatch,
    };

    patch.news = {
      enabled: form.newsServiceEnabled,
      feeds: feedList,
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

  const handleTestBlitzConnection = async () => {
    setTestingBlitz(true);
    setBlitzTestNotice(null);
    try {
      const result = await testBlitzConnection(buildBlitzPayload());
      if (result.ok) {
        setBlitzTestNotice({ type: 'success', text: 'Conexión MQTT verificada correctamente.' });
      } else {
        setBlitzTestNotice({
          type: 'error',
          text: result.reason ?? 'No se pudo conectar con el relay MQTT.',
        });
      }
    } catch (error) {
      setBlitzTestNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'No se pudo probar la conexión',
      });
    } finally {
      setTestingBlitz(false);
    }
  };

  const handleResetForm = () => {
    if (!envelope?.config) return;
    setForm(buildFormFromConfig(envelope.config as Record<string, any>));
    setNotice(null);
    setBlitzTestNotice(null);
  };

  const handleSaveOpenAiSecret = async () => {
    setSavingOpenAiSecret(true);
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
      setSavingOpenAiSecret(false);
      try {
        await refreshConfig();
      } catch (error) {
        console.warn('No se pudo refrescar config tras guardar secreto', error);
      }
    }
  };

  const handleSaveGoogleSecrets = async (mode: 'update' | 'clear') => {
    if (mode === 'update' && !googleClientIdInput.trim() && !googleClientSecretInput.trim()) {
      setNotice({ type: 'error', text: 'Introduce al menos un valor para guardar.' });
      return;
    }
    setSavingGoogleSecrets(true);
    setNotice(null);
    try {
      const payload: { client_id?: string | null; client_secret?: string | null } = {};
      if (mode === 'clear') {
        payload.client_id = null;
        payload.client_secret = null;
      } else {
        if (googleClientIdInput.trim()) {
          payload.client_id = googleClientIdInput.trim();
        }
        if (googleClientSecretInput.trim()) {
          payload.client_secret = googleClientSecretInput.trim();
        }
      }
      const updated = await saveSecretsPatch({ google: payload });
      setEnvelope(updated);
      setGoogleClientIdInput('');
      setGoogleClientSecretInput('');
      setNotice({
        type: 'success',
        text:
          mode === 'clear'
            ? 'Credenciales de Google eliminadas'
            : 'Credenciales de Google actualizadas',
      });
      if (mode === 'clear') {
        try {
          await cancelGoogleDeviceFlow();
          setGoogleStatus(null);
          setGoogleDeviceInfo(null);
        } catch (error) {
          console.warn('No se pudo cancelar el flujo de Google tras limpiar credenciales', error);
        }
      }
    } catch (error) {
      console.error('Error guardando credenciales de Google', error);
      setNotice({
        type: 'error',
        text: error instanceof Error ? error.message : 'No se pudieron guardar las credenciales',
      });
    } finally {
      setSavingGoogleSecrets(false);
      try {
        await refreshConfig();
      } catch (error) {
        console.warn('No se pudo refrescar config tras guardar credenciales', error);
      }
    }
  };

  const handleScanWifi = async () => {
    if (!wifiSupported) {
      setWifiNotice({
        type: 'info',
        text: wifiUnsupportedMessage ?? 'Este dispositivo no dispone de interfaz Wi-Fi compatible.',
      });
      return;
    }
    setScanningWifi(true);
    try {
      const result = await scanNetworks();
      setWifiNetworks(result.networks ?? []);
      setWifiRaw(result.raw ?? '');
      setWifiNotice({ type: 'info', text: `Se encontraron ${result.networks?.length ?? 0} redes` });
    } catch (error) {
      console.error('Error escaneando redes', error);
      if (error instanceof WifiNotSupportedError) {
        setWifiSupported(false);
        setWifiUnsupportedMessage(error.message);
        setWifiNetworks([]);
        setWifiRaw('');
        setWifiNotice({ type: 'info', text: error.message });
      } else {
        setWifiNotice({
          type: 'error',
          text: error instanceof Error ? error.message : 'No se pudo escanear Wi-Fi',
        });
      }
    } finally {
      setScanningWifi(false);
    }
  };

  const handleConnectWifi = async () => {
    if (!wifiSupported) {
      setWifiNotice({
        type: 'info',
        text: wifiUnsupportedMessage ?? 'Este dispositivo no dispone de interfaz Wi-Fi compatible.',
      });
      return;
    }
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
      if (error instanceof WifiNotSupportedError) {
        setWifiSupported(false);
        setWifiUnsupportedMessage(error.message);
        setWifiStatus(null);
        setWifiNotice({ type: 'info', text: error.message });
      } else {
        setWifiNotice({
          type: 'error',
          text: error instanceof Error ? error.message : 'No se pudo conectar a la red',
        });
      }
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
                      onClick={handleSaveOpenAiSecret}
                      className="rounded-lg bg-emerald-500/80 px-3 py-2 text-sm font-medium text-white shadow-md transition hover:bg-emerald-500"
                      disabled={savingOpenAiSecret}
                    >
                      {savingOpenAiSecret ? 'Guardando…' : openAiDetails.hasKey ? 'Actualizar clave' : 'Guardar clave'}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-white/45">
                    Estado: {openAiDetails.hasKey ? 'Configurada' : 'Sin configurar'}
                  </p>
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wide text-white/50">Credenciales Google Calendar</label>
                  <p className="mt-1 text-xs text-white/55">
                    Introduce el <code>client_id</code> y el <code>client_secret</code> del proyecto de Google Cloud para
                    habilitar la sincronización vía OAuth.
                  </p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <input
                      type="text"
                      className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-white/40 focus:outline-none"
                      placeholder={googleSecretDetails.hasCredentials ? 'client_id configurado' : 'client_id.apps.googleusercontent.com'}
                      value={googleClientIdInput}
                      onChange={(event) => setGoogleClientIdInput(event.target.value)}
                    />
                    <input
                      type="password"
                      className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-white/40 focus:outline-none"
                      placeholder={googleSecretDetails.hasCredentials ? 'client_secret configurado' : 'client_secret'}
                      value={googleClientSecretInput}
                      onChange={(event) => setGoogleClientSecretInput(event.target.value)}
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => handleSaveGoogleSecrets('update')}
                      className="rounded-lg bg-emerald-500/80 px-3 py-2 text-sm font-medium text-white shadow-md transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={savingGoogleSecrets}
                    >
                      {savingGoogleSecrets ? 'Guardando…' : googleSecretDetails.hasCredentials ? 'Actualizar credenciales' : 'Guardar credenciales'}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveGoogleSecrets('clear')}
                      className="rounded-lg border border-white/25 px-3 py-2 text-sm font-medium text-white transition hover:border-white/40 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={savingGoogleSecrets || !googleSecretDetails.hasCredentials}
                    >
                      {savingGoogleSecrets ? 'Guardando…' : 'Eliminar credenciales'}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-white/45">
                    Estado: {googleSecretDetails.hasCredentials ? 'Credenciales configuradas' : 'Sin credenciales'}
                    {googleSecretDetails.hasRefreshToken ? ' • Cuenta vinculada' : ''}
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
                          Configura el <code>client_id</code> y el <code>client_secret</code> en la sección «APIs y servicios» para
                          iniciar sesión con Google.
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

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={handleResetForm}
                  className="rounded-lg border border-white/25 px-4 py-2 text-sm font-medium text-white transition hover:border-white/40 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={savingConfig || loading}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSaveConfig}
                  className="rounded-lg bg-white/15 px-4 py-2 text-sm font-medium text-white shadow-md transition hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={savingConfig || loading}
                >
                  {savingConfig ? 'Guardando…' : 'Guardar cambios'}
                </button>
              </div>
            </GlassPanel>

            <GlassPanel className="gap-6">
              <div>
                <h2 className="text-lg font-medium text-white/85">Tormentas (Blitzortung) y apariencia</h2>
                <p className="text-sm text-white/55">
                  Configura el consumidor MQTT y ajusta la transparencia de las tarjetas de la interfaz.
                </p>
              </div>

              <section className="flex flex-col gap-4">
                <label className="flex items-center gap-3 text-sm text-white/75">
                  <input
                    type="checkbox"
                    checked={form.blitzEnabled}
                    onChange={(event) => handleFormChange('blitzEnabled', event.target.checked)}
                    className="h-4 w-4 rounded border-white/30 bg-white/10 text-emerald-400 focus:ring-emerald-400"
                  />
                  Activar ingestión Blitzortung
                </label>

                {form.blitzEnabled ? (
                  <div className={`rounded-lg border px-3 py-2 text-xs ${blitzStatusTone}`}>
                    {blitzSource === 'disabled' ? (
                      <span>
                        El backend aún informa Blitzortung deshabilitado; guarda la configuración y reinicia si el aviso persiste.
                      </span>
                    ) : blitzStatus?.blitzConnected ? (
                      <span>Conectado al broker MQTT externo.</span>
                    ) : (
                      <span>Intentando conectar con el broker configurado…</span>
                    )}
                    {blitzSummary ? (
                      <span className="mt-1 block text-[11px] text-white/80">{blitzSummary}</span>
                    ) : null}
                    {!blitzStatus?.blitzConnected && blitzStatus?.blitzLastError ? (
                      <span className="mt-1 block text-amber-200/80">{blitzStatus.blitzLastError}</span>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-white/55">
                    El consumidor MQTT permanecerá apagado hasta que lo actives.
                  </p>
                )}

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-xs uppercase tracking-wide text-white/50">Host MQTT</label>
                    <input
                      type="text"
                      className="mt-2 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                      value={form.blitzHost}
                      onChange={(event) => handleFormChange('blitzHost', event.target.value)}
                      placeholder="broker.ejemplo.org"
                      disabled={!form.blitzEnabled}
                    />
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-wide text-white/50">Puerto</label>
                    <input
                      type="number"
                      min={1}
                      max={65535}
                      className="mt-2 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                      value={form.blitzPort}
                      onChange={(event) => handleFormChange('blitzPort', event.target.value)}
                      disabled={!form.blitzEnabled}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs uppercase tracking-wide text-white/50">Topic base</label>
                    <input
                      type="text"
                      className="mt-2 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                      value={form.blitzTopicBase}
                      onChange={(event) => handleFormChange('blitzTopicBase', event.target.value)}
                      placeholder="blitzortung/"
                      disabled={!form.blitzEnabled}
                    />
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-wide text-white/50">Radio (km)</label>
                    <input
                      type="number"
                      min={0}
                      max={2000}
                      className="mt-2 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                      value={form.blitzRadiusKm}
                      onChange={(event) => handleFormChange('blitzRadiusKm', event.target.value)}
                      disabled={!form.blitzEnabled}
                    />
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-wide text-white/50">Ventana (min)</label>
                    <input
                      type="number"
                      min={1}
                      max={360}
                      className="mt-2 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                      value={form.blitzTimeWindowMin}
                      onChange={(event) => handleFormChange('blitzTimeWindowMin', event.target.value)}
                      disabled={!form.blitzEnabled}
                    />
                  </div>
                </div>

                {blitzTestNotice ? (
                  <div
                    className={`rounded-lg border px-3 py-2 text-xs ${
                      blitzTestNotice.type === 'success'
                        ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100'
                        : blitzTestNotice.type === 'error'
                        ? 'border-red-400/40 bg-red-500/10 text-red-100'
                        : 'border-sky-400/40 bg-sky-500/10 text-sky-100'
                    }`}
                  >
                    {blitzTestNotice.text}
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleTestBlitzConnection}
                    className="rounded-lg border border-white/20 px-4 py-2 text-sm font-medium text-white transition hover:border-white/35 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!form.blitzEnabled || testingBlitz}
                  >
                    {testingBlitz ? 'Probando…' : 'Probar conexión'}
                  </button>
                </div>
              </section>

              <section className="rounded-xl border border-white/15 px-4 py-3">
                <h3 className="text-sm font-medium text-white/85">Tarjetas de la interfaz</h3>
                <label className="mt-3 flex items-center gap-3 text-sm text-white/75">
                  <input
                    type="checkbox"
                    checked={form.uiAppearanceTransparentCards}
                    onChange={(event) => handleFormChange('uiAppearanceTransparentCards', event.target.checked)}
                    className="h-4 w-4 rounded border-white/30 bg-white/10 text-emerald-400 focus:ring-emerald-400"
                  />
                  Tarjetas 100% transparentes
                </label>
                <p className="mt-1 text-xs text-white/50">
                  Aplica un difuminado muy ligero y elimina el fondo opaco de todas las tarjetas.
                </p>
              </section>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={handleResetForm}
                  className="rounded-lg border border-white/25 px-4 py-2 text-sm font-medium text-white transition hover:border-white/40 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={savingConfig || loading}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSaveConfig}
                  className="rounded-lg bg-white/15 px-4 py-2 text-sm font-medium text-white shadow-md transition hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-50"
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
                      handleFormChange('backgroundMode', event.target.value as FormState['backgroundMode'])
                    }
                  >
                    <option value="daily">Diario</option>
                    <option value="weekly">Semanal</option>
                    <option value="weather">Según clima</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-wide text-white/50">Intervalo (minutos)</label>
                  {form.backgroundMode === 'weekly' ? (
                    <p className="mt-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70">
                      En modo semanal, la app genera un fondo automáticamente cada 7 días. Cambia a «Diario» si quieres
                      ajustar un intervalo en minutos.
                    </p>
                  ) : (
                    <input
                      type="number"
                      min={1}
                      max={240}
                      className="mt-2 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none"
                      value={form.backgroundIntervalMinutes}
                      onChange={(event) => handleFormChange('backgroundIntervalMinutes', event.target.value)}
                    />
                  )}
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
                <div className={wifiSupported ? 'space-y-2 transition-opacity' : 'space-y-2 opacity-60 transition-opacity'}>
                  <label className="block text-xs uppercase tracking-wide text-white/50">
                    Interfaz preferida
                  </label>
                  {availableWifiInterfaces.length > 0 ? (
                    <select
                      className={WIFI_INPUT_CLASS}
                      value={form.uiWifiPreferredInterface}
                      onChange={(event) =>
                        handleFormChange('uiWifiPreferredInterface', event.target.value)
                      }
                      disabled={!wifiSupported}
                    >
                      <option value="">Detección automática</option>
                      {availableWifiInterfaces.map((iface) => (
                        <option key={iface} value={iface}>
                          {iface}
                        </option>
                      ))}
                      {form.uiWifiPreferredInterface &&
                      !availableWifiInterfaces.includes(form.uiWifiPreferredInterface) ? (
                        <option value={form.uiWifiPreferredInterface}>
                          {form.uiWifiPreferredInterface}
                        </option>
                      ) : null}
                    </select>
                  ) : (
                    <input
                      type="text"
                      className={WIFI_INPUT_CLASS}
                      value={form.uiWifiPreferredInterface}
                      onChange={(event) =>
                        handleFormChange('uiWifiPreferredInterface', event.target.value)
                      }
                      placeholder="Auto"
                      disabled={!wifiSupported}
                    />
                  )}
                  <p className="mt-1 text-xs text-white/45">
                    Si se deja vacío se elegirá automáticamente la interfaz más estable.
                  </p>
                </div>
                {wifiNotice ? (
                  <div
                    className={`rounded-lg border px-3 py-2 text-xs backdrop-blur-sm ${
                      wifiNotice.type === 'success'
                        ? 'border-emerald-400/40 bg-emerald-500/5 text-emerald-100'
                        : wifiNotice.type === 'error'
                        ? 'border-red-400/40 bg-red-500/5 text-red-100'
                        : 'border-sky-400/40 bg-sky-500/5 text-sky-100'
                    }`}
                  >
                    {wifiNotice.text}
                  </div>
                ) : null}

                {!wifiSupported ? (
                  <div className="rounded-lg border border-white/15 bg-white/0 px-3 py-2 text-xs text-white/70 backdrop-blur-sm">
                    {wifiUnsupportedMessage ?? 'Este dispositivo no dispone de interfaz Wi-Fi compatible.'}
                  </div>
                ) : null}

                <div className="rounded-2xl border border-white/15 bg-white/0 px-4 py-3 text-sm text-white/80 backdrop-blur-sm">
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
                      className={WIFI_BUTTON_CLASS}
                      disabled={scanningWifi || !wifiSupported}
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
                          className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition backdrop-blur-sm ${
                            selectedSsid === network.ssid
                              ? 'border-emerald-400/50 bg-emerald-500/5 text-emerald-100'
                              : 'border-white/15 bg-white/0 text-white/80 hover:border-white/35 hover:bg-white/10'
                          } disabled:cursor-not-allowed disabled:opacity-55`}
                          disabled={!wifiSupported}
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
                      className={WIFI_INPUT_CLASS}
                      value={selectedSsid ?? ''}
                      placeholder="Selecciona una red"
                      disabled={!wifiSupported}
                    />
                  </div>
                  <div>
                    <label className="block text-xs uppercase tracking-wide text-white/50">Contraseña</label>
                    <input
                      type="password"
                      className={WIFI_INPUT_CLASS}
                      value={wifiPassword}
                      onChange={(event) => setWifiPassword(event.target.value)}
                      disabled={!wifiSupported}
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleConnectWifi}
                    className="rounded-lg bg-emerald-500/80 px-4 py-2 text-sm font-medium text-white shadow-md transition hover:bg-emerald-500"
                    disabled={connectingWifi || !wifiSupported}
                  >
                    {connectingWifi ? 'Conectando…' : 'Conectar' }
                  </button>
                </div>
              </div>
            </GlassPanel>

            <GlassPanel className="gap-6">
              <div>
                <h2 className="text-lg font-medium text-white/85">Panel Efemérides/Noticias</h2>
                <p className="text-sm text-white/55">
                  Configura el panel lateral que alterna efemérides, santoral y titulares RSS.
                </p>
              </div>

              <div className="flex flex-col gap-5">
                <label className="flex items-center gap-3 text-sm text-white/75">
                  <input
                    type="checkbox"
                    checked={form.sideInfoEnabled}
                    onChange={(event) => handleFormChange('sideInfoEnabled', event.target.checked)}
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
                    min={SIDE_INFO_MIN_INTERVAL_SECONDS}
                    max={SIDE_INFO_MAX_INTERVAL_SECONDS}
                    className="mt-2 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    value={form.sideInfoIntervalSeconds}
                    onChange={(event) => handleFormChange('sideInfoIntervalSeconds', event.target.value)}
                    disabled={!form.sideInfoEnabled}
                  />
                  <p className="mt-1 text-xs text-white/45">Rango permitido: 5-30 segundos.</p>
                </div>

                <label className="flex items-center gap-3 text-sm text-white/75">
                  <input
                    type="checkbox"
                    checked={form.sideInfoShowSantoral}
                    onChange={(event) => handleFormChange('sideInfoShowSantoral', event.target.checked)}
                    className="h-4 w-4 rounded border-white/30 bg-white/10 text-emerald-400 focus:ring-emerald-400"
                    disabled={!form.sideInfoEnabled}
                  />
                  Mostrar santoral junto a efemérides
                </label>

                <label className="flex items-center gap-3 text-sm text-white/75">
                  <input
                    type="checkbox"
                    checked={form.sideInfoShowHolidays}
                    onChange={(event) => handleFormChange('sideInfoShowHolidays', event.target.checked)}
                    className="h-4 w-4 rounded border-white/30 bg-white/10 text-emerald-400 focus:ring-emerald-400"
                    disabled={!form.sideInfoEnabled}
                  />
                  Mostrar festivos junto a efemérides
                </label>

                <div>
                  <span className="block text-xs uppercase tracking-wide text-white/50">Secciones visibles</span>
                  <div className="mt-3 flex flex-col gap-3 md:flex-row md:flex-wrap">
                    {SIDE_INFO_SECTION_OPTIONS.map((option) => {
                      const checked = form.sideInfoSections[option.key];
                      return (
                        <label
                          key={option.key}
                          className={`flex flex-1 min-w-[220px] cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 transition ${
                            checked
                              ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-50'
                              : 'border-white/15 bg-white/5 text-white/80 hover:border-white/30 hover:bg-white/10'
                          } ${!form.sideInfoEnabled ? 'cursor-not-allowed opacity-60 hover:border-white/15 hover:bg-white/5' : ''}`}
                        >
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 rounded border-white/30 bg-white/10 text-emerald-400 focus:ring-emerald-400"
                            checked={checked}
                            onChange={(event) => handleSideInfoSectionToggle(option.key, event.target.checked)}
                            disabled={!form.sideInfoEnabled}
                          />
                          <span className="flex flex-col">
                            <span className="text-sm font-medium text-white/90">{option.label}</span>
                            <span className="text-xs text-white/55">{option.description}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h3 className="text-sm font-medium text-white/85">Noticias</h3>
                    <p className="text-xs text-white/55">
                      Activa los titulares y define los feeds RSS a consultar.
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-white/75">
                    <input
                      type="checkbox"
                      checked={form.sideInfoNewsEnabled}
                      onChange={(event) => handleSideInfoNewsToggle(event.target.checked)}
                      className="h-4 w-4 rounded border-white/30 bg-white/10 text-emerald-400 focus:ring-emerald-400"
                      disabled={!form.sideInfoEnabled}
                    />
                    Activar noticias
                  </label>
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-wide text-white/50">
                    Feeds RSS (uno por línea)
                  </label>
                  <textarea
                    className="mt-2 h-28 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white focus:border-white/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    value={form.sideInfoNewsFeeds}
                    onChange={(event) => handleFormChange('sideInfoNewsFeeds', event.target.value)}
                    placeholder={DEFAULT_NEWS_FEEDS.join('\n')}
                    disabled={!form.sideInfoEnabled}
                  />
                  <p className="mt-1 text-xs text-white/45">Solo URLs válidas con http o https.</p>
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={handleResetForm}
                  className="rounded-lg border border-white/25 px-4 py-2 text-sm font-medium text-white transition hover:border-white/40 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={savingConfig || loading}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSaveConfig}
                  className="rounded-lg bg-white/15 px-4 py-2 text-sm font-medium text-white shadow-md transition hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={savingConfig || loading}
                >
                  {savingConfig ? 'Guardando…' : 'Guardar cambios'}
                </button>
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

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={handleResetForm}
                  className="rounded-lg border border-white/25 px-4 py-2 text-sm font-medium text-white transition hover:border-white/40 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={savingConfig || loading}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSaveConfig}
                  className="rounded-lg bg-white/15 px-4 py-2 text-sm font-medium text-white shadow-md transition hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-50"
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
