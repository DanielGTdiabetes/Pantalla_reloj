import { useEffect, useRef, useState } from 'react';
import { fetchNextDstTransition, type DstTransitionInfo } from '../services/time';
import { enqueueAlertTts } from '../services/tts';

const POLL_INTERVAL = 6 * 60 * 60 * 1000;
const STORAGE_KEY = 'dstNotice.lastShownDate';

interface DisplayState {
  mode: 'chip' | 'banner';
  key: string;
  message: string;
  subMessage?: string;
  date: string | null;
  kind: 'back' | 'forward' | null;
  deltaHours: number;
  daysLeft: number;
}

function describeChange(kind: 'back' | 'forward' | null, deltaHours: number): string {
  const hours = Math.abs(deltaHours || (kind === 'back' ? -1 : 1));
  const hourLabel = hours === 1 ? '1 hora' : `${hours} horas`;
  if (kind === 'back') return `retrasamos ${hourLabel}`;
  if (kind === 'forward') return `adelantamos ${hourLabel}`;
  return `${deltaHours >= 0 ? 'adelantamos' : 'retrasamos'} ${hourLabel}`;
}

function formatShort(date: string | null): string | null {
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.valueOf())) return null;
  return parsed.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
}

function formatLong(date: string | null): string | null {
  if (!date) return null;
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.valueOf())) return null;
  return parsed.toLocaleDateString('es-ES', { day: '2-digit', month: 'long' });
}

const DstNotice = () => {
  const [info, setInfo] = useState<DstTransitionInfo | null>(null);
  const [display, setDisplay] = useState<DisplayState | null>(null);
  const autoHideRef = useRef<number | null>(null);
  const dismissedKeyRef = useRef<string | null>(null);
  const spokenRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const data = await fetchNextDstTransition();
        if (!cancelled) {
          setInfo(data);
        }
      } catch (error) {
        if (!cancelled) {
          setInfo(null);
        }
      }
    };

    void load();
    const timer = window.setInterval(() => {
      void load();
    }, POLL_INTERVAL);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!info || !info.hasUpcoming || info.daysLeft == null) {
      setDisplay(null);
      return;
    }
    if (info.daysLeft > 7) {
      setDisplay(null);
      return;
    }

    const daysLeft = info.daysLeft ?? 0;
    const key = `${info.date ?? 'unknown'}:${daysLeft}`;
    const mode: DisplayState['mode'] = daysLeft === 0 ? 'banner' : 'chip';

    if (mode === 'banner' && info.date) {
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored === info.date) {
          setDisplay(null);
          return;
        }
      } catch (error) {
        console.warn('No se pudo leer dstNotice.lastShownDate', error);
      }
    }

    if (mode === 'chip' && dismissedKeyRef.current === key) {
      setDisplay(null);
      return;
    }

    const change = describeChange(info.kind, info.deltaHours ?? 0);
    const shortDate = formatShort(info.date);

    const message = mode === 'banner'
      ? `Hoy cambia la hora: ${change} el reloj.`
      : `Cambio de hora en ${daysLeft} ${daysLeft === 1 ? 'día' : 'días'}: ${change}${shortDate ? ` (${shortDate})` : ''}`;

    const subMessage = mode === 'banner' ? formatLong(info.date) : null;

    setDisplay((current) => {
      if (current && current.key === key && current.mode === mode && current.message === message) {
        return current;
      }
      return {
        mode,
        key,
        message,
        subMessage: subMessage ? `Entrada en vigor: ${subMessage}` : undefined,
        date: info.date ?? null,
        kind: info.kind,
        deltaHours: info.deltaHours,
        daysLeft,
      };
    });
  }, [info]);

  useEffect(() => {
    if (display?.mode !== 'banner') {
      return;
    }
    if (display.date) {
      try {
        window.localStorage.setItem(STORAGE_KEY, display.date);
      } catch (error) {
        console.warn('No se pudo guardar dstNotice.lastShownDate', error);
      }
    }
    if (display.date && spokenRef.current !== display.date) {
      spokenRef.current = display.date;
      const ttsMessage = display.kind === 'forward'
        ? 'Hoy cambia la hora. Adelantamos el reloj una hora.'
        : 'Hoy cambia la hora. Retrasamos el reloj una hora.';
      void enqueueAlertTts(ttsMessage).catch(() => {
        /* silencio si falla */
      });
    }
  }, [display]);

  useEffect(() => {
    if (!display) return;
    if (autoHideRef.current) {
      window.clearTimeout(autoHideRef.current);
    }
    autoHideRef.current = window.setTimeout(() => {
      dismissedKeyRef.current = display.key;
      setDisplay(null);
    }, display.mode === 'banner' ? 15_000 : 12_000);

    return () => {
      if (autoHideRef.current) {
        window.clearTimeout(autoHideRef.current);
        autoHideRef.current = null;
      }
    };
  }, [display]);

  useEffect(() => {
    return () => {
      if (autoHideRef.current) {
        window.clearTimeout(autoHideRef.current);
      }
    };
  }, []);

  const handleClose = () => {
    if (!display) return;
    if (autoHideRef.current) {
      window.clearTimeout(autoHideRef.current);
      autoHideRef.current = null;
    }
    dismissedKeyRef.current = display.key;
    if (display.mode === 'banner' && display.date) {
      try {
        window.localStorage.setItem(STORAGE_KEY, display.date);
      } catch (error) {
        console.warn('No se pudo persistir dstNotice.lastShownDate', error);
      }
    }
    setDisplay(null);
  };

  if (!display) return null;

  const bannerVisible = display.mode === 'banner';
  const chipVisible = display.mode === 'chip';

  return (
    <>
      {bannerVisible && (
        <div className="pointer-events-auto absolute left-1/2 top-full z-30 mt-3 w-[min(420px,calc(100vw-4rem))] -translate-x-1/2 rounded-2xl border border-emerald-400/30 bg-emerald-500/15 px-5 py-3 text-sm text-emerald-50 shadow-2xl backdrop-blur">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <p className="font-semibold leading-snug">{display.message}</p>
              {display.subMessage && (
                <p className="mt-1 text-[0.7rem] uppercase tracking-[0.35em] text-emerald-100/70">{display.subMessage}</p>
              )}
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Cerrar aviso de cambio de hora"
              className="rounded-full border border-emerald-300/40 bg-emerald-500/20 px-2 py-1 text-xs text-emerald-50/80 transition hover:bg-emerald-400/20"
            >
              ×
            </button>
          </div>
        </div>
      )}
      {chipVisible && (
        <div className="flex max-w-xs items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-[0.65rem] font-medium uppercase tracking-[0.3em] text-emerald-100/90 shadow-sm backdrop-blur">
          <span className="leading-tight text-left">{display.message}</span>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Ocultar aviso de cambio de hora"
            className="rounded-full border border-emerald-400/40 px-1 text-[0.65rem] text-emerald-50/70 transition hover:bg-emerald-400/20"
          >
            ×
          </button>
        </div>
      )}
    </>
  );
};

export default DstNotice;
