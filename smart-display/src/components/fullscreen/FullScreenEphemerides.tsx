import React, { useEffect, useState } from 'react';
import { Calendar, Star, UserPlus, Skull, Globe } from 'lucide-react';
import './FullScreenEphemerides.css';

interface Saint {
    name: string;
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

export const FullScreenEphemerides: React.FC = () => {
    const [date] = useState(new Date());
    const [saints, setSaints] = useState<Saint[]>([]);
    const [events, setEvents] = useState<EphemerisItem[]>([]);
    const [apod, setApod] = useState<ApodItem | null>(null);
    const [eventIndex, setEventIndex] = useState(0);

    useEffect(() => {
        // Fetch Saints
        fetch('/api/saints').then(r => r.json()).then(d => {
            if (Array.isArray(d)) setSaints(d);
        }).catch(console.error);

        // Fetch Ephemerides
        fetch('/api/ephemerides?type=all').then(r => r.json()).then(d => {
            if (d.items) {
                // Shuffle or pick interesting ones? Let's take first 10
                setEvents(d.items.slice(0, 10));
            }
        }).catch(console.error);

        // Fetch APOD
        fetch('/api/ephemerides/apod').then(r => r.json()).then(d => {
            if (d.url && d.media_type === 'image') setApod(d);
        }).catch(console.error);
    }, []);

    // Rotate events every 8 seconds
    useEffect(() => {
        const interval = setInterval(() => {
            setEventIndex(prev => (prev + 1) % (events.length || 1));
        }, 8000);
        return () => clearInterval(interval);
    }, [events.length]);

    const currentEvent = events[eventIndex];

    const getIconForCategory = (cat: string) => {
        if (cat === 'birth') return <UserPlus size={48} className="text-green-400" />;
        if (cat === 'death') return <Skull size={48} className="text-stone-400" />;
        return <Globe size={48} className="text-blue-400" />;
    };

    return (
        <div className="fs-ephemerides-container" style={{
            backgroundImage: apod ? `linear-gradient(rgba(0,0,0,0.85), rgba(0,0,0,0.85)), url(${apod.url})` : 'linear-gradient(to right, #1e1b4b, #312e81)'
        }}>
            {/* Left Column: Date & Saints */}
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
                            <li key={i}>{s.name}</li>
                        ))}
                    </ul>
                </div>
            </div>

            {/* Right Column: Spotlight Event */}
            <div className="fs-col-right">
                {currentEvent ? (
                    <div className="fs-event-card key={currentEvent.text}"> {/* Force re-render for anim */}
                        <div className="fs-event-year">
                            {getIconForCategory(currentEvent.category)}
                            <span>{currentEvent.year}</span>
                        </div>
                        <p className="fs-event-text">{currentEvent.text}</p>

                        {currentEvent.thumbnail && (
                            <div className="fs-event-image">
                                <img src={currentEvent.thumbnail} alt="Event" />
                            </div>
                        )}

                        <div className="fs-event-progress">
                            {events.map((_, i) => (
                                <div key={i} className={`fs-progress-dot ${i === eventIndex ? 'active' : ''}`} />
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className="fs-loading">Cargando historia...</div>
                )}
            </div>

            {/* APOD Credit if visible */}
            {apod && <div className="fs-apod-credit">Foto de fondo: {apod.title} (NASA)</div>}
        </div>
    );
};
