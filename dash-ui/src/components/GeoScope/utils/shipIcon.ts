import type maplibregl from "maplibre-gl";

// Promesa global para evitar carreras al registrar el icono
let shipIconPromise: Promise<boolean> | null = null;

/**
 * Genera un icono de barco usando canvas y lo registra en el mapa.
 * @param map Instancia del mapa MapLibre
 * @returns Promise que se resuelve cuando el icono está registrado
 */
export async function registerShipIcon(map: maplibregl.Map): Promise<boolean> {
  // Si ya existe el icono, no hacer nada
  if (map.hasImage("ship")) {
    return true;
  }

  // Si hay una promesa pendiente, esperarla en lugar de crear otra
  if (shipIconPromise) {
    try {
      return await shipIconPromise;
    } catch {
      // Si falló la promesa anterior, continuar con el registro
      shipIconPromise = null;
    }
  }

  // Crear nueva promesa para el registro
  shipIconPromise = (async (): Promise<boolean> => {
    try {
      const size = 64; // Tamaño base del canvas (64x64)
      const pixelRatio = 2; // Para alta densidad de píxeles
      const canvas = document.createElement("canvas");
      canvas.width = size * pixelRatio;
      canvas.height = size * pixelRatio;
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        console.warn("[shipIcon] No se pudo obtener contexto 2D del canvas");
        return false;
      }

      // Configurar contexto para alta densidad
      ctx.scale(pixelRatio, pixelRatio);

      // Fondo transparente
      ctx.clearRect(0, 0, size, size);

      // Dibujar icono de barco estilizado
      const centerX = size / 2;
      const centerY = size / 2;
      const iconSize = size * 0.7;
      const halfSize = iconSize / 2;

      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.fillStyle = "#38bdf8";
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      // Casco del barco (forma de U invertida)
      ctx.beginPath();
      ctx.arc(-halfSize * 0.4, halfSize * 0.2, halfSize * 0.3, Math.PI, 0, false);
      ctx.lineTo(halfSize * 0.4, halfSize * 0.5);
      ctx.arc(halfSize * 0.4, halfSize * 0.2, halfSize * 0.3, 0, Math.PI, false);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Mástil
      ctx.beginPath();
      ctx.moveTo(0, -halfSize * 0.4);
      ctx.lineTo(0, halfSize * 0.1);
      ctx.stroke();

      // Vela
      ctx.beginPath();
      ctx.moveTo(0, -halfSize * 0.2);
      ctx.lineTo(halfSize * 0.3, halfSize * 0.05);
      ctx.lineTo(0, halfSize * 0.05);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.restore();

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      map.addImage("ship", {
        width: canvas.width,
        height: canvas.height,
        data: new Uint8Array(imageData.data),
      });

      return true;
    } catch (error) {
      console.warn("[shipIcon] Error al registrar icono de barco:", error);
      return false;
    } finally {
      shipIconPromise = null;
    }
  })();

  try {
    return await shipIconPromise;
  } catch (error) {
    console.warn("[shipIcon] Error en la promesa de registro:", error);
    shipIconPromise = null;
    return false;
  }
}

