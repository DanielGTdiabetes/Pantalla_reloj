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

      // Dibujar icono de avión realista (vista desde arriba)
      const centerX = size / 2;
      const centerY = size / 2;
      const iconSize = size * 0.75; // 75% del tamaño del canvas
      const halfSize = iconSize / 2;

      ctx.save();

      // Mover al centro
      ctx.translate(centerX, centerY);

      // Color del avión (#f97316 - naranja vibrante)
      ctx.fillStyle = "#f97316";
      ctx.strokeStyle = "#1f2937"; // Gris oscuro para mejor contraste
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      // Dibujar el fuselaje del avión (cuerpo principal)
      ctx.beginPath();
      // Nariz del avión (punta)
      ctx.moveTo(0, -halfSize * 0.9);
      // Lado izquierdo del fuselaje
      ctx.lineTo(-halfSize * 0.15, -halfSize * 0.3);
      ctx.lineTo(-halfSize * 0.15, halfSize * 0.5);
      // Cola izquierda
      ctx.lineTo(-halfSize * 0.25, halfSize * 0.8);
      ctx.lineTo(-halfSize * 0.15, halfSize * 0.85);
      ctx.lineTo(0, halfSize * 0.75);
      // Cola derecha
      ctx.lineTo(halfSize * 0.15, halfSize * 0.85);
      ctx.lineTo(halfSize * 0.25, halfSize * 0.8);
      ctx.lineTo(halfSize * 0.15, halfSize * 0.5);
      // Lado derecho del fuselaje
      ctx.lineTo(halfSize * 0.15, -halfSize * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Dibujar alas principales (más anchas y realistas)
      ctx.beginPath();
      // Ala izquierda
      ctx.moveTo(-halfSize * 0.15, 0);
      ctx.lineTo(-halfSize * 0.85, halfSize * 0.25);
      ctx.lineTo(-halfSize * 0.75, halfSize * 0.35);
      ctx.lineTo(-halfSize * 0.15, halfSize * 0.15);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      // Ala derecha
      ctx.moveTo(halfSize * 0.15, 0);
      ctx.lineTo(halfSize * 0.85, halfSize * 0.25);
      ctx.lineTo(halfSize * 0.75, halfSize * 0.35);
      ctx.lineTo(halfSize * 0.15, halfSize * 0.15);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Agregar detalles de ventanas/cabina (línea blanca en la nariz)
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-halfSize * 0.08, -halfSize * 0.6);
      ctx.lineTo(0, -halfSize * 0.75);
      ctx.lineTo(halfSize * 0.08, -halfSize * 0.6);
      ctx.stroke();

      // Línea central del fuselaje para dar profundidad
      ctx.strokeStyle = "#ea580c"; // Naranja más oscuro
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -halfSize * 0.5);
      ctx.lineTo(0, halfSize * 0.6);
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
