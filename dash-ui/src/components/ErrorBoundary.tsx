import type { ErrorInfo, PropsWithChildren, ReactNode } from "react";
import { Component } from "react";

type ErrorBoundaryState = {
  hasError: boolean;
  message: string;
  incidentId: string;
};

type ErrorBoundaryProps = PropsWithChildren<{
  fallback?: ReactNode;
}>;

declare global {
  interface Window {
    __lastError__?: {
      error: unknown;
      info?: ErrorInfo;
      incidentId: string;
      message: string;
      timestamp: string;
      origin: "boundary" | "window.onerror" | "unhandledrejection";
    };
  }
}

const generateIncidentId = () => {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `INC-${Date.now().toString(36).toUpperCase()}-${random}`;
};

const extractMessage = (error: unknown): string => {
  if (!error) {
    return "Se produjo un error inesperado";
  }
  if (error instanceof Error) {
    return error.message || error.name;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch (serializationError) {
    console.error("[ErrorBoundary] No se pudo serializar el error", serializationError);
    return "Se produjo un error inesperado";
  }
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    message: "",
    incidentId: ""
  };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: extractMessage(error),
      incidentId: generateIncidentId()
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    const incidentId = this.state.incidentId || generateIncidentId();

    console.error(`[ErrorBoundary] Error capturado (${incidentId})`, error, info);

    if (typeof window !== "undefined") {
      window.__lastError__ = {
        error,
        info,
        incidentId,
        message: extractMessage(error),
        timestamp: new Date().toISOString(),
        origin: "boundary"
      };
    }
  }

  reset(): void {
    this.setState({ hasError: false, message: "", incidentId: "" });
  }

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    if (this.props.fallback) {
      return this.props.fallback;
    }

    return (
      <div className="error-boundary" role="alert">
        <div className="error-boundary__content">
          <span className="error-boundary__badge">ERROR</span>
          <h2 className="error-boundary__title">Algo ha salido mal</h2>
          <p className="error-boundary__message">{this.state.message}</p>
          <p className="error-boundary__incident">
            ID de incidente: <strong>{this.state.incidentId}</strong>
          </p>
          <button className="error-boundary__button" type="button" onClick={() => this.reset()}>
            Reintentar
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
