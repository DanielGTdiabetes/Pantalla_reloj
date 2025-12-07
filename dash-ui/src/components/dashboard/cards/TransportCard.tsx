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

const get3DIcon = (type: TransportType) => {
    const baseUrl = "https://raw.githubusercontent.com/Tarikul-Islam-Anik/Animated-Fluent-Emojis/master/Emojis/Travel%20and%20places/";
    if (type === "plane") return `${baseUrl}Airplane.png`;
    if (type === "ship") return `${baseUrl}Passenger%20Ship.png`;
    return `${baseUrl}Rocket.png`;
};

export const TransportCard = ({ data }: TransportCardProps) => {
    const [activeTab, setActiveTab] = useState<TransportType>("plane");
    const [currentIndex, setCurrentIndex] = useState(0);

    // Normalize data
    const planes: TransportItem[] = (data?.planes || []).map((p: any) => ({
        id: p.ic || Math.random().toString(),
        name: p.cs || p.ic || "Sin Distintivo",
        type: "plane",
        speed: p.spd ? Math.round(p.spd * 3.6) : undefined, // m/s to km/h usually
        altitude: p.alt ? Math.round(p.alt) : undefined,
        heading: p.hdg,
        lat: p.lat,
        lon: p.lon,
        detail: `${p.op || 'Operador Desconocido'}`,
        img: p.img
    }));

    const ships: TransportItem[] = (data?.ships || []).map((s: any) => ({
        id: String(s.mmsi),
        name: s.name || s.mmsi || "Navío Desconocido",
        type: "ship",
        speed: s.spd ? Math.round(s.spd * 1.852) : undefined, // knots to km/h
        heading: s.hdg,
        lat: s.lat,
        lon: s.lon,
        detail: s.type_txt || s.type || "Carguero",
        img: null // Ships images not currently fetched
    }));

    const hasPlanes = planes.length > 0;
    const hasShips = ships.length > 0;

    // Auto-switch modes logic
    useEffect(() => {
        if (!hasPlanes && hasShips) setActiveTab("ship");
        else if (hasPlanes && !hasShips) setActiveTab("plane");
        else if (hasPlanes && hasShips) {
            // Rotate mode every 12s if both exist
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
        }, 6000); // 6s per item
        return () => clearInterval(interval);
    }, [currentItems.length, activeTab]);

    if (!hasPlanes && !hasShips) {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center bg-black/40 p-6 text-white text-center rounded-xl border border-white/10 backdrop-blur-sm">
                <div className="text-6xl mb-4 animate-pulse opacity-50 grayscale">📡</div>
                <h2 className="text-xl font-bold opacity-80 uppercase tracking-widest">Escaneando</h2>
                <p className="text-xs opacity-50 mt-2 font-mono">Buscando tráfico aéreo y marítimo...</p>
            </div>
        );
    }

    const currentItem = currentItems[currentIndex] || currentItems[0];

    // Dispatch highlight event when item changes
    useEffect(() => {
        if (!currentItem) return;

        const event = new CustomEvent("pantalla:map:highlight", {
            detail: {
                id: currentItem.id,
                type: currentItem.type, // 'plane' | 'ship'
                lat: currentItem.lat,
                lon: currentItem.lon
            }
        });
        window.dispatchEvent(event);

        return () => {
            // Optional: dispatch clear event on unmount or change? 
            // We can just rely on the next event replacing it, 
            // or dispatch null if component unmounts.
            // For now, let's leave the last highlight or let the map handle timeout.
        };
    }, [currentItem]);

    if (!currentItem) return null;

    const isPlane = currentItem.type === "plane";
    const title = isPlane ? "Tráfico Aéreo" : "Tráfico Marítimo";
    const subtitle = isPlane ? "Vuelos en tiempo real" : "Buques en tiempo real";

    // Header icon specific to type
    const headerIcon = <img
        src={isPlane ? "/img/icons/3d/plane.png" : "/img/icons/3d/ship.png"}
        className="w-8 h-8 drop-shadow-md animate-bounce-slow"
        alt="transport"
    />;

    // Background gradient based on type
    const bgClass = isPlane
        ? "bg-gradient-to-br from-blue-600 to-indigo-900"
        : "bg-gradient-to-br from-teal-600 to-emerald-900";

    const displayIconUrl = currentItem.img || (isPlane ? "/img/icons/3d/plane.png" : "/img/icons/3d/ship.png");
    const hasPhoto = !!currentItem.img;

    return (
        <StandardCard
            title={title}
            subtitle={subtitle}
            icon={headerIcon}
            className={`${bgClass} relative overflow-hidden`}
        >
            {/* Subtle Pattern Overlay */}
            <div className="absolute inset-0 opacity-10 bg-[url('/img/noise.png')] mix-blend-overlay pointer-events-none" />

            {/* Map/Radar background effect hint */}
            <div className="absolute inset-0 z-0 opacity-20">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white/10 via-transparent to-transparent animate-pulse-slow" />
            </div>

            <div className="flex flex-col items-center justify-between py-4 h-full w-full relative z-10 animate-fade-in-up" key={currentItem.id}>

                {/* 1. Status Pill */}
                <div className="bg-white/20 backdrop-blur-md px-4 py-1 rounded-full border border-white/30 shadow-sm mb-2">
                    <h2 className="text-lg font-bold text-white uppercase tracking-wider drop-shadow-sm flex items-center gap-2">
                        <span>{currentIndex + 1}/{currentItems.length}</span>
                        <span className="opacity-50">|</span>
                        <span className="text-white/90">{currentItem.id}</span>
                    </h2>
                </div>

                {/* 2. Main Visual */}
                <div className="relative group cursor-pointer flex-1 flex items-center justify-center w-full min-h-0 py-2">
                    {/* Glow */}
                    <div className="absolute inset-0 bg-white/20 rounded-full blur-[50px] animate-pulse-slow pointer-events-none scale-110" />

                    {hasPhoto ? (
                        <div className="relative h-[160px] w-full max-w-[240px] rounded-xl overflow-hidden shadow-2xl border border-white/20 transform hover:scale-105 transition-transform duration-500">
                            <img src={displayIconUrl} className="w-full h-full object-cover" alt={currentItem.name} />
                            <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                                <span className="text-[10px] text-white/70 font-mono">© Propiedad de terceros</span>
                            </div>
                        </div>
                    ) : (
                        <img
                            src={displayIconUrl}
                            className="w-auto h-[160px] object-contain drop-shadow-[0_10px_20px_rgba(0,0,0,0.3)] animate-float"
                            alt={currentItem.name}
                        />
                    )}
                </div>

                {/* 3. Info Box */}
                <div className="w-full bg-white/10 backdrop-blur-md p-3 rounded-2xl border border-white/20 flex flex-col gap-2 shadow-lg mt-auto">
                    {/* Name */}
                    <div className="text-center border-b border-white/10 pb-2">
                        <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight leading-none drop-shadow-sm truncate">
                            {currentItem.name}
                        </h1>
                        <span className={`text-xs font-bold uppercase tracking-widest ${isPlane ? 'text-blue-200' : 'text-teal-200'}`}>
                            {currentItem.detail}
                        </span>
                    </div>

                    {/* Stats Grid */}
                    <div className="grid grid-cols-3 gap-2 text-center divide-x divide-white/10">
                        <div className="flex flex-col">
                            <span className="text-[9px] uppercase text-white/50 tracking-wider font-bold">Velocidad</span>
                            <span className="text-sm font-bold text-white leading-tight">{currentItem.speed ?? "--"} <span className="text-[9px]">km/h</span></span>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[9px] uppercase text-white/50 tracking-wider font-bold">{isPlane ? "Altitud" : "Rumbo"}</span>
                            <span className="text-sm font-bold text-white leading-tight">
                                {isPlane ? (currentItem.altitude ? `${currentItem.altitude}m` : "--") : (currentItem.heading ? `${Math.round(currentItem.heading)}°` : "--")}
                            </span>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-[9px] uppercase text-white/50 tracking-wider font-bold">Lat/Lon</span>
                            <span className="text-[10px] font-mono text-white/80 leading-tight truncate">
                                {currentItem.lat.toFixed(2)}, {currentItem.lon.toFixed(2)}
                            </span>
                        </div>
                    </div>
                </div>

            </div>

            <style>{`
                @keyframes float {
                    0%, 100% { transform: translateY(0px) rotate(0deg); }
                    50% { transform: translateY(-8px) rotate(2deg); }
                }
                .animate-float {
                    animation: float 6s ease-in-out infinite;
                }
                 @keyframes bounce-slow {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-3px); }
                }
                .animate-bounce-slow {
                    animation: bounce-slow 3s ease-in-out infinite;
                }
                 .animate-fade-in-up {
                     animation: fade-in-up 0.4s ease-out forwards;
                }
                @keyframes fade-in-up {
                    from { opacity: 0; transform: translateY(5px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                 @keyframes pulse-slow {
                    0%, 100% { opacity: 0.3; transform: scale(1); }
                    50% { opacity: 0.6; transform: scale(1.1); }
                }
                .animate-pulse-slow {
                    animation: pulse-slow 4s ease-in-out infinite;
                }
            `}</style>
        </StandardCard>
    );
};

import { StandardCard } from "../StandardCard";
