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
    if (!currentItem) return null;

    const isPlane = currentItem.type === "plane";
    const headerTitle = isPlane ? "Tráfico Aéreo" : "Tráfico Marítimo";
    const accentColor = isPlane ? "from-blue-500 to-indigo-600" : "from-teal-500 to-emerald-600";
    const iconUrl = currentItem.img || get3DIcon(currentItem.type);
    const hasPhoto = !!currentItem.img;

    return (
        <div className="h-full w-full overflow-hidden relative bg-slate-900 text-white font-sans p-4">
            {/* Dynamic Background */}
            <div className={`absolute inset-0 bg-gradient-to-br ${isPlane ? 'from-blue-900/30' : 'from-teal-900/30'} to-slate-950/80 z-0`} />

            {/* Grid Layout Container */}
            <div className="relative z-10 w-full h-full grid grid-rows-[auto_1fr_auto] gap-4">

                {/* 1. Header Row */}
                <div className="flex items-center justify-between border-b border-white/10 pb-2">
                    <div className="flex items-center gap-2">
                        <span className="text-2xl filter drop-shadow-md">{isPlane ? "✈️" : "🚢"}</span>
                        <h2 className={`text-xs font-bold uppercase tracking-[0.2em] ${isPlane ? 'text-blue-300' : 'text-teal-300'}`}>
                            {headerTitle}
                        </h2>
                    </div>
                    <div className="px-2 py-0.5 bg-white/5 rounded text-[10px] font-mono opacity-60">
                        {currentIndex + 1}/{currentItems.length}
                    </div>
                </div>

                {/* 2. Visual & Info Row (Centered) */}
                <div className="grid grid-rows-[1fr_auto] gap-2 items-center justify-items-center w-full min-h-0 overflow-hidden">

                    {/* Image / Icon */}
                    <div className="w-full h-full flex items-center justify-center relative min-h-[140px] max-h-[300px]">
                        {hasPhoto ? (
                            <div className="relative w-full h-full rounded-2xl overflow-hidden shadow-2xl border border-white/10 group">
                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent z-10" />
                                <img
                                    src={iconUrl}
                                    alt={currentItem.name}
                                    className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-1000"
                                />
                                <div className="absolute bottom-2 right-2 z-20 text-[9px] text-white/60 font-mono bg-black/50 px-2 py-0.5 rounded">
                                    © Planespotters
                                </div>
                            </div>
                        ) : (
                            <div className="relative w-48 h-48 animate-float">
                                <img
                                    src={iconUrl}
                                    alt="Transport Icon"
                                    className="w-full h-full object-contain filter drop-shadow-[0_10px_20px_rgba(0,0,0,0.5)]"
                                />
                            </div>
                        )}

                        {/* Speed Badge overlay on image if photo exists, else separate */}
                        <div className={`absolute top-4 right-4 z-30 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10 shadow-xl flex flex-col items-center ${hasPhoto ? '' : '-right-2 top-0'}`}>
                            <span className="text-xl font-black text-yellow-400 leading-none">
                                {currentItem.speed || "--"}
                            </span>
                            <span className="text-[9px] uppercase font-bold text-yellow-100/70 tracking-wider">km/h</span>
                        </div>
                    </div>

                    {/* Basic Info */}
                    <div className="text-center w-full pt-2">
                        <h1 className="text-2xl md:text-3xl font-black tracking-tight text-white mb-1 drop-shadow-lg truncate w-full px-2">
                            {currentItem.name}
                        </h1>
                        <div className={`inline-block px-3 py-1 rounded-full text-[10px] md:text-xs font-bold uppercase tracking-widest bg-white/5 border border-white/10 ${isPlane ? 'text-blue-200' : 'text-teal-200'}`}>
                            {currentItem.detail}
                        </div>
                    </div>
                </div>

                {/* 3. Stats Row (Footer) */}
                <div className="grid grid-cols-2 gap-3 pb-1">
                    <div className="bg-black/20 rounded-xl p-2.5 backdrop-blur-sm border border-white/5 flex flex-col items-center justify-center">
                        <span className="text-[9px] uppercase text-white/40 tracking-widest font-bold mb-0.5">Altitud</span>
                        <span className="text-xl font-bold font-mono text-white">
                            {currentItem.altitude ? `${currentItem.altitude}m` : "N/A"}
                        </span>
                    </div>
                    <div className="bg-black/20 rounded-xl p-2.5 backdrop-blur-sm border border-white/5 flex flex-col items-center justify-center">
                        <span className="text-[9px] uppercase text-white/40 tracking-widest font-bold mb-0.5">Rumbo</span>
                        <span className="text-xl font-bold font-mono text-white">
                            {currentItem.heading ? `${Math.round(currentItem.heading)}°` : "--"}
                        </span>
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
            `}</style>
        </div>
    );
};
