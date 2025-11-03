import React, { useCallback, useEffect, useState } from "react";

import { apiPost } from "../../lib/api";

interface RadarControlsProps {
  enabled: boolean;
  playing: boolean;
  playbackSpeed: number;
  opacity: number;
  onPlayPause: (playing: boolean) => void;
  onSpeedChange: (speed: number) => void;
  onOpacityChange: (opacity: number) => void;
  className?: string;
}

/**
 * Controles UI para animación de radar (play/pause, velocidad, opacidad)
 */
export const RadarControls: React.FC<RadarControlsProps> = ({
  enabled,
  playing,
  playbackSpeed,
  opacity,
  onPlayPause,
  onSpeedChange,
  onOpacityChange,
  className = "",
}) => {
  const handlePlayPause = useCallback(() => {
    onPlayPause(!playing);
  }, [playing, onPlayPause]);

  const handleSpeedChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const speed = parseFloat(event.target.value);
    if (!Number.isNaN(speed) && speed >= 0.1 && speed <= 5.0) {
      onSpeedChange(speed);
    }
  }, [onSpeedChange]);

  const handleOpacityChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const newOpacity = parseFloat(event.target.value);
    if (!Number.isNaN(newOpacity) && newOpacity >= 0 && newOpacity <= 1) {
      onOpacityChange(newOpacity);
    }
  }, [onOpacityChange]);

  if (!enabled) {
    return null;
  }

  return (
    <div className={`radar-controls ${className}`}>
      <div className="radar-controls__inner">
        {/* Play/Pause */}
        <button
          type="button"
          className="radar-controls__button"
          onClick={handlePlayPause}
          aria-label={playing ? "Pausar animación" : "Reproducir animación"}
          title={playing ? "Pausar animación" : "Reproducir animación"}
        >
          {playing ? "⏸" : "▶"}
        </button>

        {/* Velocidad */}
        <div className="radar-controls__group">
          <label htmlFor="radar-speed" className="radar-controls__label">
            Velocidad
          </label>
          <input
            id="radar-speed"
            type="range"
            min="0.1"
            max="5.0"
            step="0.1"
            value={playbackSpeed}
            onChange={handleSpeedChange}
            className="radar-controls__slider"
            aria-label="Velocidad de reproducción"
          />
          <span className="radar-controls__value">{playbackSpeed.toFixed(1)}x</span>
        </div>

        {/* Opacidad */}
        <div className="radar-controls__group">
          <label htmlFor="radar-opacity" className="radar-controls__label">
            Opacidad
          </label>
          <input
            id="radar-opacity"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={opacity}
            onChange={handleOpacityChange}
            className="radar-controls__slider"
            aria-label="Opacidad del radar"
          />
          <span className="radar-controls__value">{Math.round(opacity * 100)}%</span>
        </div>
      </div>
    </div>
  );
};

