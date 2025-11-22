/**
 * Sistema centralizado de diagnóstico de capas
 * Rastrea el estado, errores y precondiciones de cada capa
 */

export type LayerId = "flights" | "ships" | "weather" | "radar" | "lightning" | "aemet-warnings";

export type LayerState = 
  | "not_initialized"
  | "initializing"
  | "waiting_style"
  | "waiting_config"
  | "waiting_backend"
  | "ready"
  | "error"
  | "disabled";

export interface LayerDiagnostic {
  layerId: LayerId;
  state: LayerState;
  enabled: boolean;
  lastError: string | null;
  lastErrorTime: number | null;
  errorCount: number;
  initializationAttempts: number;
  lastDataUpdate: number | null;
  preconditions: {
    styleLoaded: boolean;
    configAvailable: boolean;
    configEnabled: boolean;
    backendAvailable: boolean;
    apiKeysConfigured: boolean;
  };
  metadata: Record<string, unknown>;
}

class LayerDiagnostics {
  private diagnostics: Map<LayerId, LayerDiagnostic> = new Map();
  private listeners: Set<(diagnostics: Map<LayerId, LayerDiagnostic>) => void> = new Set();

  constructor() {
    // Inicializar diagnóstico para cada capa conocida
    const knownLayers: LayerId[] = ["flights", "ships", "weather", "radar", "lightning", "aemet-warnings"];
    for (const layerId of knownLayers) {
      this.diagnostics.set(layerId, {
        layerId,
        state: "not_initialized",
        enabled: false,
        lastError: null,
        lastErrorTime: null,
        errorCount: 0,
        initializationAttempts: 0,
        lastDataUpdate: null,
        preconditions: {
          styleLoaded: false,
          configAvailable: false,
          configEnabled: false,
          backendAvailable: false,
          apiKeysConfigured: false,
        },
        metadata: {},
      });
    }
  }

  /**
   * Actualiza el estado de una capa
   */
  setState(layerId: LayerId, state: LayerState, metadata?: Record<string, unknown>): void {
    const diagnostic = this.diagnostics.get(layerId);
    if (!diagnostic) {
      console.warn(`[LayerDiagnostics] Unknown layer: ${layerId}`);
      return;
    }

    diagnostic.state = state;
    if (metadata) {
      diagnostic.metadata = { ...diagnostic.metadata, ...metadata };
    }

    this.notifyListeners();
    this.logStateChange(layerId, state, metadata);
  }

  /**
   * Registra un error para una capa
   */
  recordError(layerId: LayerId, error: Error | string, context?: Record<string, unknown>): void {
    const diagnostic = this.diagnostics.get(layerId);
    if (!diagnostic) {
      console.warn(`[LayerDiagnostics] Unknown layer: ${layerId}`);
      return;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    diagnostic.lastError = errorMessage;
    diagnostic.lastErrorTime = Date.now();
    diagnostic.errorCount += 1;
    diagnostic.state = "error";

    if (context) {
      diagnostic.metadata = { ...diagnostic.metadata, ...context };
    }

    if (errorStack) {
      diagnostic.metadata.errorStack = errorStack;
    }

    this.notifyListeners();
    this.logError(layerId, errorMessage, context);
  }

  /**
   * Actualiza las precondiciones de una capa
   */
  updatePreconditions(
    layerId: LayerId,
    preconditions: Partial<LayerDiagnostic["preconditions"]>
  ): void {
    const diagnostic = this.diagnostics.get(layerId);
    if (!diagnostic) {
      return;
    }

    diagnostic.preconditions = { ...diagnostic.preconditions, ...preconditions };
    this.notifyListeners();
  }

  /**
   * Actualiza el estado de habilitación de una capa
   */
  setEnabled(layerId: LayerId, enabled: boolean): void {
    const diagnostic = this.diagnostics.get(layerId);
    if (!diagnostic) {
      return;
    }

    diagnostic.enabled = enabled;
    if (!enabled) {
      diagnostic.state = "disabled";
    }
    this.notifyListeners();
  }

  /**
   * Registra un intento de inicialización
   */
  recordInitializationAttempt(layerId: LayerId): void {
    const diagnostic = this.diagnostics.get(layerId);
    if (!diagnostic) {
      return;
    }

    diagnostic.initializationAttempts += 1;
    diagnostic.state = "initializing";
    this.notifyListeners();
  }

  /**
   * Registra una actualización de datos exitosa
   */
  recordDataUpdate(layerId: LayerId, featureCount?: number): void {
    const diagnostic = this.diagnostics.get(layerId);
    if (!diagnostic) {
      return;
    }

    diagnostic.lastDataUpdate = Date.now();
    if (diagnostic.state === "ready" || diagnostic.state === "error") {
      diagnostic.state = "ready";
    }

    if (featureCount !== undefined) {
      diagnostic.metadata.featureCount = featureCount;
    }

    this.notifyListeners();
  }

  /**
   * Obtiene el diagnóstico de una capa específica
   */
  getDiagnostic(layerId: LayerId): LayerDiagnostic | undefined {
    return this.diagnostics.get(layerId);
  }

  /**
   * Obtiene todos los diagnósticos
   */
  getAllDiagnostics(): Map<LayerId, LayerDiagnostic> {
    return new Map(this.diagnostics);
  }

  /**
   * Obtiene un resumen de diagnóstico para logging
   */
  getSummary(): string {
    const lines: string[] = ["=== Layer Diagnostics Summary ==="];
    
    for (const [layerId, diagnostic] of this.diagnostics.entries()) {
      const precond = diagnostic.preconditions;
      const issues: string[] = [];

      if (!precond.styleLoaded) issues.push("style not loaded");
      if (!precond.configAvailable) issues.push("config unavailable");
      if (!precond.configEnabled) issues.push("disabled in config");
      if (!precond.backendAvailable) issues.push("backend unavailable");
      if (!precond.apiKeysConfigured) issues.push("API keys missing");

      lines.push(
        `${layerId}: ${diagnostic.state} (enabled: ${diagnostic.enabled}, errors: ${diagnostic.errorCount}, attempts: ${diagnostic.initializationAttempts})`
      );
      
      if (issues.length > 0) {
        lines.push(`  Issues: ${issues.join(", ")}`);
      }
      
      if (diagnostic.lastError) {
        lines.push(`  Last error: ${diagnostic.lastError}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Suscribe un listener para cambios en los diagnósticos
   */
  subscribe(listener: (diagnostics: Map<LayerId, LayerDiagnostic>) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(new Map(this.diagnostics));
      } catch (error) {
        console.error("[LayerDiagnostics] Error in listener:", error);
      }
    }
  }

  private logStateChange(layerId: LayerId, state: LayerState, metadata?: Record<string, unknown>): void {
    const metadataStr = metadata ? ` ${JSON.stringify(metadata)}` : "";
    console.log(`[LayerDiagnostics] ${layerId} -> ${state}${metadataStr}`);
  }

  private logError(layerId: LayerId, errorMessage: string, context?: Record<string, unknown>): void {
    const contextStr = context ? ` ${JSON.stringify(context)}` : "";
    console.error(`[LayerDiagnostics] ${layerId} ERROR: ${errorMessage}${contextStr}`);
  }

  /**
   * Resetea el diagnóstico de una capa (útil para reintentos)
   */
  reset(layerId: LayerId): void {
    const diagnostic = this.diagnostics.get(layerId);
    if (!diagnostic) {
      return;
    }

    diagnostic.state = "not_initialized";
    diagnostic.lastError = null;
    diagnostic.lastErrorTime = null;
    diagnostic.errorCount = 0;
    diagnostic.initializationAttempts = 0;
    diagnostic.lastDataUpdate = null;
    diagnostic.metadata = {};

    this.notifyListeners();
  }
}

// Singleton global
export const layerDiagnostics = new LayerDiagnostics();

// Exponer diagnóstico en window para debugging
if (typeof window !== "undefined") {
  (window as any).layerDiagnostics = layerDiagnostics;
}

