import React, {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";

import type { UIScrollSpeed } from "../types/config";

export type AutoScrollTextProps = {
  content: string;
  direction?: "left" | "up";
  speed?: UIScrollSpeed;
  gap?: number;
  enabled?: boolean;
  className?: string;
  ariaLabel?: string;
};

const SPEED_MAP: Record<"slow" | "normal" | "fast", number> = {
  slow: 45,
  normal: 80,
  fast: 120
};

const clampSpeed = (speed?: UIScrollSpeed): number => {
  if (speed === undefined || speed === null) {
    return SPEED_MAP.normal;
  }
  if (typeof speed === "number" && Number.isFinite(speed) && speed > 0) {
    return speed;
  }
  if (typeof speed === "string") {
    if (speed in SPEED_MAP) {
      return SPEED_MAP[speed as keyof typeof SPEED_MAP];
    }
    const parsed = Number(speed);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return SPEED_MAP.normal;
};

export const AutoScrollText: React.FC<AutoScrollTextProps> = ({
  content,
  direction = "left",
  speed = "normal",
  gap = 48,
  enabled = true,
  className,
  ariaLabel
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [shouldScroll, setShouldScroll] = useState(false);
  const [duration, setDuration] = useState(0);

  const resolvedSpeed = useMemo(() => clampSpeed(speed), [speed]);
  const sanitizedGap = Number.isFinite(Number(gap)) ? Math.max(Number(gap), 0) : 48;

  const measure = useCallback(() => {
    if (!enabled) {
      setShouldScroll(false);
      setDuration(0);
      return;
    }
    const container = containerRef.current;
    const inner = contentRef.current;
    if (!container || !inner) {
      return;
    }
    const containerSize = direction === "left" ? container.offsetWidth : container.offsetHeight;
    const contentSize = direction === "left" ? inner.scrollWidth : inner.scrollHeight;

    if (!containerSize || contentSize <= containerSize + 1) {
      setShouldScroll(false);
      setDuration(0);
      return;
    }

    const calculatedDuration = contentSize / Math.max(resolvedSpeed, 1);
    setShouldScroll(true);
    setDuration(calculatedDuration);
  }, [direction, enabled, resolvedSpeed]);

  useLayoutEffect(() => {
    measure();
  }, [measure, content, direction, resolvedSpeed, sanitizedGap]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(() => measure());
    const container = containerRef.current;
    const inner = contentRef.current;
    if (container) {
      observer.observe(container);
    }
    if (inner) {
      observer.observe(inner);
    }
    return () => observer.disconnect();
  }, [measure]);

  useEffect(() => {
    if (!enabled) {
      setShouldScroll(false);
      setDuration(0);
    }
  }, [enabled]);

  const classes = useMemo(() => {
    const base = direction === "left" ? "ticker" : "vscroll";
    return [base, "auto-scroll", className].filter(Boolean).join(" ");
  }, [className, direction]);

  const isActive = enabled && shouldScroll;
  const animationDuration = isActive ? Math.max(duration, 0.5) : 0;

  const containerStyle = useMemo<CSSProperties>(() => {
    return { "--ticker-gap": `${sanitizedGap}px` } as CSSProperties;
  }, [sanitizedGap]);

  return (
    <div
      ref={containerRef}
      className={classes}
      data-scroll-active={isActive ? "true" : "false"}
      style={containerStyle}
      aria-label={ariaLabel}
    >
      <div
        className={direction === "left" ? "ticker__track" : "vscroll__track"}
        style={isActive ? { animationDuration: `${animationDuration}s` } : {}}
      >
        <div className="auto-scroll__segment" ref={contentRef} dangerouslySetInnerHTML={{ __html: content }} />
        {isActive && (
          <div className="auto-scroll__segment auto-scroll__segment--clone" aria-hidden="true" dangerouslySetInnerHTML={{ __html: content }} />
        )}
      </div>
    </div>
  );
};
