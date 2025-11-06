import React, { useEffect, useState } from "react";

import { withConfigDefaultsV2 } from "../config/defaults_v2";
import {
  getConfigV2,
  getOpenSkyStatus,
  saveConfigV2,
  testAemetApiKey,
  testCalendarConnection,
  type WiFiNetwork,
  wifiConnect,
  wifiDisconnect,
  wifiNetworks,
  wifiScan,
  wifiStatus,
} from "../lib/api";
import type { AppConfigV2 } from "../types/config_v2";

export const ConfigPage: React.FC = () => {
  // Estado general
  const [config, setConfig] = useState<AppConfigV2 | null>(null);
  const [loading, setLoading] = useState(true);

  // Grupo 1: WiFi
  const [wifiNetworksList, setWifiNetworksList] = useState<WiFiNetwork[]>([]);
  const [wifiNetworksCount, setWifiNetworksCount] = useState(0);
  const [wifiScanning, setWifiScanning] = useState(false);
  const [wifiScanError, setWifiScanError] = useState<string | null>(null);
  const [wifiStatusData, setWifiStatusData] = useState<{
    interface: string;
    connected: boolean;
    ssid: string | null;
    ip_address: string | null;
    signal: number | null;
  } | null>(null);
  const [wifiSaving, setWifiSaving] = useState(false);

  // Grupo 2: Mapas y Capas
  const [mapAndLayersSaving, setMapAndLayersSaving] = useState(false);
  const [aemetTestResult, setAemetTestResult] = useState<{ ok: boolean; reason?: string } | null>(null);
  const [aemetTesting, setAemetTesting] = useState(false);
  const [aemetApiKey, setAemetApiKey] = useState<string>("");
  const [openskyStatus, setOpenskyStatus] = useState<any>(null);

  // Grupo 3: Panel Rotativo
  const [panelRotatorSaving, setPanelRotatorSaving] = useState(false);
  const [calendarTestResult, setCalendarTestResult] = useState<{ ok: boolean; message?: string; reason?: string } | null>(null);
  const [calendarTesting, setCalendarTesting] = useState(false);

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        setLoading(true);
        const loadedConfig = await getConfigV2();
        setConfig(withConfigDefaultsV2(loadedConfig));

        // Cargar estado WiFi
        const status = await wifiStatus();
        setWifiStatusData(status);

        // Cargar redes WiFi guardadas
        const networksResponse = await wifiNetworks();
        setWifiNetworksList(networksResponse.networks);
        setWifiNetworksCount(networksResponse.count);

        // Cargar estado OpenSky
        try {
          const opensky = await getOpenSkyStatus();
          setOpenskyStatus(opensky);
        } catch (error) {
          console.error("Error loading OpenSky status:", error);
        }
      } catch (error) {
        console.error("Error loading initial data:", error);
      } finally {
        setLoading(false);
      }
    };

    loadInitialData();
  }, []);

  // ===== GRUPO 1: WiFi =====
  const handleWifiScan = async () => {
    setWifiScanning(true);
    setWifiScanError(null);

    try {
      const scanResponse = await wifiScan();
      
      if (scanResponse.ok) {
        const networksResponse = await wifiNetworks();
        setWifiNetworksList(networksResponse.networks);
        setWifiNetworksCount(networksResponse.count);
        
        if (networksResponse.count === 0) {
          setWifiScanError("No se han encontrado redes. Reintenta o acerca el equipo al AP.");
        }
      } else {
        setWifiScanError("No se pudo completar el escaneo de redes WiFi. Inténtalo de nuevo.");
        const networksResponse = await wifiNetworks();
        setWifiNetworksList(networksResponse.networks);
        setWifiNetworksCount(networksResponse.count);
      }
    } catch (error) {
      setWifiScanError("No se pudo completar el escaneo de redes WiFi. Inténtalo de nuevo.");
      console.error("Error scanning WiFi:", error);
    } finally {
      setWifiScanning(false);
    }
  };

  const handleWifiConnect = async (ssid: string, password?: string) => {
    try {
      await wifiConnect({ ssid, password });
      const status = await wifiStatus();
      setWifiStatusData(status);
      
      const networksResponse = await wifiNetworks();
      setWifiNetworksList(networksResponse.networks);
      setWifiNetworksCount(networksResponse.count);
    } catch (error) {
      console.error("Error connecting to WiFi:", error);
      alert("Error al conectar a la red. Inténtalo de nuevo.");
    }
  };

  const handleWifiDisconnect = async () => {
    try {
      await wifiDisconnect();
      const status = await wifiStatus();
      setWifiStatusData(status);
    } catch (error) {
      console.error("Error disconnecting WiFi:", error);
      alert("Error al desconectar. Inténtalo de nuevo.");
    }
  };

  const handleSaveWifi = async () => {
    // WiFi no guarda configuración, solo conecta/desconecta
    // Este botón puede ser útil para operaciones futuras
    setWifiSaving(true);
    try {
      // Recargar estado
      const status = await wifiStatus();
      setWifiStatusData(status);
      alert("Estado WiFi actualizado");
    } catch (error) {
      console.error("Error:", error);
      alert("Error al actualizar estado WiFi");
    } finally {
      setWifiSaving(false);
    }
  };

  // ===== GRUPO 2: Mapas y Capas =====
  const handleTestAemet = async () => {
    setAemetTesting(true);
    setAemetTestResult(null);
    try {
      const result = await testAemetApiKey(aemetApiKey || undefined);
      setAemetTestResult(result || { ok: false, reason: "Sin respuesta" });
    } catch (error) {
      setAemetTestResult({ ok: false, reason: "Error al probar la API key" });
      console.error("Error testing AEMET:", error);
    } finally {
      setAemetTesting(false);
    }
  };

  const handleSaveMapAndLayers = async () => {
    if (!config) return;
    
    setMapAndLayersSaving(true);
    try {
      const configToSave: AppConfigV2 = {
        ...config,
        ui_map: config.ui_map,
        ui_global: config.ui_global,
        layers: config.layers,
      };
      
      await saveConfigV2(configToSave);
      alert("Configuración de Mapas y Capas guardada correctamente");
    } catch (error) {
      console.error("Error saving map and layers:", error);
      alert("Error al guardar la configuración");
    } finally {
      setMapAndLayersSaving(false);
    }
  };

  // ===== GRUPO 3: Panel Rotativo =====
  const handleTestCalendar = async () => {
    setCalendarTesting(true);
    setCalendarTestResult(null);
    try {
      const result = await testCalendarConnection();
      setCalendarTestResult(result || { ok: false, reason: "Sin respuesta" });
    } catch (error) {
      setCalendarTestResult({ ok: false, reason: "Error al probar la conexión del calendario" });
      console.error("Error testing calendar:", error);
    } finally {
      setCalendarTesting(false);
    }
  };

  const handleSavePanelRotator = async () => {
    if (!config) return;
    
    setPanelRotatorSaving(true);
    try {
      const configToSave: AppConfigV2 = {
        ...config,
        panels: config.panels,
        ui_global: {
          ...config.ui_global,
          overlay: config.ui_global?.overlay,
        },
      };
      
      await saveConfigV2(configToSave);
      alert("Configuración del Panel Rotativo guardada correctamente");
    } catch (error) {
      console.error("Error saving panel rotator:", error);
      alert("Error al guardar la configuración");
    } finally {
      setPanelRotatorSaving(false);
    }
  };

  if (loading || !config) {
    return (
      <div className="config-page">
        <div className="config-page__container">
          <p>Cargando configuración...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="config-page">
      <div className="config-page__container">
        <div className="config-page__header">
          <h1>Configuración</h1>
          <p>Gestiona la configuración del sistema</p>
        </div>

        {/* GRUPO 1: WiFi */}
        <div className="config-card">
          <h2>WiFi</h2>
          
          {wifiStatusData && (
            <div className="config-status">
              <p>
                Estado: {wifiStatusData.connected ? "Conectado" : "Desconectado"}
                {wifiStatusData.connected && wifiStatusData.ssid && (
                  <span className="config-badge config-badge--success">
                    {wifiStatusData.ssid}
                  </span>
                )}
              </p>
              {wifiStatusData.ip_address && (
                <p>IP: {wifiStatusData.ip_address}</p>
              )}
              {wifiStatusData.connected && (
                <button
                  className="config-button"
                  onClick={handleWifiDisconnect}
                  style={{ marginTop: "12px" }}
                >
                  Desconectar
                </button>
              )}
            </div>
          )}

          <div className="config-field">
            <label>Escaneo de Redes</label>
            <div className="config-field__actions">
              <button
                className="config-button primary"
                onClick={handleWifiScan}
                disabled={wifiScanning}
              >
                {wifiScanning ? "Escaneando..." : "Buscar redes"}
              </button>
              {wifiScanError && (
                <button
                  className="config-button"
                  onClick={handleWifiScan}
                  disabled={wifiScanning}
                >
                  Reintentar
                </button>
              )}
            </div>
            {wifiScanError && (
              <div className="config-error-callout" style={{ marginTop: "12px" }}>
                <p>{wifiScanError}</p>
              </div>
            )}
          </div>

          <div className="config-table" style={{ marginTop: "12px" }}>
            <div className="config-table__header">
              <span>Redes disponibles ({wifiNetworksCount})</span>
            </div>
            {wifiNetworksList.length > 0 ? (
              wifiNetworksList.map((network) => (
                <div key={network.ssid} className="config-table__row">
                  <div>
                    <strong>{network.ssid}</strong>
                    <span className="config-badge" style={{ marginLeft: "8px" }}>
                      {network.signal}%
                    </span>
                    {network.security && network.security !== "--" && (
                      <span className="config-badge config-badge--warning" style={{ marginLeft: "4px" }}>
                        {network.security}
                      </span>
                    )}
                  </div>
                  <button
                    className="config-button"
                    onClick={() => {
                      const password = prompt(
                        network.security && network.security !== "--"
                          ? `Ingresa la contraseña para ${network.ssid}:`
                          : `¿Conectar a ${network.ssid}? (sin contraseña)`
                      );
                      if (password !== null) {
                        handleWifiConnect(network.ssid, password || undefined);
                      }
                    }}
                  >
                    Conectar
                  </button>
                </div>
              ))
            ) : (
              !wifiScanning && (
                <p className="config-status">No hay redes disponibles</p>
              )
            )}
          </div>

          <div className="config-actions" style={{ marginTop: "24px" }}>
            <button
              className="config-button primary"
              onClick={handleSaveWifi}
              disabled={wifiSaving}
            >
              {wifiSaving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>

        {/* GRUPO 2: Mapas y Capas */}
        <div className="config-card">
          <h2>Mapas y Capas</h2>

          <div className="config-form-fields">
            {/* Configuración del Mapa */}
            <div className="config-field">
              <label>Proveedor del Mapa</label>
              <select
                value={config.ui_map.provider}
                onChange={(e) => {
                  setConfig({
                    ...config,
                    ui_map: {
                      ...config.ui_map,
                      provider: e.target.value as any,
                    },
                  });
                }}
              >
                <option value="local_raster_xyz">XYZ Local</option>
                <option value="maptiler_vector">MapTiler Vector</option>
                <option value="custom_xyz">XYZ Personalizado</option>
              </select>
            </div>

            {config.ui_map.provider === "maptiler_vector" && (
              <div className="config-field">
                <label>MapTiler API Key</label>
                <div className="config-field__secret">
                  <input
                    type="text"
                    value={config.ui_map.maptiler?.apiKey || ""}
                    onChange={(e) => {
                      setConfig({
                        ...config,
                        ui_map: {
                          ...config.ui_map,
                          maptiler: {
                            ...config.ui_map.maptiler,
                            apiKey: e.target.value || null,
                            styleUrl: config.ui_map.maptiler?.styleUrl || null,
                          },
                        },
                      });
                    }}
                    placeholder="API Key de MapTiler"
                  />
                  <button
                    className="config-button"
                    onClick={() => {
                      // Test para MapTiler (si existe función)
                      alert("Test de MapTiler aún no implementado");
                    }}
                  >
                    Test
                  </button>
                </div>
              </div>
            )}

            {config.ui_map.provider === "custom_xyz" && (
              <div className="config-field">
                <label>URL de Tiles Personalizado</label>
                <input
                  type="text"
                  value={config.ui_map.customXyz?.tileUrl || ""}
                  onChange={(e) => {
                    setConfig({
                      ...config,
                      ui_map: {
                        ...config.ui_map,
                        customXyz: {
                          ...config.ui_map.customXyz!,
                          tileUrl: e.target.value || null,
                        },
                      },
                    });
                  }}
                  placeholder="https://example.com/{z}/{x}/{y}.png"
                />
              </div>
            )}

            {/* Capa Radar */}
            <div className="config-field">
              <label>
                <input
                  type="checkbox"
                  checked={config.ui_global?.radar?.enabled || false}
                  onChange={(e) => {
                    setConfig({
                      ...config,
                      ui_global: {
                        ...config.ui_global,
                        radar: {
                          ...config.ui_global?.radar,
                          enabled: e.target.checked,
                          provider: config.ui_global?.radar?.provider || "rainviewer",
                        },
                      },
                    });
                  }}
                />
                Habilitar Radar
              </label>
              {config.ui_global?.radar?.enabled && (
                <div className="config-field" style={{ marginLeft: "24px", marginTop: "8px" }}>
                  <label>Proveedor</label>
                  <select
                    value={config.ui_global.radar.provider || "rainviewer"}
                    onChange={(e) => {
                      setConfig({
                        ...config,
                        ui_global: {
                          ...config.ui_global,
                          radar: {
                            enabled: config.ui_global?.radar?.enabled || false,
                            provider: e.target.value as any,
                          },
                        },
                      });
                    }}
                  >
                    <option value="rainviewer">RainViewer</option>
                    <option value="aemet">AEMET</option>
                  </select>
                  {config.ui_global.radar.provider === "aemet" && (
                    <div className="config-field" style={{ marginTop: "12px" }}>
                      <label>AEMET API Key</label>
                      <div className="config-field__secret">
                        <input
                          type="text"
                          value={aemetApiKey}
                          onChange={(e) => setAemetApiKey(e.target.value)}
                          placeholder="API Key de AEMET"
                        />
                        <button
                          className="config-button"
                          onClick={handleTestAemet}
                          disabled={aemetTesting}
                        >
                          {aemetTesting ? "Probando..." : "Test"}
                        </button>
                      </div>
                      {aemetTestResult && (
                        <div
                          className={`config-field__hint ${
                            aemetTestResult.ok ? "config-field__hint--success" : "config-field__hint--error"
                          }`}
                        >
                          {aemetTestResult.ok
                            ? "✓ API Key válida"
                            : `✗ Error: ${aemetTestResult.reason || "Desconocido"}`}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Capa Satélite */}
            <div className="config-field">
              <label>
                <input
                  type="checkbox"
                  checked={config.ui_global?.satellite?.enabled || false}
                  onChange={(e) => {
                    setConfig({
                      ...config,
                      ui_global: {
                        ...config.ui_global,
                        satellite: {
                          ...config.ui_global?.satellite,
                          enabled: e.target.checked,
                          provider: config.ui_global?.satellite?.provider || "gibs",
                          opacity: config.ui_global?.satellite?.opacity || 1.0,
                        },
                      },
                    });
                  }}
                />
                Habilitar Satélite
              </label>
            </div>

            {/* Capa Vuelos */}
            <div className="config-field">
              <label>
                <input
                  type="checkbox"
                  checked={config.layers?.flights?.enabled || false}
                  onChange={(e) => {
                    setConfig({
                      ...config,
                      layers: {
                        ...config.layers,
                        flights: {
                          enabled: e.target.checked,
                          provider: config.layers?.flights?.provider || "opensky",
                          refresh_seconds: config.layers?.flights?.refresh_seconds || 12,
                          max_age_seconds: config.layers?.flights?.max_age_seconds || 120,
                          max_items_global: config.layers?.flights?.max_items_global || 2000,
                          max_items_view: config.layers?.flights?.max_items_view || 1500,
                          rate_limit_per_min: config.layers?.flights?.rate_limit_per_min || 6,
                          decimate: config.layers?.flights?.decimate || "none",
                          grid_px: config.layers?.flights?.grid_px || 24,
                          styleScale: config.layers?.flights?.styleScale || 3.2,
                          render_mode: config.layers?.flights?.render_mode || "circle",
                        },
                      },
                    });
                  }}
                />
                Habilitar Capa de Vuelos
              </label>
              {config.layers?.flights?.enabled && (
                <div className="config-field" style={{ marginLeft: "24px", marginTop: "8px" }}>
                  <label>Proveedor</label>
                  <select
                    value={config.layers.flights.provider || "opensky"}
                    onChange={(e) => {
                      setConfig({
                        ...config,
                      layers: {
                        ...config.layers,
                        flights: {
                          ...config.layers?.flights,
                          enabled: config.layers?.flights?.enabled || false,
                          provider: e.target.value as any,
                          refresh_seconds: config.layers?.flights?.refresh_seconds || 12,
                          max_age_seconds: config.layers?.flights?.max_age_seconds || 120,
                          max_items_global: config.layers?.flights?.max_items_global || 2000,
                          max_items_view: config.layers?.flights?.max_items_view || 1500,
                          rate_limit_per_min: config.layers?.flights?.rate_limit_per_min || 6,
                          decimate: config.layers?.flights?.decimate || "none",
                          grid_px: config.layers?.flights?.grid_px || 24,
                          styleScale: config.layers?.flights?.styleScale || 3.2,
                          render_mode: config.layers?.flights?.render_mode || "circle",
                        },
                      },
                      });
                    }}
                  >
                    <option value="opensky">OpenSky</option>
                    <option value="aviationstack">AviationStack</option>
                    <option value="custom">Personalizado</option>
                  </select>
                  {config.layers.flights.provider === "opensky" && openskyStatus && (
                    <div className="config-status" style={{ marginTop: "8px" }}>
                      <p>Estado: {openskyStatus.status || "desconocido"}</p>
                      {openskyStatus.items_count !== null && (
                        <p>Vuelos: {openskyStatus.items_count}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Capa Barcos */}
            <div className="config-field">
              <label>
                <input
                  type="checkbox"
                  checked={config.layers?.ships?.enabled || false}
                  onChange={(e) => {
                    setConfig({
                      ...config,
                      layers: {
                        ...config.layers,
                        ships: {
                          enabled: e.target.checked,
                          provider: config.layers?.ships?.provider || "aisstream",
                          refresh_seconds: config.layers?.ships?.refresh_seconds || 10,
                          max_age_seconds: config.layers?.ships?.max_age_seconds || 180,
                          max_items_global: config.layers?.ships?.max_items_global || 1500,
                          max_items_view: config.layers?.ships?.max_items_view || 420,
                          decimate: config.layers?.ships?.decimate || "grid",
                          grid_px: config.layers?.ships?.grid_px || 24,
                          styleScale: config.layers?.ships?.styleScale || 1.4,
                        },
                      },
                    });
                  }}
                />
                Habilitar Capa de Barcos
              </label>
            </div>
          </div>

          <div className="config-actions" style={{ marginTop: "24px" }}>
            <button
              className="config-button primary"
              onClick={handleSaveMapAndLayers}
              disabled={mapAndLayersSaving}
            >
              {mapAndLayersSaving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>

        {/* GRUPO 3: Panel Rotativo */}
        <div className="config-card">
          <h2>Panel Rotativo</h2>

          <div className="config-form-fields">
            <div className="config-field">
              <label>
                <input
                  type="checkbox"
                  checked={config.ui_global?.overlay?.rotator?.enabled || false}
                  onChange={(e) => {
                    setConfig({
                      ...config,
                      ui_global: {
                        ...config.ui_global,
                        overlay: {
                          ...config.ui_global?.overlay,
                          rotator: {
                            ...config.ui_global?.overlay?.rotator,
                            enabled: e.target.checked,
                            order: config.ui_global?.overlay?.rotator?.order || [],
                            transition_ms: config.ui_global?.overlay?.rotator?.transition_ms || 300,
                            pause_on_alert: config.ui_global?.overlay?.rotator?.pause_on_alert || false,
                          },
                        },
                      },
                    });
                  }}
                />
                Habilitar Rotación
              </label>
            </div>

            {config.ui_global?.overlay?.rotator?.enabled && (
              <>
                <div className="config-field">
                  <label>Tiempo de Transición (ms)</label>
                  <input
                    type="number"
                    value={config.ui_global.overlay.rotator.transition_ms || 300}
                    onChange={(e) => {
                      setConfig({
                        ...config,
                        ui_global: {
                          ...config.ui_global,
                          overlay: {
                            ...config.ui_global?.overlay,
                            rotator: {
                              ...config.ui_global?.overlay?.rotator!,
                              transition_ms: parseInt(e.target.value) || 300,
                            },
                          },
                        },
                      });
                    }}
                    min="100"
                    max="5000"
                  />
                </div>

                <div className="config-field">
                  <label>
                    <input
                      type="checkbox"
                      checked={config.ui_global?.overlay?.rotator?.pause_on_alert || false}
                      onChange={(e) => {
                        setConfig({
                          ...config,
                          ui_global: {
                            ...config.ui_global,
                            overlay: {
                              ...config.ui_global?.overlay,
                              rotator: {
                                ...config.ui_global?.overlay?.rotator!,
                                pause_on_alert: e.target.checked,
                              },
                            },
                          },
                        });
                      }}
                    />
                    Pausar en Alertas
                  </label>
                </div>
              </>
            )}

            {/* Panel Noticias */}
            <div className="config-field">
              <label>
                <input
                  type="checkbox"
                  checked={config.panels?.news?.enabled || false}
                  onChange={(e) => {
                    setConfig({
                      ...config,
                      panels: {
                        ...config.panels,
                        news: {
                          enabled: e.target.checked,
                          feeds: config.panels?.news?.feeds || [],
                        },
                      },
                    });
                  }}
                />
                Habilitar Panel de Noticias
              </label>
              {config.panels?.news?.enabled && (
                <div className="config-field" style={{ marginLeft: "24px", marginTop: "8px" }}>
                  <label>Feeds RSS (uno por línea)</label>
                  <textarea
                    value={(config.panels.news.feeds || []).join("\n")}
                    onChange={(e) => {
                      const feeds = e.target.value
                        .split("\n")
                        .map((f) => f.trim())
                        .filter((f) => f.length > 0);
                      setConfig({
                        ...config,
                        panels: {
                          ...config.panels,
                          news: {
                            enabled: config.panels?.news?.enabled || false,
                            feeds,
                          },
                        },
                      });
                    }}
                    placeholder="https://www.example.com/rss"
                  />
                  <button
                    className="config-button"
                    onClick={() => {
                      // Test de feeds RSS (si existe función)
                      alert("Test de feeds RSS aún no implementado");
                    }}
                    style={{ marginTop: "8px" }}
                  >
                    Test Feeds
                  </button>
                </div>
              )}
            </div>

            {/* Panel Calendario */}
            <div className="config-field">
              <label>
                <input
                  type="checkbox"
                  checked={config.panels?.calendar?.enabled || false}
                  onChange={(e) => {
                    setConfig({
                      ...config,
                      panels: {
                        ...config.panels,
                        calendar: {
                          enabled: e.target.checked,
                          provider: config.panels?.calendar?.provider || "ics",
                        },
                      },
                    });
                  }}
                />
                Habilitar Panel de Calendario
              </label>
              {config.panels?.calendar?.enabled && (
                <div className="config-field" style={{ marginLeft: "24px", marginTop: "8px" }}>
                  <label>Proveedor</label>
                  <select
                    value={config.panels.calendar.provider || "ics"}
                    onChange={(e) => {
                      setConfig({
                        ...config,
                        panels: {
                          ...config.panels,
                        calendar: {
                          enabled: config.panels?.calendar?.enabled || false,
                          provider: e.target.value as any,
                        },
                        },
                      });
                    }}
                  >
                    <option value="ics">ICS</option>
                    <option value="google">Google Calendar</option>
                    <option value="disabled">Deshabilitado</option>
                  </select>
                  <button
                    className="config-button"
                    onClick={handleTestCalendar}
                    disabled={calendarTesting}
                    style={{ marginTop: "8px" }}
                  >
                    {calendarTesting ? "Probando..." : "Test Calendario"}
                  </button>
                  {calendarTestResult && (
                    <div
                      className={`config-field__hint ${
                        calendarTestResult.ok ? "config-field__hint--success" : "config-field__hint--error"
                      }`}
                    >
                      {calendarTestResult.ok
                        ? `✓ ${calendarTestResult.message || "Conexión exitosa"}`
                        : `✗ Error: ${calendarTestResult.reason || "Desconocido"}`}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Panel Efemérides */}
            <div className="config-field">
              <label>
                <input
                  type="checkbox"
                  checked={config.panels?.ephemerides?.enabled || false}
                  onChange={(e) => {
                    setConfig({
                      ...config,
                      panels: {
                        ...config.panels,
                        ephemerides: {
                          ...config.panels?.ephemerides,
                          enabled: e.target.checked,
                        },
                      },
                    });
                  }}
                />
                Habilitar Panel de Efemérides
              </label>
            </div>

            {/* Panel Clima Semanal */}
            <div className="config-field">
              <label>
                <input
                  type="checkbox"
                  checked={config.panels?.weatherWeekly?.enabled || false}
                  onChange={(e) => {
                    setConfig({
                      ...config,
                      panels: {
                        ...config.panels,
                        weatherWeekly: {
                          ...config.panels?.weatherWeekly,
                          enabled: e.target.checked,
                        },
                      },
                    });
                  }}
                />
                Habilitar Panel de Clima Semanal
              </label>
            </div>
          </div>

          <div className="config-actions" style={{ marginTop: "24px" }}>
            <button
              className="config-button primary"
              onClick={handleSavePanelRotator}
              disabled={panelRotatorSaving}
            >
              {panelRotatorSaving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};