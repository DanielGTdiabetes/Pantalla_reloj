import React, { useEffect, useRef } from "react";

type SnowEffectProps = {
  intensity?: "light" | "moderate" | "heavy";
  windSpeed?: number; // -10 a 10 (negativo = izquierda)
  className?: string;
};

interface Snowflake {
  x: number;
  y: number;
  size: number;
  speed: number;
  opacity: number;
  wind: number;
}

const PARTICLE_COUNTS = {
  light: 20,
  moderate: 35,
  heavy: 50
};

export const SnowEffect: React.FC<SnowEffectProps> = ({
  intensity = "moderate",
  windSpeed = 0,
  className = ""
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number>();
  const snowflakesRef = useRef<Snowflake[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Ajustar tamaño del canvas
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    // Crear partículas iniciales
    const particleCount = PARTICLE_COUNTS[intensity];
    snowflakesRef.current = Array.from({ length: particleCount }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      size: Math.random() * 3 + 1, // 1-4px
      speed: Math.random() * 2 + 0.5, // 0.5-2.5
      opacity: Math.random() * 0.5 + 0.5, // 0.5-1.0
      wind: (windSpeed / 10) * (Math.random() * 0.5 + 0.5)
    }));

    // Función de animación
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      snowflakesRef.current.forEach((flake) => {
        // Actualizar posición
        flake.y += flake.speed;
        flake.x += flake.wind;

        // Reiniciar si sale de la pantalla
        if (flake.y > canvas.height) {
          flake.y = -5;
          flake.x = Math.random() * canvas.width;
        }
        if (flake.x > canvas.width) {
          flake.x = 0;
        } else if (flake.x < 0) {
          flake.x = canvas.width;
        }

        // Dibujar copo
        ctx.beginPath();
        ctx.arc(flake.x, flake.y, flake.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${flake.opacity})`;
        ctx.fill();

        // Añadir detalle al copo (cruz)
        ctx.strokeStyle = `rgba(255, 255, 255, ${flake.opacity * 0.8})`;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(flake.x, flake.y - flake.size);
        ctx.lineTo(flake.x, flake.y + flake.size);
        ctx.moveTo(flake.x - flake.size, flake.y);
        ctx.lineTo(flake.x + flake.size, flake.y);
        ctx.stroke();
      });

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [intensity, windSpeed]);

  return (
    <canvas
      ref={canvasRef}
      className={`snow-effect ${className}`}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 1,
        opacity: 0.7
      }}
      aria-hidden="true"
    />
  );
};

export default SnowEffect;

