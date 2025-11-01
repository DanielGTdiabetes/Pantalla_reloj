interface MapSpinnerProps {
  message?: string;
}

export function MapSpinner({ message = "Cambiando estilo…" }: MapSpinnerProps) {
  return (
    <div className="map-style-spinner" role="status" aria-live="polite">
      <span className="map-style-spinner__dot" aria-hidden="true" />
      <span className="map-style-spinner__text">{message}</span>
    </div>
  );
}

export default MapSpinner;
