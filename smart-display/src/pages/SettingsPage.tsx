
import React, { useState, useEffect } from 'react';
import {
    Wifi,
    Lock,
    Save,
    RefreshCw,
    CheckCircle,
    Clock
} from 'lucide-react';
import './SettingsPage.css';

interface WifiNetwork {
    ssid: string;
    strength: number;
    security: string;
    active: boolean;
}

interface ApiKeyStatus {
    [key: string]: boolean;
}

const API_KEYS_LABELS: { [key: string]: string } = {
    "meteoblue_api_key": "Meteoblue Weather",
    "openweathermap_api_key": "OpenWeatherMap",
    "maptiler_key": "MapTiler (Maps)",
    "opensky_username": "OpenSky Username",
    "opensky_password": "OpenSky Password",
    "aisstream_api_key": "AIS Stream (Ships)"
};

export const SettingsPage: React.FC = () => {
    // State
    const [networks, setNetworks] = useState<WifiNetwork[]>([]);
    const [scanning, setScanning] = useState(false);
    const [connectingSsid, setConnectingSsid] = useState<string | null>(null);
    const [wifiPassword, setWifiPassword] = useState("");

    const [keysStatus, setKeysStatus] = useState<ApiKeyStatus>({});
    const [keyInputs, setKeyInputs] = useState<{ [key: string]: string }>({});
    const [savingKeys, setSavingKeys] = useState(false);

    // Config State
    const [displayConfig, setDisplayConfig] = useState<any>({ module_cycle_seconds: 20, news_feeds: [] });
    const [newFeed, setNewFeed] = useState("");

    // Initial Load
    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        // Load Secrets Status
        try {
            const res = await fetch('/api/system/secrets');
            const data = await res.json();
            setKeysStatus(data);
        } catch (e) { console.error(e); }

        // Load WiFi
        try {
            const res = await fetch('/api/system/wifi/scan');
            if (res.ok) {
                const data = await res.json();
                setNetworks(data);
            }
        } catch (e) {
            console.error("WiFi Scan error", e);
            // Mock if fail
            setNetworks([
                { ssid: 'Error_Scan', strength: 0, security: 'None', active: false }
            ]);
        }

        // Load Config
        try {
            fetch('/api/system/config/display')
                .then(r => r.json())
                .then(d => {
                    setDisplayConfig({
                        module_cycle_seconds: d.module_cycle_seconds || 20,
                        news_feeds: d.news_feeds || []
                    });
                })
                .catch(e => console.error(e));
        } catch (e) { }
    };

    const handleSaveConfig = async () => {
        try {
            await fetch('/api/system/config/display', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(displayConfig)
            });
            alert("Configuración de Pantalla guardada");
        } catch (e) {
            alert("Error al guardar config");
        }
    };

    const addFeed = () => {
        if (!newFeed.trim()) return;
        setDisplayConfig((prev: any) => ({
            ...prev,
            news_feeds: [...(prev.news_feeds || []), newFeed.trim()]
        }));
        setNewFeed("");
    };

    const removeFeed = (idx: number) => {
        setDisplayConfig((prev: any) => ({
            ...prev,
            news_feeds: prev.news_feeds.filter((_: any, i: number) => i !== idx)
        }));
    };

    const scanWifi = async () => {
        setScanning(true);
        try {
            const res = await fetch('/api/system/wifi/scan');
            if (res.ok) {
                const data = await res.json();
                setNetworks(data);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setScanning(false);
        }
    };

    const fetchKeysStatus = async () => {
        try {
            const res = await fetch('/api/system/secrets');
            if (res.ok) {
                const data = await res.json();
                setKeysStatus(data);
            }
        } catch (e) {
            console.error(e);
        }
    };

    const handleConnect = async () => {
        if (!connectingSsid) return;
        try {
            const res = await fetch('/api/system/wifi/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ssid: connectingSsid, password: wifiPassword })
            });
            if (res.ok) {
                alert(`Conectado a ${connectingSsid} `);
                setConnectingSsid(null);
                setWifiPassword("");
                scanWifi();
            } else {
                alert("Error al conectar");
            }
        } catch (e) {
            alert("Error de conexión");
        }
    };

    const handleSaveKeys = async () => {
        setSavingKeys(true);
        try {
            const res = await fetch('/api/system/secrets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items: keyInputs })
            });
            if (res.ok) {
                setKeyInputs({});
                fetchKeysStatus();
                alert("Claves guardadas correctamente");
            }
        } catch (e) {
            alert("Error al guardar claves");
        } finally {
            setSavingKeys(false);
        }
    };

    return (
        <div className="settings-container">
            <h1 className="settings-title">Configuración del Sistema</h1>

            <div className="settings-grid">
                {/* WiFi Column */}
                <div className="settings-card">
                    <div className="card-header">
                        <Wifi size={24} />
                        <h2>Conexión WiFi</h2>
                        <button onClick={scanWifi} className="icon-btn" disabled={scanning}>
                            <RefreshCw size={20} className={scanning ? 'spin' : ''} />
                        </button>
                    </div>

                    <div className="wifi-list">
                        {networks.length === 0 && !scanning && <p className="empty-msg">No se encontraron redes</p>}
                        {networks.map((net, idx) => (
                            <div key={idx} className={`wifi-item ${net.active ? 'active' : ''} `} onClick={() => setConnectingSsid(net.ssid)}>
                                <div className="wifi-info">
                                    <span className="wifi-ssid">{net.ssid}</span>
                                    <span className="wifi-meta">{net.security} • {net.strength}%</span>
                                </div>
                                {net.active && <CheckCircle size={18} className="text-green-400" />}
                            </div>
                        ))}
                    </div>

                    {connectingSsid && (
                        <div className="wifi-modal">
                            <h3>Conectar a {connectingSsid}</h3>
                            <input
                                type="password"
                                placeholder="Contraseña WiFi"
                                value={wifiPassword}
                                onChange={e => setWifiPassword(e.target.value)}
                            />
                            <div className="modal-actions">
                                <button onClick={() => setConnectingSsid(null)}>Cancelar</button>
                                <button className="primary" onClick={handleConnect}>Conectar</button>
                            </div>
                        </div>
                    )}
                </div>

                {/* API Keys Column */}
                <div className="settings-card">
                    <div className="section-header">
                        <Clock size={20} className="text-yellow-400" />
                        <h2>Pantalla y Noticias</h2>
                    </div>
                    <div className="settings-card">
                        <div className="form-group">
                            <label>Tiempo por pantalla (segundos)</label>
                            <div className="input-row">
                                <input
                                    type="number"
                                    value={displayConfig.module_cycle_seconds}
                                    onChange={(e) => setDisplayConfig({ ...displayConfig, module_cycle_seconds: parseInt(e.target.value) })}
                                    className="secret-input"
                                />
                            </div>
                        </div>

                        <div className="form-group" style={{ marginTop: '1rem' }}>
                            <label>Fuentes RSS de Noticias</label>
                            <div className="input-row">
                                <input
                                    type="text"
                                    placeholder="https://ejemplo.com/rss"
                                    value={newFeed}
                                    onChange={e => setNewFeed(e.target.value)}
                                    className="secret-input"
                                />
                                <button className="connect-btn" onClick={addFeed}>Añadir</button>
                            </div>
                            <div className="feeds-list" style={{ marginTop: '0.5rem', maxHeight: '150px', overflowY: 'auto' }}>
                                {(displayConfig.news_feeds || []).map((feed: string, idx: number) => (
                                    <div key={idx} className="feed-item" style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', background: 'rgba(255,255,255,0.05)', marginBottom: '4px', borderRadius: '4px' }}>
                                        <span style={{ fontSize: '0.8rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{feed}</span>
                                        <button onClick={() => removeFeed(idx)} style={{ color: 'red', border: 'none', background: 'none', cursor: 'pointer' }}>×</button>
                                    </div>
                                ))}
                            </div>
                            <button className="primary full-width" onClick={handleSaveConfig} style={{ marginTop: '1rem' }}>
                                <Save size={16} /> Guardar Configuración Pantalla
                            </button>
                        </div>
                    </div>

                    <div className="section-header">
                        <Lock size={20} className="text-red-400" />
                        <h2>Claves API y Calendario</h2>
                    </div>
                    <p className="card-desc">Introduce las claves para activar los servicios.</p>

                    <div className="keys-list">
                        {/* Manually add Calendar First */}
                        <div className="key-item">
                            <div className="key-label-row">
                                <span className="key-label">Calendario ICS (URL Pública)</span>
                                {keysStatus["calendar_ics_url"] ?
                                    <span className="status-badge set">Configurado</span> :
                                    <span className="status-badge missing">Falta</span>
                                }
                            </div>
                            <input
                                type="text"
                                placeholder={keysStatus["calendar_ics_url"] ? "URL Oculta (Escriba para cambiar)" : "https://calendar.google.com/..."}
                                value={keyInputs["calendar_ics_url"] || ""}
                                onChange={e => setKeyInputs(prev => ({ ...prev, "calendar_ics_url": e.target.value }))}
                            />
                        </div>

                        {Object.entries(API_KEYS_LABELS).map(([key, label]) => (
                            <div key={key} className="key-item">
                                <div className="key-label-row">
                                    <span className="key-label">{label}</span>
                                    {keysStatus[key] ?
                                        <span className="status-badge set">Configurado</span> :
                                        <span className="status-badge missing">Falta</span>
                                    }
                                </div>
                                <input
                                    type="password"
                                    placeholder={keysStatus[key] ? "••••••••••••" : "Introduce clave..."}
                                    value={keyInputs[key] || ""}
                                    onChange={e => setKeyInputs(prev => ({ ...prev, [key]: e.target.value }))}
                                />
                            </div>
                        ))}
                    </div>

                    <div className="card-footer">
                        <button className="primary full-width" onClick={handleSaveKeys} disabled={savingKeys}>
                            {savingKeys ? 'Guardando...' : 'Guardar Claves API'} <Save size={18} style={{ marginLeft: 8 }} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
