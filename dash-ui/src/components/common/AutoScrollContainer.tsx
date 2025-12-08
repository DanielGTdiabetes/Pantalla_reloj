import React, { useEffect, useRef, useState } from "react";

interface AutoScrollContainerProps {
  children: React.ReactNode;
  speed?: number; // px per second
  pauseAtEndMs?: number;
  className?: string;
  overflowThreshold?: number; // minimum overflow (px) to activate scrolling
}

export const AutoScrollContainer: React.FC<AutoScrollContainerProps> = ({
  children,
  speed = 18,
  pauseAtEndMs = 2500,
  className = "",
  overflowThreshold = 8,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const offsetRef = useRef<number>(0);

  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    let animationId: number | null = null;
    let lastTs = performance.now();
    let pausedUntil = 0;

    const tick = (ts: number) => {
      const delta = ts - lastTs;
      lastTs = ts;

      if (!container || !content) return;
      const contentHeight = content.scrollHeight;
      const viewport = container.clientHeight;
      const maxOffset = Math.max(contentHeight - viewport, 0);

      if (maxOffset <= overflowThreshold) {
        setOffset(0);
        offsetRef.current = 0;
        return;
      }

      if (ts < pausedUntil) {
        animationId = requestAnimationFrame(tick);
        return;
      }

      const deltaPx = (speed * delta) / 1000;
      const currentOffset = offsetRef.current ?? 0;
      const nextOffset = currentOffset + deltaPx;

      if (nextOffset >= maxOffset) {
        offsetRef.current = 0;
        setOffset(0);
        pausedUntil = ts + pauseAtEndMs;
      } else {
        offsetRef.current = nextOffset;
        setOffset(nextOffset);
      }

      animationId = requestAnimationFrame(tick);
    };

    const contentHeight = content.scrollHeight;
    const viewport = container.clientHeight;
    const maxOffset = Math.max(contentHeight - viewport, 0);

    if (maxOffset > overflowThreshold) {
      animationId = requestAnimationFrame(tick);
    } else {
      offsetRef.current = 0;
      setOffset(0);
    }

    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speed, pauseAtEndMs, overflowThreshold, children]);

  useEffect(() => {
    offsetRef.current = 0;
    setOffset(0);
  }, [children]);

  return (
    <div className={`auto-scroll-container panel-scroll-auto ${className || ""}`} ref={containerRef}>
      <div
        ref={contentRef}
        style={{ transform: `translateY(-${offset}px)` }}
      >
        {children}
      </div>
    </div>
  );
};

export default AutoScrollContainer;
