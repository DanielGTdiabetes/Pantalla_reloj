import { useState, useEffect } from "react";

type TransportType = "plane" | "ship";

interface TransportItem {
    id: string;
    name: string;
    type: TransportType;
    speed?: number; // km/h
    altitude?: number; // meters (planes)
    heading?: number;
    lat: number;
    lon: number;
    detail: string;
    img?: string | null;
}

interface TransportData {
    planes: any[];
    ships: any[];
}

interface TransportCardProps {
    data: TransportData | null;
}

// Fallback icon URLs from GitHub if local icons fail
const FALLBACK_ICONS = {
    plane: "https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Travel%20and%20places/Airplane.png",
    ship: "https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Travel%20and%20places/Passenger%20Ship.png",
    scan: "https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Objects/Satellite%20Antenna.png"
};

// Local icon paths
const LOCAL_ICONS = {
    plane: "/img/icons/3d/plane.png",
    ship: "/img/icons/3d/ship.png"
};

export const TransportCard = ({ data }: TransportCardProps) => {
    const [activeTab, setActiveTab] = useState<TransportType>("plane");
    const [currentIndex, setCurrentIndex] = useState(0);
    const [iconError, setIconError] = useState<Record<string, boolean>>({});

    // Helper to get icon with fallback
    const getIcon = (type: "plane" | "ship") => {
        if (iconError[type]) {
            return FALLBACK_ICONS[type];
        }
        return LOCAL_ICONS[type];
    };

    // Normalize data
    const planes: TransportItem[] = (data?.planes || []).map((p: any) => ({
        id: p.ic || Math.random().toString(),
        name: p.cs || p.ic || "Sin Distintivo",
        type: "plane" as TransportType,
        speed: p.spd ? Math.round(p.spd * 3.6) : undefined,
        altitude: p.alt ? Math.round(p.alt) : undefined,
        heading: p.hdg,
        lat: p.lat,
        lon: p.lon,
        detail: p.co || 'País desconocido',
        img: p.img
    }));

    const ships: TransportItem[] = (data?.ships || []).map((s: any) => ({
        id: String(s.mmsi),
        name: s.name || s.mmsi || "Navío Desconocido",
        type: "ship" as TransportType,
        speed: s.spd ? Math.round(s.spd * 1.852) : undefined,
        heading: s.hdg,
        lat: s.lat,
        lon: s.lon,
        detail: s.dest || s.type || "Destino desconocido",
        img: null
    }));

    const hasPlanes = planes.length > 0;
    const hasShips = ships.length > 0;

    // Auto-switch modes logic
    useEffect(() => {
        if (!hasPlanes && hasShips) setActiveTab("ship");
        else if (hasPlanes && !hasShips) setActiveTab("plane");
        else if (hasPlanes && hasShips) {
            const modeInterval = setInterval(() => {
                setActiveTab(prev => prev === "plane" ? "ship" : "plane");
                setCurrentIndex(0);
            }, 12000);
            return () => clearInterval(modeInterval);
        }
    }, [hasPlanes, hasShips]);

    const currentItems = activeTab === "plane" ? planes : ships;

    // Rotate items within current mode
    useEffect(() => {
        if (currentItems.length <= 1) return;
        const interval = setInterval(() => {
            setCurrentIndex(prev => (prev + 1) % currentItems.length);
        }, 6000);
        return () => clearInterval(interval);
    }, [currentItems.length, activeTab]);

    // Scanning state - no data
    if (!hasPlanes && !hasShips) {
        return (
            <div className="transport-card transport-card--scanning">
                <div className="transport-card__glow transport-card__glow--cyan" />
                <div className="transport-card__glow transport-card__glow--purple" />

                <div className="transport-card__content transport-card__content--center">
                    <img
                        src={FALLBACK_ICONS.scan}
                        alt="Escaneando"
                        className="transport-card__scan-icon"
                    />
                    <h2 className="transport-card__scan-title">Escaneando</h2>
                    <p className="transport-card__scan-subtitle">Buscando tráfico aéreo y marítimo...</p>
                </div>
            </div>
        );
    }

    const currentItem = currentItems[currentIndex] || currentItems[0];

    // Dispatch highlight event
    useEffect(() => {
        if (!currentItem) return;
        const event = new CustomEvent("pantalla:map:highlight", {
            detail: {
                id: currentItem.id,
                type: currentItem.type,
                lat: currentItem.lat,
                lon: currentItem.lon
            }
        });
        window.dispatchEvent(event);
    }, [currentItem]);

    if (!currentItem) return null;

    const isPlane = currentItem.type === "plane";
    const bgClass = isPlane ? "transport-card--plane" : "transport-card--ship";
    const displayIconUrl = currentItem.img || getIcon(isPlane ? "plane" : "ship");

    return (
        <div className={`transport-card ${bgClass}`}>
            {/* Glow effects */}
            <div className="transport-card__glow transport-card__glow--primary" />
            <div className="transport-card__glow transport-card__glow--secondary" />

            {/* Header */}
            <header className="transport-card__header">
                <div className="transport-card__header-left">
                    <span className="transport-card__label">
                        {isPlane ? "✈️ Tráfico Aéreo" : "🚢 Tráfico Marítimo"}
                    </span>
                    <span className="transport-card__counter">
                        {currentIndex + 1} / {currentItems.length}
                    </span>
                </div>
                <img
                    src={getIcon(isPlane ? "plane" : "ship")}
                    alt={isPlane ? "Avión" : "Barco"}
                    className="transport-card__header-icon"
                    onError={() => setIconError(prev => ({ ...prev, [isPlane ? "plane" : "ship"]: true }))}
                />
            </header>

            {/* Main content */}
            <main className="transport-card__main" key={currentItem.id}>
                {/* Vehicle image/icon */}
                <div className="transport-card__visual">
                    <div className="transport-card__visual-glow" />
                    {currentItem.img ? (
                        <div className="transport-card__photo">
                            <img
                                src={displayIconUrl}
                                alt={currentItem.name}
                                className="transport-card__photo-img"
                            />
                        </div>
                    ) : (
                        <img
                            src={displayIconUrl}
                            alt={currentItem.name}
                            className="transport-card__icon-large"
                            onError={() => setIconError(prev => ({ ...prev, [isPlane ? "plane" : "ship"]: true }))}
                        />
                    )}
                </div>

                {/* Vehicle name */}
                <h1 className="transport-card__name">{currentItem.name}</h1>
                <p className="transport-card__detail">{currentItem.detail}</p>
            </main>

            {/* Stats footer */}
            <footer className="transport-card__footer">
                <div className="transport-card__stat">
                    <span className="transport-card__stat-label">Velocidad</span>
                    <span className="transport-card__stat-value">
                        {currentItem.speed ?? "--"} <small>km/h</small>
                    </span>
                </div>
                <div className="transport-card__stat">
                    <span className="transport-card__stat-label">
                        {isPlane ? "Altitud" : "Rumbo"}
                    </span>
                    <span className="transport-card__stat-value">
                        {isPlane
                            ? (currentItem.altitude ? `${currentItem.altitude}m` : "--")
                            : (currentItem.heading != null ? `${Math.round(currentItem.heading)}°` : "--")
                        }
                    </span>
                </div>
                <div className="transport-card__stat">
                    <span className="transport-card__stat-label">Posición</span>
                    <span className="transport-card__stat-value transport-card__stat-value--mono">
                        {currentItem.lat?.toFixed(2) ?? "--"}, {currentItem.lon?.toFixed(2) ?? "--"}
                    </span>
                </div>
            </footer>

            <style>{`
                .transport-card {
                    display: flex;
                    flex-direction: column;
                    width: 100%;
                    height: 100%;
                    border-radius: 1.5rem;
                    overflow: hidden;
                    position: relative;
                    color: white;
                    font-family: system-ui, -apple-system, sans-serif;
                }

                .transport-card--plane {
                    background: linear-gradient(135deg, #1e40af 0%, #312e81 100%);
                }

                .transport-card--ship {
                    background: linear-gradient(135deg, #0d9488 0%, #064e3b 100%);
                }

                .transport-card--scanning {
                    background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
                    border: 1px solid rgba(255,255,255,0.1);
                }

                .transport-card__glow {
                    position: absolute;
                    border-radius: 50%;
                    filter: blur(60px);
                    pointer-events: none;
                    opacity: 0.3;
                }

                .transport-card__glow--primary {
                    width: 200px;
                    height: 200px;
                    top: -50px;
                    right: -50px;
                    background: rgba(255,255,255,0.2);
                }

                .transport-card__glow--secondary {
                    width: 150px;
                    height: 150px;
                    bottom: -30px;
                    left: -30px;
                    background: rgba(255,255,255,0.15);
                }

                .transport-card__glow--cyan {
                    width: 120px;
                    height: 120px;
                    top: 20%;
                    left: 10%;
                    background: #22d3ee;
                }

                .transport-card__glow--purple {
                    width: 100px;
                    height: 100px;
                    bottom: 20%;
                    right: 10%;
                    background: #a855f7;
                }

                /* Header */
                .transport-card__header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 1rem 1.25rem;
                    position: relative;
                    z-index: 10;
                }

                .transport-card__header-left {
                    display: flex;
                    flex-direction: column;
                    gap: 0.25rem;
                }

                .transport-card__label {
                    font-size: 0.75rem;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.15em;
                    opacity: 0.9;
                }

                .transport-card__counter {
                    font-size: 0.625rem;
                    font-family: monospace;
                    opacity: 0.6;
                }

                .transport-card__header-icon {
                    width: 48px;
                    height: 48px;
                    object-fit: contain;
                    filter: drop-shadow(0 4px 8px rgba(0,0,0,0.3));
                    animation: float 4s ease-in-out infinite;
                }

                /* Main */
                .transport-card__main {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 0.5rem 1.25rem;
                    position: relative;
                    z-index: 10;
                    animation: fadeInUp 0.4s ease-out;
                }

                .transport-card__visual {
                    position: relative;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin-bottom: 0.75rem;
                }

                .transport-card__visual-glow {
                    position: absolute;
                    width: 140px;
                    height: 140px;
                    background: rgba(255,255,255,0.15);
                    border-radius: 50%;
                    filter: blur(40px);
                    animation: pulse 3s ease-in-out infinite;
                }

                .transport-card__icon-large {
                    width: auto;
                    height: 100px;
                    max-width: 140px;
                    object-fit: contain;
                    filter: drop-shadow(0 8px 16px rgba(0,0,0,0.4));
                    animation: float 5s ease-in-out infinite;
                    position: relative;
                    z-index: 1;
                }

                .transport-card__photo {
                    width: 180px;
                    height: 100px;
                    border-radius: 0.75rem;
                    overflow: hidden;
                    border: 2px solid rgba(255,255,255,0.2);
                    box-shadow: 0 8px 24px rgba(0,0,0,0.3);
                }

                .transport-card__photo-img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                }

                .transport-card__name {
                    font-size: 1.5rem;
                    font-weight: 800;
                    text-align: center;
                    margin: 0;
                    text-shadow: 0 2px 8px rgba(0,0,0,0.3);
                    line-height: 1.2;
                }

                .transport-card__detail {
                    font-size: 0.7rem;
                    text-transform: uppercase;
                    letter-spacing: 0.1em;
                    opacity: 0.7;
                    margin: 0.25rem 0 0;
                }

                /* Footer */
                .transport-card__footer {
                    display: grid;
                    grid-template-columns: repeat(3, 1fr);
                    gap: 0.5rem;
                    padding: 0.75rem 1rem;
                    background: rgba(0,0,0,0.2);
                    backdrop-filter: blur(8px);
                    border-top: 1px solid rgba(255,255,255,0.1);
                    position: relative;
                    z-index: 10;
                }

                .transport-card__stat {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    text-align: center;
                }

                .transport-card__stat-label {
                    font-size: 0.5rem;
                    text-transform: uppercase;
                    letter-spacing: 0.1em;
                    opacity: 0.5;
                    font-weight: 600;
                }

                .transport-card__stat-value {
                    font-size: 0.875rem;
                    font-weight: 700;
                }

                .transport-card__stat-value small {
                    font-size: 0.5rem;
                    opacity: 0.7;
                }

                .transport-card__stat-value--mono {
                    font-family: monospace;
                    font-size: 0.625rem;
                }

                /* Scanning state */
                .transport-card__content--center {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 2rem;
                    position: relative;
                    z-index: 10;
                }

                .transport-card__scan-icon {
                    width: 80px;
                    height: 80px;
                    margin-bottom: 1rem;
                    animation: pulse 2s ease-in-out infinite;
                    opacity: 0.7;
                }

                .transport-card__scan-title {
                    font-size: 1.25rem;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.2em;
                    margin: 0;
                    opacity: 0.8;
                }

                .transport-card__scan-subtitle {
                    font-size: 0.625rem;
                    font-family: monospace;
                    opacity: 0.5;
                    margin: 0.5rem 0 0;
                }

                /* Animations */
                @keyframes float {
                    0%, 100% { transform: translateY(0) rotate(0deg); }
                    50% { transform: translateY(-6px) rotate(2deg); }
                }

                @keyframes pulse {
                    0%, 100% { opacity: 0.3; transform: scale(1); }
                    50% { opacity: 0.6; transform: scale(1.05); }
                }

                @keyframes fadeInUp {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </div>
    );
};
