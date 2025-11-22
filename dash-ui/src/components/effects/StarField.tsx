import React, { useEffect, useRef, useState } from "react";

type StarFieldProps = {
  density?: "sparse" | "normal" | "dense";
  showShootingStars?: boolean;
  className?: string;
};

interface Star {
  x: number;
  y: number;
  size: number;
  opacity: number;
  twinkleSpeed: number;
  twinkleOffset: number;
}

interface ShootingStar {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
}

const STAR_COUNTS = {
  sparse: 50,
  normal: 100,
  dense: 200
};

export const StarField: React.FC<StarFieldProps> = ({
  density = "normal",
  showShootingStars = true,
  className = ""
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const starsRef = useRef<Star[]>([]);
  const shootingStarRef = useRef<ShootingStar | null>(null);
  const [time, setTime] = useState(0);

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

    // Crear estrellas iniciales
    const starCount = STAR_COUNTS[density];
    starsRef.current = Array.from({ length: starCount }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      size: Math.random() * 2 + 0.5, // 0.5-2.5px
      opacity: Math.random() * 0.5 + 0.5, // 0.5-1.0
      twinkleSpeed: Math.random() * 0.02 + 0.01,
      twinkleOffset: Math.random() * Math.PI * 2
    }));

    // Función de animación
    const animate = (currentTime: number) => {
      setTime(currentTime);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Dibujar estrellas
      if (starsRef.current) {
        starsRef.current.forEach((star) => {
        // Efecto de parpadeo
        const twinkle = Math.sin(currentTime * star.twinkleSpeed + star.twinkleOffset) * 0.3 + 0.7;
        const currentOpacity = star.opacity * twinkle;

        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 255, 255, ${currentOpacity})`;
          ctx.fill();
        });
      }

      // Crear estrella fugaz ocasionalmente
      if (showShootingStars && !shootingStarRef.current && Math.random() < 0.001) {
        shootingStarRef.current = {
          x: Math.random() * canvas.width,
          y: 0,
          vx: (Math.random() - 0.5) * 10,
          vy: Math.random() * 5 + 5,
          life: 0,
          maxLife: 60
        };
      }

      // Dibujar y actualizar estrella fugaz
      if (shootingStarRef.current) {
        const star = shootingStarRef.current;
        star.x += star.vx;
        star.y += star.vy;
        star.life++;

        const progress = star.life / star.maxLife;
        const length = (1 - progress) * 50;

        // Dibujar trazo
        ctx.beginPath();
        ctx.moveTo(star.x, star.y);
        ctx.lineTo(star.x - star.vx * length, star.y - star.vy * length);
        ctx.strokeStyle = `rgba(255, 255, 255, ${1 - progress})`;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Dibujar cabeza brillante
        ctx.beginPath();
        ctx.arc(star.x, star.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${1 - progress})`;
        ctx.fill();

        if (star.life >= star.maxLife || star.y > canvas.height || star.x < 0 || star.x > canvas.width) {
          shootingStarRef.current = null;
        }
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [density, showShootingStars]);

  return (
    <canvas
      ref={canvasRef}
      className={`star-field ${className}`}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 1,
        opacity: 0.8
      }}
      aria-hidden="true"
    />
  );
};

export default StarField;

