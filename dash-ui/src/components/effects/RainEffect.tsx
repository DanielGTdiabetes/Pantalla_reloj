import React, { useEffect, useRef } from "react";

type RainEffectProps = {
  intensity?: "light" | "moderate" | "heavy";
  windSpeed?: number;
  showSplash?: boolean;
  className?: string;
};

interface RainDrop {
  x: number;
  y: number;
  length: number;
  speed: number;
  opacity: number;
  wind: number;
}

interface Splash {
  x: number;
  y: number;
  life: number;
  maxLife: number;
}

const PARTICLE_COUNTS = {
  light: 30,
  moderate: 60,
  heavy: 100
};

export const RainEffect: React.FC<RainEffectProps> = ({
  intensity = "moderate",
  windSpeed = 0,
  showSplash = false,
  className = ""
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const raindropsRef = useRef<RainDrop[]>([]);
  const splashesRef = useRef<Splash[]>([]);

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

    // Crear gotas iniciales
    const particleCount = PARTICLE_COUNTS[intensity];
    raindropsRef.current = Array.from({ length: particleCount }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      length: Math.random() * 10 + 5, // 5-15px
      speed: Math.random() * 5 + 3, // 3-8
      opacity: Math.random() * 0.3 + 0.5, // 0.5-0.8
      wind: (windSpeed / 10) * (Math.random() * 0.3 + 0.7)
    }));

    // Función de animación
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Dibujar y actualizar gotas
      if (raindropsRef.current) {
        raindropsRef.current.forEach((drop) => {
          // Actualizar posición
          drop.y += drop.speed;
          drop.x += drop.wind;

          // Crear splash al tocar el suelo
          if (showSplash && drop.y > canvas.height - 20 && Math.random() < 0.1 && splashesRef.current) {
            splashesRef.current.push({
              x: drop.x,
              y: canvas.height,
              life: 0,
              maxLife: 20
            });
          }

        // Reiniciar si sale de la pantalla
        if (drop.y > canvas.height) {
          drop.y = -drop.length;
          drop.x = Math.random() * canvas.width;
        }
        if (drop.x > canvas.width) {
          drop.x = 0;
        } else if (drop.x < 0) {
          drop.x = canvas.width;
        }

        // Dibujar gota
        ctx.beginPath();
        ctx.moveTo(drop.x, drop.y);
        ctx.lineTo(drop.x + drop.wind, drop.y + drop.length);
        ctx.strokeStyle = `rgba(173, 216, 230, ${drop.opacity})`;
        ctx.lineWidth = 1.5;
          ctx.stroke();
        });
      }

      // Dibujar y actualizar splashes
      if (showSplash && splashesRef.current) {
        splashesRef.current = splashesRef.current.filter((splash) => {
          splash.life++;
          const progress = splash.life / splash.maxLife;
          const size = (1 - progress) * 5;

          // Dibujar splash
          ctx.beginPath();
          ctx.arc(splash.x, splash.y, size, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(173, 216, 230, ${1 - progress})`;
          ctx.fill();

          return splash.life < splash.maxLife;
        });
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [intensity, windSpeed, showSplash]);

  return (
    <canvas
      ref={canvasRef}
      className={`rain-effect ${className}`}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 1,
        opacity: 0.6
      }}
      aria-hidden="true"
    />
  );
};

export default RainEffect;

