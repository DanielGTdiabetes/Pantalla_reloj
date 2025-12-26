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
            <div className="fs-weather-main column-mode">
                <div className="current-weather-row">
                    <div className="fs-temp-group">
                        <span className="fs-temp-val">{temp}°</span>
                        <div className="fs-cond-group">
                            {/* Icon Logic based on simple keyword matching for now */}
                            <img
                                src={condition.toLowerCase().includes('lluvia') || condition.toLowerCase().includes('llovizna') ? '/assets/img/rain_3d.png' : '/assets/img/sun_3d.png'}
                                className="fs-weather-icon-3d"
                                alt="Weather Icon"
                            />
                            <h1 className="fs-condition">{condition}</h1>
                        </div>
                    </div>
                </div>

                <div className="fs-weather-grid compact">
                    <div className="fs-weather-item">
                        <Wind size={32} />
                        <span className="fs-val">{wind} <span className="fs-unit">km/h</span></span>
                    </div>
                    <div className="fs-weather-item">
                        <Droplet size={32} />
                        <span className="fs-val">{hum} <span className="fs-unit">%</span></span>
                    </div>
                    <div className="fs-weather-item">
                        <Thermometer size={32} />
                        <span className="fs-val">{Math.round(weather.feels_like?.value || temp)}°</span>
                    </div>
                </div>

                {weather.days && weather.days.length > 0 && (
                    <div className="fs-forecast-row">
                        {weather.days.slice(1, 6).map((day: any, i: number) => (
                            <div key={i} className="fs-forecast-day">
                                <span className="day-name">{day.dayName.slice(0, 3)}</span>
                                <div className="day-icon"><CloudSun size={24} /></div>
                                <div className="day-temps">
                                    <span className="max">{Math.round(day.temperature.max)}°</span>
                                    <span className="min">{Math.round(day.temperature.min)}°</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
