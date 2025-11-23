import type { Map as MaptilerMap } from "@maptiler/sdk";

// Promesa global para evitar carreras al registrar el icono
let planeIconPromise: Promise<boolean> | null = null;

/**
 * Genera un icono de avión usando canvas y lo registra en el mapa.
 * @param map Instancia del mapa MapLibre
 * @returns Promise que se resuelve cuando el icono está registrado
 */
export async function registerPlaneIcon(map: MaptilerMap): Promise<boolean> {
  // Si ya existe el icono, no hacer nada
  if (map.hasImage("plane")) {
    return true;
  }

  // Si hay una promesa pendiente, esperarla en lugar de crear otra
  if (planeIconPromise) {
    try {
      return await planeIconPromise;
    } catch {
      // Si falló la promesa anterior, continuar con el registro
      planeIconPromise = null;
    }
  }

  // Crear nueva promesa para el registro
  planeIconPromise = (async (): Promise<boolean> => {
    try {
      const size = 64; // Tamaño base del canvas (64x64)
      const pixelRatio = 2; // Para alta densidad de píxeles
      const canvas = document.createElement("canvas");
      canvas.width = size * pixelRatio;
      canvas.height = size * pixelRatio;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        console.warn("[planeIcon] No se pudo obtener contexto 2D del canvas");
        return false;
      }

      // Configurar contexto para alta densidad
      ctx.scale(pixelRatio, pixelRatio);

      // Fondo transparente
      ctx.clearRect(0, 0, size, size);

      // Dibujar icono de avión estilizado (flecha hacia arriba con alas)
      const centerX = size / 2;
      const centerY = size / 2;
      const iconSize = size * 0.7; // 70% del tamaño del canvas
      const halfSize = iconSize / 2;

      ctx.save();

      // Mover al centro
      ctx.translate(centerX, centerY);

      // Color del avión (#f97316 - naranja)
      ctx.fillStyle = "#f97316";
      ctx.strokeStyle = "#111827";
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      // Dibujar cuerpo del avión (forma de flecha)
      ctx.beginPath();
      // Punto superior (nariz)
      ctx.moveTo(0, -halfSize * 0.8);
      // Ala izquierda
      ctx.lineTo(-halfSize * 0.6, halfSize * 0.2);
      // Ala derecha
      ctx.lineTo(0, halfSize * 0.4);
      // Ala derecha (parte inferior)
      ctx.lineTo(halfSize * 0.6, halfSize * 0.2);
      // Cerrar al punto superior
      ctx.closePath();

      ctx.fill();
      ctx.stroke();

      // Dibujar cola del avión (pequeña)
      ctx.beginPath();
      ctx.moveTo(0, halfSize * 0.4);
      ctx.lineTo(-halfSize * 0.3, halfSize * 0.7);
      ctx.lineTo(halfSize * 0.3, halfSize * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.restore();

      // Convertir canvas a ImageData
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      // Registrar el icono en el mapa
      // MapLibre-GL acepta ImageData directamente, el pixelRatio ya está en el canvas
      map.addImage("plane", {
        width: canvas.width,
        height: canvas.height,
        data: new Uint8Array(imageData.data),
      });

      return true;
    } catch (error) {
      console.warn("[planeIcon] Error al registrar icono de avión:", error);
      return false;
    } finally {
      // Limpiar la promesa cuando termine
      planeIconPromise = null;
    }
  })();

  try {
    return await planeIconPromise;
  } catch (error) {
    console.warn("[planeIcon] Error en la promesa de registro:", error);
    planeIconPromise = null;
    return false;
  }
}
