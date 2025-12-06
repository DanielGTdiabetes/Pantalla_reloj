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
        name: p.cs || "Sin Distintivo",
        type: "plane",
        speed: p.spd ? Math.round(p.spd * 3.6) : undefined, // m/s to km/h usually
        altitude: p.alt,
        heading: p.hdg,
        lat: p.lat,
        lon: p.lon,
        detail: `${p.ic || ''} ${p.co || 'Unknown'}`,
        img: p.img
    }));

    const ships: TransportItem[] = (data?.ships || []).map((s: any) => ({
        id: String(s.mmsi),
        name: s.name || "Navío Desconocido",
        type: "ship",
        speed: s.spd ? Math.round(s.spd * 1.852) : undefined, // knots to km/h
        heading: s.hdg,
        lat: s.lat,
        lon: s.lon,
        detail: s.type || "Carguero",
        img: null // Ships images not currently fetched
    }));

    const hasPlanes = planes.length > 0;
    const hasShips = ships.length > 0;

    // Auto-switch modes logic
    useEffect(() => {
        if (!hasPlanes && hasShips) setActiveTab("ship");
        else if (hasPlanes && !hasShips) setActiveTab("plane");
        else if (hasPlanes && hasShips) {
            // Rotate mode every 10s if both exist
            const interval = setInterval(() => {
                setActiveTab(prev => prev === "plane" ? "ship" : "plane");
                setCurrentIndex(0);
            }, 10000);
            return () => clearInterval(interval);
        }
    }, [hasPlanes, hasShips]);

    const currentItems = activeTab === "plane" ? planes : ships;

    // Rotate items within current mode
    useEffect(() => {
        if (currentItems.length <= 1) return;
        const interval = setInterval(() => {
            setCurrentIndex(prev => (prev + 1) % currentItems.length);
        }, 5000); // 5s per item
        return () => clearInterval(interval);
    }, [currentItems.length, activeTab]);

    if (!hasPlanes && !hasShips) {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center bg-black/40 p-6 text-white text-center rounded-xl border border-white/10">
                <div className="text-5xl mb-4 animate-pulse opacity-50">📡</div>
                <h2 className="text-xl font-bold opacity-80">Escaneando tráfico...</h2>
                <p className="text-sm opacity-60 mt-1">Sin vehículos detectados cerca de Vila-real</p>
            </div>
        );
    }

    const currentItem = currentItems[currentIndex] || currentItems[0];
    if (!currentItem) return null;

    const isPlane = currentItem.type === "plane";
    const headerTitle = isPlane ? "Tráfico Aéreo" : "Tráfico Marítimo";
    const headerColor = isPlane ? "text-blue-300" : "text-teal-300";
    const headerBg = isPlane ? "bg-blue-500/10" : "bg-teal-500/10";
    const hasImage = !!currentItem.img;

    return (
        <div className="relative flex h-full w-full overflow-hidden rounded-xl bg-gradient-to-br from-slate-900 to-slate-800 text-white shadow-2xl border border-white/10">
            {/* Header / Banner - Seamless, non-interactive */}
            <div className={`absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 py-2 backdrop-blur-md border-b border-white/5 ${headerBg}`}>
                <div className={`text-xs font-bold uppercase tracking-widest flex items-center gap-2 ${headerColor}`}>
                    <span className="text-lg">{isPlane ? "✈️" : "🚢"}</span>
                    {headerTitle}
                </div>
                <div className="text-xs opacity-50 font-mono">
                    {currentIndex + 1}/{currentItems.length}
                </div>
            </div>

            {/* Main Content */}
            <div className="relative z-10 flex flex-1 flex-col pt-12 pb-6 px-6 h-full justify-between" key={currentItem.id}>

                {/* Visual Area */}
                <div className="flex-1 w-full flex items-center justify-center min-h-0 my-2 relative">
                    {hasImage ? (
                        <div className="relative w-full h-full max-h-[180px] rounded-lg overflow-hidden shadow-2xl border border-white/10 animate-fade-in">
                            <img
                                src={currentItem.img || ""}
                                alt={currentItem.name}
                                className="w-full h-full object-cover"
                            />
                            {/* Overlay Badge */}
                            <div className="absolute bottom-0 right-0 bg-black/60 backdrop-blur-md px-2 py-1 text-[10px] text-white/70">
                                © Planespotters.net
                            </div>
                        </div>
                    ) : (
                        <div className="relative w-40 h-40 animate-float">
                            <img
                                src={get3DIcon(currentItem.type)}
                                alt={currentItem.type}
                                className="w-full h-full object-contain filter drop-shadow-2xl"
                            />
                        </div>
                    )}

                    {/* Speed Badge Floating */}
                    <div className="absolute top-0 right-0 translate-x-2 -translate-y-2 bg-white/10 backdrop-blur-md border border-white/20 rounded-lg px-3 py-1 shadow-xl z-30">
                        <span className="text-xl font-bold text-yellow-400">{currentItem.speed || "--"}</span>
                        <span className="text-[10px] ml-1 opacity-70 uppercase">km/h</span>
                    </div>
                </div>

                {/* Info Area */}
                <div className="text-center animate-fade-in-up mt-2">
                    <h2 className="text-2xl md:text-3xl font-black tracking-tight text-white drop-shadow-lg truncate max-w-full">
                        {currentItem.name}
                    </h2>
                    <div className="text-sm font-medium uppercase tracking-widest text-blue-200/60 mt-1">
                        {currentItem.detail}
                    </div>
                </div>

                {/* Grid Stats */}
                <div className="w-full grid grid-cols-2 gap-3 mt-4">
                    <div className="bg-white/5 rounded-lg p-2 backdrop-blur-sm border border-white/5 flex flex-col items-center">
                        <span className="text-[10px] uppercase opacity-40">Altitud</span>
                        <span className="text-lg font-bold font-mono">
                            {currentItem.altitude ? `${currentItem.altitude}m` : "N/A"}
                        </span>
                    </div>
                    <div className="bg-white/5 rounded-lg p-2 backdrop-blur-sm border border-white/5 flex flex-col items-center">
                        <span className="text-[10px] uppercase opacity-40">Rumbo</span>
                        <span className="text-lg font-bold font-mono">
                            {currentItem.heading ? `${Math.round(currentItem.heading)}°` : "--"}
                        </span>
                    </div>
                </div>

            </div>

            <style>{`
                .animate-float { animation: float 6s ease-in-out infinite; }
                .animate-fade-in { animation: fadeIn 0.8s ease-out; }
                .animate-fade-in-up { animation: fadeInUp 0.5s ease-out; }
                @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px) rotate(1deg); } }
                @keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
                @keyframes fadeInUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
            `}</style>
        </div>
    );
};
