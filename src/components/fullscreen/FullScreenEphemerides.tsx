import React, { useEffect, useState } from 'react';
import { Calendar, Star, ScrollText } from 'lucide-react';
import './FullScreenEphemerides.css';

interface Saint {
    name: string;
    bio?: string;
    image?: string;
}

interface EphemerisItem {
    year: number;
    text: string;
    category: string; // event, birth, death
    thumbnail?: string;
}

interface ApodItem {
    url: string;
    title: string;
}

interface AstroData {
    sunrise: number;
    sunset: number;
    moon_phase: number;
}

type RotationMode = 'EVENT' | 'SAINT' | 'ASTRO'; // New type definition

export const FullScreenEphemerides: React.FC = () => {
    const [date] = useState(new Date());
    const [saints, setSaints] = useState<Saint[]>([]);
    const [events, setEvents] = useState<EphemerisItem[]>([]);
    const [apod, setApod] = useState<ApodItem | null>(null);
    const [astro, setAstro] = useState<AstroData | null>(null);

    // Content Rotation State
    const [mode, setMode] = useState<RotationMode>('ASTRO');
    const [eventIndex, setEventIndex] = useState(0);
    const [saintIndex, setSaintIndex] = useState(0);

    useEffect(() => {
        // Fetch Saints with enriched data
        fetch('/api/saints').then(r => r.json()).then(d => {
            if (Array.isArray(d)) setSaints(d);
        }).catch(console.error);

        // Fetch Ephemerides
        fetch('/api/ephemerides?type=all').then(r => r.json()).then(d => {
            if (d.items) {
                setEvents(d.items.slice(0, 15));
            }
        }).catch(console.error);

        // Fetch APOD
        fetch('/api/ephemerides/apod').then(r => r.json()).then(d => {
            if (d.url && d.media_type === 'image') setApod(d);
        }).catch(console.error);

        // Fetch Astro Data from Weather
        fetch('/api/weather/').then(r => r.json()).then(d => {
            if (d.daily && d.daily[0]) {
                const today = d.daily[0];
                setAstro({
                    sunrise: today.sunrise,
                    sunset: today.sunset,
                    moon_phase: today.moon_phase
                });
            }
        }).catch(console.error);
    }, []);

    // Rotation Logic (Switch Mode)
    useEffect(() => {
        const interval = setInterval(() => {
            setMode(prev => {
                if (prev === 'ASTRO') return 'EVENT';
                if (prev === 'EVENT') return 'SAINT';
                return 'ASTRO';
            });
        }, 12000); // 12s per mode
        return () => clearInterval(interval);
    }, []);

    // Index Rotation
    useEffect(() => {
        const interval = setInterval(() => {
            if (mode === 'EVENT') {
                setEventIndex(prev => (prev + 1) % (events.length || 1));
            } else if (mode === 'SAINT') {
                // Only rotate through first 3 saints (enriched)
                setSaintIndex(prev => (prev + 1) % Math.min(saints.length || 1, 3));
            }
        }, 12000);
        return () => clearInterval(interval);
    }, [mode, events.length, saints.length]);

    const currentEvent = events[eventIndex];
    const currentSaint = saints[saintIndex];

    const getIconForCategory = (cat: string) => {
        if (cat === 'birth') return <Star size={48} className="text-green-400" />;
        if (cat === 'death') return <Star size={48} className="text-stone-400" />;
        return <Calendar size={48} className="text-blue-400" />;
    };

    const getSaintTitle = (name: string) => {
        // Special exclusions or known full names can be handled here if needed
        // Heuristic: If name ends in 'a' (but not common male exceptions), generally 'Santa'.
        // Common male exceptions ending in a:
        const maleExceptions = ['Luca', 'Andrea', 'Bautista', 'Borja', 'Saba'];
        // Common female exceptions not ending in a:
        const femaleExceptions = ['Carmen', 'Paz', 'Luz', 'Merced', 'Dolores', 'Rosario', 'Virtudes', 'Nieves', 'Soledad', 'Pilar', 'Cruz', 'Fe', 'Caridad', 'Esperanza', 'Salud', 'Gracia', 'Asunción', 'Concepción', 'Inés', 'Beatriz', 'Raquel', 'Esther', 'Rut', 'Noemí', 'Iris', 'Belen'];

        const firstWord = name.split(' ')[0];

        // Check if explicitly male or female name known in exceptions
        if (femaleExceptions.includes(firstWord) || femaleExceptions.some(ex => name.includes(ex))) return `Santa ${name}`;
        if (maleExceptions.includes(firstWord)) return `San ${name}`;

        // Heuristic: ends in 'a' -> Santa, else San
        if (firstWord.endsWith('a')) return `Santa ${name}`;
        return `San ${name}`;
    };

    const getMoonPhaseName = (phase: number) => {
        if (phase === 0 || phase === 1) return "Luna Nueva";
        if (phase > 0 && phase < 0.25) return "Luna Creciente";
        if (phase === 0.25) return "Cuarto Creciente";
        if (phase > 0.25 && phase < 0.5) return "Gibosa Creciente";
        if (phase === 0.5) return "Luna Llena";
        if (phase > 0.5 && phase < 0.75) return "Gibosa Menguante";
        if (phase === 0.75) return "Cuarto Menguante";
        return "Luna Menguante";
    };

    const formatTime = (ts: number) => {
        if (!ts) return "--:--";
        return new Date(ts * 1000).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="fs-ephemerides-container" style={{
            backgroundImage: apod ? `linear-gradient(rgba(0,0,0,0.85), rgba(0,0,0,0.85)), url(${apod.url})` : 'linear-gradient(to right, #1e1b4b, #312e81)'
        }}>
            {/* Left Column: Date & Saints List */}
            <div className="fs-col-left">
                <div className="fs-date-block">
                    <Calendar size={64} className="text-yellow-400 mb-4" />
                    <h1 className="fs-day-number">{date.getDate()}</h1>
                    <h2 className="fs-month-name">{date.toLocaleDateString('es-ES', { month: 'long' })}</h2>
                    <h3 className="fs-weekday">{date.toLocaleDateString('es-ES', { weekday: 'long' })}</h3>
                </div>

                <div className="fs-saints-list">
                    <div className="fs-section-title">
                        <Star size={24} className="text-yellow-400" />
                        <span>Santoral</span>
                    </div>
                    <ul>
                        {saints.slice(0, 5).map((s, i) => (
                            <li key={i} className={mode === 'SAINT' && i === saintIndex ? 'active-saint-li' : ''}>
                                {getSaintTitle(s.name)}
                            </li>
                        ))}
                    </ul>
                </div>
            </div>

            {/* Right Column: Spotlight Content */}
            <div className="fs-col-right">

                {mode === 'ASTRO' && astro && (
                    <div className="fs-event-card fade-in bg-astro-card">
                        <div className="fs-card-header">
                            <img src="/assets/img/moon_3d.png" style={{ width: 64, height: 64 }} alt="Moon" />
                            <span className="fs-card-title">Astronomía</span>
                        </div>

                        <div className="fs-astro-content">
                            <div className="astro-row">
                                <div className="astro-item text-center">
                                    <h3 className="text-amber-300">Salida del Sol</h3>
                                    <div className="astro-val-group">
                                        <img src="/assets/img/sunrise_3d.png" style={{ width: 80, height: 80 }} alt="Sunrise" />
                                        <span className="astro-time">{formatTime(astro.sunrise)}</span>
                                    </div>
                                </div>

                                <div className="astro-item text-center">
                                    <h3 className="text-amber-300">Puesta del Sol</h3>
                                    <div className="astro-val-group">
                                        <img src="/assets/img/sunset_3d.png" style={{ width: 80, height: 80 }} alt="Sunset" />
                                        <span className="astro-time">{formatTime(astro.sunset)}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="astro-row mt-4">
                                <div className="astro-item text-center">
                                    <h3 className="text-purple-300">Fase Lunar</h3>
                                    <div className="moon-phase-group">
                                        <img src="/assets/img/moon_3d.png" style={{ width: 100, height: 100 }} alt="Moon Phase" />
                                        <span className="moon-text">{getMoonPhaseName(astro.moon_phase)}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {mode === 'EVENT' && currentEvent && (
                    <div className="fs-event-card fade-in">
                        <div className="fs-card-header">
                            {getIconForCategory(currentEvent.category)}
                            <span className="fs-card-year">{currentEvent.year}</span>
                        </div>
                        <div className="fs-scrollable-text-container">
                            <div className="scroll-wrapper">
                                <p className="fs-card-text">{currentEvent.text}</p>
                            </div>
                        </div>

                        {currentEvent.thumbnail && (
                            <div className="fs-card-image">
                                <img src={currentEvent.thumbnail} alt="Event" />
                            </div>
                        )}
                        <div className="fs-card-label">Tal día como hoy</div>
                    </div>
                )}

                {/* Show Saint if Mode is SAINT OR if Events are empty. Priority to Events if available and mode is EVENT */}
                {((mode === 'SAINT' && currentSaint) || (!currentEvent && currentSaint && mode !== 'ASTRO')) && (
                    <div className="fs-event-card fade-in bg-saint-active-card">
                        <div className="fs-card-header">
                            <Star size={48} className="text-yellow-400" />
                            <span className="fs-card-title">Santoral</span>
                        </div>
                        <h2 className="fs-saint-title">{getSaintTitle(currentSaint.name)}</h2>

                        <div className="fs-scrollable-text-container saint-bio">
                            <div className="scroll-wrapper">
                                {currentSaint.bio || `Hoy celebramos la santidad de ${getSaintTitle(currentSaint.name)}...`}
                            </div>
                        </div>

                        {currentSaint.image ? (
                            <div className="fs-card-image saint-img-wrapper">
                                <img src={currentSaint.image} alt={currentSaint.name} />
                            </div>
                        ) : (
                            <div className="fs-card-image placeholder">
                                <ScrollText size={64} className="text-slate-600" />
                            </div>
                        )}
                    </div>
                )}

                {!currentEvent && !currentSaint && !astro && (
                    <div className="fs-loading">Cargando datos...</div>
                )}
            </div>

        </div>
    );
};
