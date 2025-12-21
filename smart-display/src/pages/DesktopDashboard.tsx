import React, { useState, useEffect } from 'react';
import {
    CloudSun,
    Wind,
    Droplet,
    Plane,
    Ship,
    Calendar as CalendarIcon,
    Zap,
    CloudRain,
    AlertTriangle
} from 'lucide-react';
import Map, { Source, Layer, NavigationControl } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { InfoWidget } from '../components/dashboard/InfoWidget';
import { InfotainmentWidget } from '../components/dashboard/InfotainmentWidget';
import './DesktopDashboard.css';

export const DesktopDashboard: React.FC = () => {
    const [time, setTime] = useState(new Date());

    // Data State
    const [weather, setWeather] = useState<any>(null);
    const [alerts, setAlerts] = useState<any[]>([]);
    const [lightningCount, setLightningCount] = useState<number>(0);
    const [transport, setTransport] = useState<{ planes: number, ships: number }>({ planes: 0, ships: 0 });

    // Fetch Cycles
    useEffect(() => {
        const timer = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        const fetchData = async () => {
            try {
                // 1. Weather
                const weatherRes = await fetch('/api/weather/');
                if (weatherRes.ok) {
                    const data = await weatherRes.json();
                    if (data.ok) setWeather(data);
                }

                // 2. Alerts (CAP)
                const alertsRes = await fetch('/api/weather/alerts');
                if (alertsRes.ok) {
                    const data = await alertsRes.json();
                    // Extract features for ticker
                    if (data.features) {
                        setAlerts(data.features.map((f: any) => ({
                            severity: f.properties.severity,
                            headline: f.properties.headline,
                            source: f.properties.source
                        })));
                    }
                }

                // 3. Lightning status
                const lightningRes = await fetch('/api/weather/lightning');
                if (lightningRes.ok) {
                    const data = await lightningRes.json();
                    if (data.features) setLightningCount(data.features.length);
                }

                // 4. Transport Counts
                const transportRes = await fetch('/api/transport/nearby?radius_km=100');
                if (transportRes.ok) {
                    const data = await transportRes.json();
                    if (data.ok) {
                        setTransport({
                            planes: data.planes?.length || 0,
                            ships: data.ships?.length || 0
                        });
                    }
                }

            } catch (e) {
                console.error("Dashboard fetch error:", e);
            }
        };

        fetchData(); // Initial
        const interval = setInterval(fetchData, 60000); // Every minute
        return () => clearInterval(interval);
    }, []);

    // Helper to format temperature
    const tempValue = weather?.temperature?.value ? Math.round(weather.temperature.value) : '--';
    const condition = weather?.summary || 'Cargando...';
    const windSpeed = weather?.wind_speed ? `${Math.round(weather.wind_speed)} km/h` : '--';
    const humidity = weather?.humidity ? `${Math.round(weather.humidity)}%` : '--';

    return (
        <div className="dashboard-container">

            {/* Layer 0: Full Screen Map with Layers */}
            <div className="map-background">
                <Map
                    initialViewState={{
                        longitude: 2.1734, // Barcelona default
                        latitude: 41.3851,
                        zoom: 11
                    }}
                    style={{ width: '100%', height: '100%' }}
                    mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
                    attributionControl={false}
                    dragPan={true}
                    scrollZoom={true}
                    doubleClickZoom={true}
                >
                    <NavigationControl position="bottom-right" showCompass={true} />
                    {/* RainViewer Layer (Precipitation) */}
                    <Source
                        id="rainviewer"
                        type="raster"
                        tiles={[`https://tile.cache.rainviewer.com/v2/radar/nowcast_loop/512/{z}/{x}/{y}/4/1_1.png`]}
                        tileSize={512}
                    >
                        <Layer
                            id="rain-layer"
                            type="raster"
                            paint={{ "raster-opacity": 0.6 }}
                            beforeId="place_label_city" // Put rain below labels
                        />
                    </Source>
                </Map>
            </div>

            {/* Layer 1: HUD Overlay */}
            <div className="hud-overlay">

                {/* Top Section */}
                <div className="hud-top">

                    {/* Top Left: Clock & Date & Alerts */}
                    <div className="top-left-group">
                        <div className="widget-clock">
                            <span className="clock-huge">
                                {time.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <span className="date-large">
                                {time.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}
                            </span>
                        </div>

                        {/* Alerts positioned right below clock */}
                        <div className="alerts-ticker">
                            {alerts.length > 0 ? (
                                alerts.map((alert, idx) => (
                                    <div key={idx} className={`alert-item ${alert.severity === 'extreme' || alert.severity === 'severe' ? 'high-severity' : 'warning-severity'}`}>
                                        <AlertTriangle size={16} />
                                        <span>{alert.headline}</span>
                                    </div>
                                ))
                            ) : (
                                // Conditional Lightning Alert if significant
                                lightningCount > 0 && (
                                    <div className="alert-item warning-severity">
                                        <Zap size={16} />
                                        <span>Rayos detectados: {lightningCount} en zona</span>
                                    </div>
                                )
                            )}
                        </div>

                        {/* Daily Infotainment (Saints, History, NASA) */}
                        <InfotainmentWidget />
                    </div>

                    {/* Top Right: Weather */}
                    <div className="widget-weather">
                        <CloudSun size={48} className="text-sky-400" />
                        <div className="weather-value-group">
                            <span className="weather-temp">{tempValue}°</span>
                        </div>
                        <div className="weather-details">
                            <span className="weather-desc">{condition}</span>
                            <div className="weather-meta">
                                <span className="flex items-center gap-1"><Wind size={14} /> {windSpeed}</span>
                                <span className="flex items-center gap-1"><Droplet size={14} /> {humidity}</span>
                                {lightningCount > 0 && (
                                    <span className="flex items-center gap-1 text-yellow-400"><Zap size={14} /> {lightningCount}</span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Bottom Section: Info Strip */}
                <div className="hud-bottom">
                    <InfoWidget
                        icon={CloudRain}
                        label="Lluvia"
                        value="0 mm"
                        subtext="Próx. hora"
                        color="#60a5fa"
                    />
                    <InfoWidget
                        icon={Plane}
                        label="Tráfico Aéreo"
                        value={transport.planes.toString()}
                        subtext="Vuelos cercanos"
                        color="#38bdf8"
                    />
                    <InfoWidget
                        icon={Ship}
                        label="Tráfico Marítimo"
                        value={transport.ships.toString()}
                        subtext="Buques en rango"
                        color="#4ade80"
                    />
                    <InfoWidget
                        icon={CalendarIcon}
                        label="Próximo Evento"
                        value="--"
                        subtext="Sin eventos"
                        color="#facc15"
                    />
                </div>

            </div>
        </div>
    );
};
