import React, { useMemo } from "react";

type RotationProgressProps = {
  progress: number; // 0-100
  duration?: number; // Duración total en ms (opcional, para efectos visuales)
  paused?: boolean;
  className?: string;
};

export const RotationProgress: React.FC<RotationProgressProps> = ({
  progress,
  duration,
  paused = false,
  className = ""
}) => {
  const normalizedProgress = useMemo(() => {
    return Math.min(100, Math.max(0, progress));
  }, [progress]);

  // Opacidad dinámica: más opaco cuando está cerca de completar
  const opacity = useMemo(() => {
    if (paused) return 0.5;
    if (normalizedProgress > 90) return 1.0;
    if (normalizedProgress > 50) return 0.8;
    return 0.6;
  }, [normalizedProgress, paused]);

  return (
    <div 
      className={`rotation-progress ${paused ? 'rotation-progress--paused' : ''} ${className}`}
      role="progressbar"
      aria-valuenow={Math.round(normalizedProgress)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Progreso de rotación del panel"
    >
      <div 
        className="rotation-progress__bar"
        style={{ 
          width: `${normalizedProgress}%`,
          opacity: opacity,
          transition: paused ? 'opacity 0.3s ease' : 'width 0.1s linear, opacity 0.3s ease'
        }}
      />
    </div>
  );
};

export default RotationProgress;

