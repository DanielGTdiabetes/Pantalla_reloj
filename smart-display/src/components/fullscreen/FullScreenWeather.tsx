import React, { useEffect, useState } from 'react';
import { CloudSun, Wind, Droplet, Thermometer } from 'lucide-react';
import './FullScreenWeather.css';

export const FullScreenWeather: React.FC = () => {
    const [weather, setWeather] = useState<any>(null);

    useEffect(() => {
        fetch('/api/weather/').then(r => r.json()).then(d => {
            if (d.ok) setWeather(d);
        }).catch(console.error);
    }, []);

    if (!weather) return <div className="fs-loading">Cargando tiempo...</div>;

    if (weather.ok === false) {
        return (
            <div className="fs-weather-container error">
                <div className="fs-weather-main">
                    <CloudSun size={120} className="fs-weather-icon text-red-400" />
                    <h1 className="fs-condition">Error: {weather.reason}</h1>
                    <p style={{ fontSize: '1.5rem', opacity: 0.7 }}>{weather.error || weather.summary || "Verifica tu API Key"}</p>
                </div>
            </div>
        );
    }

    const temp = weather.temperature?.value ? Math.round(weather.temperature.value) : '--';
    const condition = weather.summary || 'Despejado';
    const wind = weather.wind_speed ? Math.round(weather.wind_speed) : 0;
    const hum = weather.humidity ? Math.round(weather.humidity) : 0;

    return (
        <div className="fs-weather-container">
            <div className="fs-weather-main">
                <div className="fs-temp-group">
                    <span className="fs-temp-val">{temp}°</span>
                    <CloudSun size={120} className="fs-weather-icon" />
                </div>
                <h1 className="fs-condition">{condition}</h1>
            </div>

            <div className="fs-weather-grid">
                <div className="fs-weather-item">
                    <Wind size={40} />
                    <span className="fs-val">{wind} <span className="fs-unit">km/h</span></span>
                    <span className="fs-label">Viento</span>
                </div>
                <div className="fs-weather-item">
                    <Droplet size={40} />
                    <span className="fs-val">{hum} <span className="fs-unit">%</span></span>
                    <span className="fs-label">Humedad</span>
                </div>
                <div className="fs-weather-item">
                    <Thermometer size={40} />
                    <span className="fs-val">{Math.round(weather.feels_like?.value || temp)}°</span>
                    <span className="fs-label">Sensación</span>
                </div>
            </div>
        </div>
    );
};
