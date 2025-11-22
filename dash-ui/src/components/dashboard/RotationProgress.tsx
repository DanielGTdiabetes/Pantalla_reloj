import React from "react";

type RotationProgressProps = {
  progress: number; // 0-100
  className?: string;
};

export const RotationProgress: React.FC<RotationProgressProps> = ({
  progress,
  className = ""
}) => {
  return (
    <div 
      className={`rotation-progress ${className}`}
      role="progressbar"
      aria-valuenow={Math.round(progress)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Progreso de rotación del panel"
    >
      <div 
        className="rotation-progress__bar"
        style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
      />
    </div>
  );
};

export default RotationProgress;

