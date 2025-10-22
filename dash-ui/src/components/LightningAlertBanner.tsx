import { useEffect, useMemo, useRef, useState } from 'react';
import lightningPing from '../assets/sounds/lightning-ping.wav';
import { useDashboardConfig } from '../context/DashboardConfigContext';
import { useStormStatus } from '../context/StormStatusContext';
import type { StormStatus } from '../services/storms';

const DEFAULT_COOLDOWN_MINUTES = 30;

function formatRelativeTime(date: Date | null): string | null {
  if (!date || Number.isNaN(date.getTime())) {
    return null;
  }
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMinutes = Math.round(Math.abs(diffMs) / 60000);
  if (diffMinutes <= 1) {
    return diffMs >= 0 ? 'hace instantes' : 'en instantes';
  }
  if (diffMinutes < 60) {
    return diffMs >= 0 ? `hace ${diffMinutes} min` : `en ${diffMinutes} min`;
  }
  const diffHours = Math.round(diffMinutes / 60);
  return diffMs >= 0 ? `hace ${diffHours} h` : `en ${diffHours} h`;
}

function resolveCooldownMinutes(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.min(360, Math.max(1, Math.round(raw)));
  }
  return DEFAULT_COOLDOWN_MINUTES;
}

function resolveReferenceTimestamp(
  lastTrigger: number | null,
  lastStatus: StormStatus | null,
): number | null {
  if (lastTrigger) {
    return lastTrigger;
  }
  const iso = lastStatus?.lastStrikeAt;
  if (iso) {
    const parsed = Date.parse(iso);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return null;
}

const LightningAlertBanner = () => {
  const { status } = useStormStatus();
  const { config } = useDashboardConfig();
  const soundEnabled = Boolean(config?.storm?.alert?.soundEnabled);
  const cooldownMinutes = resolveCooldownMinutes(config?.storm?.alert?.cooldownMinutes);

  const [visible, setVisible] = useState(false);
  const [lastTriggerTs, setLastTriggerTs] = useState<number | null>(null);
  const [lastActiveStatus, setLastActiveStatus] = useState<StormStatus | null>(null);
  const prevActiveRef = useRef<boolean | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const currentlyActive = Boolean(status?.nearActivity);

  useEffect(() => {
    if (typeof Audio === 'undefined') {
      return () => undefined;
    }
    const audio = new Audio(lightningPing);
    audio.volume = 0.55;
    audio.preload = 'auto';
    audioRef.current = audio;
    return () => {
      audio.pause();
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (currentlyActive && status) {
      setVisible(true);
      setLastTriggerTs(Date.now());
      setLastActiveStatus(status);
    }

    const prev = prevActiveRef.current;
    if (soundEnabled && currentlyActive && !prev) {
      const audio = audioRef.current;
      if (audio) {
        try {
          audio.currentTime = 0;
        } catch (error) {
          // ignore inability to reset playback position
        }
        void audio.play().catch(() => undefined);
      }
    }
    prevActiveRef.current = currentlyActive;
  }, [currentlyActive, soundEnabled, status]);

  useEffect(() => {
    if (!visible || currentlyActive) {
      return () => undefined;
    }

    const cooldownMs = Math.max(1, cooldownMinutes) * 60_000;
    const check = () => {
      if (currentlyActive) {
        return;
      }
      const reference = resolveReferenceTimestamp(lastTriggerTs, lastActiveStatus);
      if (!reference) {
        setVisible(false);
        setLastActiveStatus(null);
        setLastTriggerTs(null);
        return;
      }
      if (Date.now() - reference >= cooldownMs) {
        setVisible(false);
        setLastActiveStatus(null);
        setLastTriggerTs(null);
      }
    };

    const timer = window.setInterval(check, 15_000);
    check();
    return () => window.clearInterval(timer);
  }, [visible, currentlyActive, cooldownMinutes, lastTriggerTs, lastActiveStatus]);

  const displayStatus = currentlyActive && status ? status : lastActiveStatus;

  const distanceFormatter = useMemo(
    () => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 0 }),
    [],
  );
  const countFormatter = useMemo(() => new Intl.NumberFormat('es-ES'), []);

  if (!visible || !displayStatus) {
    return null;
  }

  const distanceText =
    displayStatus.lastStrikeKm != null
      ? `A ${distanceFormatter.format(displayStatus.lastStrikeKm)} km`
      : 'Actividad eléctrica detectada';
  const lastStrikeDate = displayStatus.lastStrikeAt ? new Date(displayStatus.lastStrikeAt) : null;
  const timeAgo = formatRelativeTime(lastStrikeDate);
  const strikesWindow = displayStatus.strikesWindowMinutes ?? cooldownMinutes;
  const strikesCount =
    typeof displayStatus.strikesCount === 'number' && Number.isFinite(displayStatus.strikesCount)
      ? Math.max(0, Math.round(displayStatus.strikesCount))
      : null;
  const countText =
    strikesCount !== null && strikesCount > 0 && strikesWindow
      ? `${countFormatter.format(strikesCount)} descarga${strikesCount === 1 ? '' : 's'} en los últimos ${strikesWindow} min`
      : null;

  return (
    <div className="pointer-events-none absolute left-1/2 top-6 z-30 flex w-full max-w-full justify-center px-4">
      <div className="pointer-events-auto flex max-w-xl items-start gap-4 rounded-2xl bg-amber-500/95 px-6 py-4 text-amber-50 shadow-lg shadow-amber-500/30 backdrop-blur">
        <div className="text-3xl leading-none" aria-hidden>
          ⚡
        </div>
        <div className="flex flex-col">
          <span className="text-[11px] uppercase tracking-[0.35em] text-amber-100/90">Rayos cerca</span>
          <span className="mt-1 text-sm font-semibold text-amber-50">
            {distanceText}
            {timeAgo ? ` • ${timeAgo}` : ''}
          </span>
          {countText && <span className="mt-1 text-xs text-amber-100/80">{countText}</span>}
        </div>
      </div>
    </div>
  );
};

export default LightningAlertBanner;
