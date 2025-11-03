import { useCallback, useEffect, useState } from "react";

const LS_KEY = "notice.swiftshader.accepted";

export default function SwiftShaderNotice() {
  const [visible, setVisible] = useState(false);

  const handleAccept = useCallback(() => {
    localStorage.setItem(LS_KEY, "true");
    setVisible(false);
  }, []);

  const handleMoreInfo = useCallback(() => {
    // Opcional: abrir /about o modal técnico si existe
    window.open("/about", "_blank");
  }, []);

  useEffect(() => {
    const accepted = localStorage.getItem(LS_KEY) === "true";
    if (!accepted) {
      // Mostrar después de 1-2 segundos de carga
      const timer = setTimeout(() => setVisible(true), 1200);
      return () => clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && visible) {
        handleAccept();
      }
    }

    if (visible) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [visible, handleAccept]);

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Aviso de modo compatibilidad SwiftShader"
      className="swiftshader-notice"
      style={{ pointerEvents: "auto" }}
    >
      <div className="swiftshader-notice-content">
        <div className="swiftshader-notice-title">
          Modo compatibilidad de gráficos
        </div>
        <div className="swiftshader-notice-subtitle">
          Usando SwiftShader para mayor estabilidad.
        </div>
        <div className="swiftshader-notice-actions">
          <button
            aria-label="Aceptar aviso de compatibilidad"
            className="swiftshader-notice-btn swiftshader-notice-btn-primary"
            onClick={handleAccept}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleAccept();
              }
            }}
          >
            Aceptar
          </button>
          <button
            className="swiftshader-notice-btn swiftshader-notice-btn-secondary"
            onClick={handleMoreInfo}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleMoreInfo();
              }
            }}
          >
            Más info
          </button>
        </div>
      </div>
    </div>
  );
}

