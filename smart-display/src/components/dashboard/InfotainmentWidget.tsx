import React, { useEffect, useState } from 'react';
import { BookOpen, Star, Rocket, Sprout, Leaf } from 'lucide-react';
import './InfotainmentWidget.css';

interface Saint {
    name: string;
    image?: string;
}

interface EphemerisItem {
    year: number;
    text: string;
    thumbnail?: string;
}

interface ApodItem {
    title: string;
    url: string;
    explanation: string;
    media_type: string;
}

interface FarmingData {
    month: number;
    fruits: string[];
    vegetables: string[];
    sowing: string[];
}

type Mode = 'saints' | 'ephemeris' | 'apod' | 'season';

export const InfotainmentWidget: React.FC = () => {
    const [mode, setMode] = useState<Mode>('saints');
    const [saints, setSaints] = useState<Saint[]>([]);
    const [ephemeris, setEphemeris] = useState<EphemerisItem[]>([]);
    const [apod, setApod] = useState<ApodItem | null>(null);
    const [farming, setFarming] = useState<FarmingData | null>(null);
    const [loading, setLoading] = useState(true);
    const [index, setIndex] = useState(0); // For rotating items within a category

    useEffect(() => {
        fetchAll();
        const cycleTimer = setInterval(rotateMode, 15000); // 15s per mode
        return () => clearInterval(cycleTimer);
    }, []);

    const fetchAll = async () => {
        setLoading(true);
        try {
            // 1. Saints
            fetch('/api/saints').then(res => res.json()).then(data => {
                if (Array.isArray(data)) setSaints(data);
            }).catch(e => console.error(e));

            // 2. Ephemeris (Events)
            fetch('/api/ephemerides?type=events').then(res => res.json()).then(data => {
                if (data.items) {
                    // Randomize or pick top 5
                    setEphemeris(data.items.slice(0, 5));
                }
            }).catch(e => console.error(e));

            // 3. APOD
            fetch('/api/ephemerides/apod').then(res => res.json()).then(data => {
                if (!data.error && data.media_type === 'image') setApod(data);
            }).catch(e => console.error(e));

            // 4. Farming / Seasonal Food
            fetch('/api/farming/current').then(res => res.json()).then(data => {
                if (data.month) setFarming(data);
            }).catch(e => console.error(e));

        } finally {
            setLoading(false);
        }
    };

    const rotateMode = () => {
        setMode(prev => {
            if (prev === 'saints') return 'ephemeris';
            if (prev === 'ephemeris') return 'season';
            if (prev === 'season') return 'apod';
            return 'saints';
        });
        setIndex(prev => prev + 1); // Logic to rotate internal items too?
    };

    const renderSaints = () => {
        if (!saints.length) return <div className="info-empty">No hay datos de santoral</div>;
        // Rotate through saints if multiple
        const currentSaint = saints[index % saints.length];

        return (
            <div className="info-content saint-mode">
                <div className="info-header">
                    <Star size={16} className="text-yellow-400" />
                    <span>Santoral de Hoy</span>
                </div>
                <div className="saint-body">
                    {currentSaint.image && <img src={currentSaint.image} alt={currentSaint.name} className="saint-img" />}
                    <span className="saint-name">{currentSaint.name}</span>
                </div>
            </div>
        );
    };

    const renderEphemeris = () => {
        if (!ephemeris.length) return <div className="info-empty">Sin efemérides hoy</div>;
        const item = ephemeris[index % ephemeris.length];

        return (
            <div className="info-content ephemeris-mode">
                <div className="info-header">
                    <BookOpen size={16} className="text-blue-400" />
                    <span>Tal día como hoy...</span>
                </div>
                <div className="ephemeris-body">
                    <span className="ephemeris-year">{item.year}</span>
                    <p className="ephemeris-text">{item.text}</p>
                </div>
            </div>
        );
    };

    const renderApod = () => {
        if (!apod) return <div className="info-empty">Sin Foto NASA</div>;

        return (
            <div className="info-content apod-mode" style={{ backgroundImage: `linear-gradient(rgba(0,0,0,0.7), rgba(0,0,0,0.7)), url(${apod.url})` }}>
                <div className="info-header">
                    <Rocket size={16} className="text-red-400" />
                    <span>NASA Foto del Día</span>
                </div>
                <div className="apod-body">
                    <span className="apod-title">{apod.title}</span>
                </div>
            </div>
        );
    };

    const renderSeason = () => {
        if (!farming) return <div className="info-empty">Sin datos de cultivo</div>;

        // Rotate between Fruits, Vegetables, Sowing
        const subModes = ['fruits', 'vegetables', 'sowing'];
        const currentSubMode = subModes[index % 3]; // Rotate every time component updates (15s) logic is shared with index

        let title = "";
        let icon = <Leaf size={16} className="text-green-400" />;
        let items: string[] = [];

        if (currentSubMode === 'fruits') {
            title = "Frutas de Temporada";
            items = farming.fruits;
        } else if (currentSubMode === 'vegetables') {
            title = "Verduras del Mes";
            items = farming.vegetables;
        } else {
            title = "Siembra este Mes";
            icon = <Sprout size={16} className="text-emerald-400" />;
            items = farming.sowing;
        }

        // Limit display to 5-6 items to avoid overflow, or scroll?
        // Let's just join them for now or list fewer
        const displayItems = items.length > 0 ? items : ["Nada específico"];

        return (
            <div className="info-content season-mode">
                <div className="info-header">
                    {icon}
                    <span>{title}</span>
                </div>
                <div className="season-body">
                    <div className="season-tags">
                        {displayItems.map((item, i) => (
                            <span key={i} className="season-tag">{item}</span>
                        ))}
                    </div>
                </div>
            </div>
        );
    };

    if (loading) return null;

    return (
        <div className="infotainment-widget">
            {mode === 'saints' && renderSaints()}
            {mode === 'ephemeris' && renderEphemeris()}
            {mode === 'season' && renderSeason()}
            {mode === 'apod' && renderApod()}

            <div className="info-progress-bar">
                <div className={`progress-dot ${mode === 'saints' ? 'active' : ''}`} />
                <div className={`progress-dot ${mode === 'ephemeris' ? 'active' : ''}`} />
                <div className={`progress-dot ${mode === 'season' ? 'active' : ''}`} />
                <div className={`progress-dot ${mode === 'apod' ? 'active' : ''}`} />
            </div>
        </div>
    );
};
