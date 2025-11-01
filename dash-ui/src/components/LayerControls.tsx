import React, { useCallback, useMemo, useState } from "react";

import type { useConfig } from "../lib/useConfig";
import { saveConfig } from "../lib/api";
import type { AppConfig } from "../types/config";

import "../styles/layer-controls.css";

type ConfigState = ReturnType<typeof useConfig>;

type LayerControlsProps = {
  configState: ConfigState;
};

const cloneConfig = (config: AppConfig): AppConfig => {
  return JSON.parse(JSON.stringify(config)) as AppConfig;
};

export const LayerControls: React.FC<LayerControlsProps> = ({ configState }) => {
  const { data, loading, reload, error } = configState;
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const flightsEnabled = data?.layers.flights.enabled ?? false;

  const disabled = loading || pending || !data;

  const statusMessage = useMemo(() => {
    if (pending) {
      return "Guardando…";
    }
    if (error) {
      return "Error de configuración";
    }
    return null;
  }, [pending, error]);

  const handleToggle = useCallback(async () => {
    if (!data || pending) {
      return;
    }

    setPending(true);
    setLocalError(null);

    try {
      const updated = cloneConfig(data);
      updated.layers.flights.enabled = !flightsEnabled;
      await saveConfig(updated);
      await reload();
    } catch (err) {
      console.error("[LayerControls] Failed to update flights layer", err);
      setLocalError("No se pudo actualizar la capa de aviones");
    } finally {
      setPending(false);
    }
  }, [data, flightsEnabled, pending, reload]);

  if (!data) {
    return null;
  }

  return (
    <section className="layer-controls" aria-label="Capas del mapa">
      <div className="layer-controls__header">
        <h2 className="layer-controls__title">Capas</h2>
        {statusMessage ? <span className="layer-controls__status">{statusMessage}</span> : null}
      </div>

      <label className="layer-controls__toggle">
        <input
          type="checkbox"
          className="layer-controls__checkbox"
          checked={flightsEnabled}
          onChange={handleToggle}
          disabled={disabled}
        />
        <span className="layer-controls__switch" aria-hidden="true" />
        <span className="layer-controls__text">
          <span className="layer-controls__label">Aviones</span>
          <span className="layer-controls__hint">Mostrar u ocultar la capa de vuelos</span>
        </span>
      </label>

      {localError ? (
        <p className="layer-controls__error" role="alert">
          {localError}
        </p>
      ) : null}
    </section>
  );
};

export default LayerControls;
