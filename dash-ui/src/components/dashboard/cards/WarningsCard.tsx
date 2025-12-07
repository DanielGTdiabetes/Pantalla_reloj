
import { useState, useEffect } from "react";
import { StandardCard } from "../StandardCard";


interface WarningFeature {
    type: "Feature";
    properties: {
        event: string;
        severity: string;
        headline: string;
        status: string;
        source: string;
    };
}

interface WarningsCardProps {
    alerts: WarningFeature[];
}

const getSeverityColor = (severity: string) => {
    const s = severity.toLowerCase();
    if (s === "extreme") return "from-red-600 to-red-800";
    if (s === "severe") return "from-orange-500 to-red-600";
    if (s === "moderate") return "from-yellow-500 to-orange-500";
    return "from-blue-500 to-blue-700";
};

const getSeverityLabel = (severity: string) => {
    const s = severity.toLowerCase();
    if (s === "extreme") return "RIESGO EXTREMO";
    if (s === "severe") return "RIESGO IMPORTANTE";
    if (s === "moderate") return "RIESGO";
    return "AVISO";
};

export const WarningsCard = ({ alerts }: WarningsCardProps) => {
    const [currentIndex, setCurrentIndex] = useState(0);

    // Rotate warnings every 5 seconds if multiple
    useEffect(() => {
        if (!alerts || alerts.length <= 1) return;
        const interval = setInterval(() => {
            setCurrentIndex((prev) => (prev + 1) % alerts.length);
        }, 5000);
        return () => clearInterval(interval);
    }, [alerts]);

    if (!alerts || alerts.length === 0) return null;

    const currentAlert = alerts[currentIndex];
    const props = currentAlert.properties;
    const severity = props.severity.toLowerCase();

    // Map severity to simpler gradient colors or classes
    const getGradient = (s: string) => {
        if (s === "extreme") return "from-red-600 to-rose-900";
        if (s === "severe") return "from-orange-500 to-red-800";
        if (s === "moderate") return "from-yellow-400 to-orange-700";
        return "from-blue-500 to-indigo-800";
    };

    const gradientClass = `bg-gradient-to-br ${getGradient(severity)}`;

    // Header Icon
    const headerIcon = <img
        src="/img/icons/3d/warning.png"
        className="w-8 h-8 drop-shadow-md animate-pulse-slow"
        alt="warning"
    />;

    return (
        <StandardCard
            title="Avisos AEMET"
            subtitle={`${currentIndex + 1} de ${alerts.length} - ${getSeverityLabel(props.severity)}`}
            icon={headerIcon}
            className={`${gradientClass} relative overflow-hidden`}
        >
            {/* Background Pattern */}
            <div className="absolute inset-0 opacity-10 bg-[url('/img/noise.png')] mix-blend-overlay pointer-events-none" />
            <div className="absolute inset-0 z-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-white/20 via-transparent to-transparent opacity-40 animate-pulse-slow" />

            <div className="flex flex-col items-center justify-between py-4 h-full w-full relative z-10 animate-fade-in-up" key={currentAlert.properties.event + currentIndex}>

                {/* 1. Event Type Pill */}
                <div className="bg-white/20 backdrop-blur-md px-4 py-1.5 rounded-full border border-white/30 shadow-sm mb-2">
                    <h2 className="text-xl md:text-2xl font-black text-white uppercase tracking-tighter drop-shadow-sm text-center leading-none">
                        {props.event}
                    </h2>
                </div>

                {/* 2. Main Visual Icon (Central) */}
                <div className="relative flex-1 flex items-center justify-center w-full min-h-0 py-2">
                    {/* Pulsing Glow behind icon */}
                    <div className="absolute inset-0 bg-white/30 rounded-full blur-[60px] animate-pulse-fast pointer-events-none scale-110" />

                    <img
                        src="/img/icons/3d/warning.png"
                        className="w-auto h-[140px] md:h-[160px] object-contain drop-shadow-[0_10px_30px_rgba(0,0,0,0.4)] animate-shake"
                        alt="warning icon"
                    />
                </div>

                {/* 3. Info Headline Box */}
                <div className="w-full bg-white/10 backdrop-blur-md p-4 rounded-2xl border border-white/20 flex flex-col gap-2 shadow-lg mt-auto text-center">
                    <p className="text-sm md:text-base font-bold text-white leading-snug line-clamp-4 drop-shadow-sm">
                        {props.headline}
                    </p>

                    <div className="flex items-center justify-center gap-2 mt-1 pt-2 border-t border-white/10">
                        <span className="text-[10px] uppercase font-mono text-white/60 tracking-widest">{props.source}</span>
                        <span className="text-white/40">•</span>
                        <span className="text-[10px] uppercase font-mono text-white/60 tracking-widest">{props.status}</span>
                    </div>
                </div>

            </div>

            <style>{`
                 @keyframes shake {
                    0%, 100% { transform: rotate(0deg); }
                    25% { transform: rotate(-5deg); }
                    75% { transform: rotate(5deg); }
                }
                .animate-shake {
                    animation: shake 0.5s ease-in-out infinite;
                    animation-play-state: paused;
                }
                .hover:animate-shake {
                     animation-play-state: running;
                }
                 @keyframes pulse-fast {
                    0%, 100% { opacity: 0.5; transform: scale(1); }
                    50% { opacity: 0.8; transform: scale(1.1); }
                }
                .animate-pulse-fast {
                    animation: pulse-fast 2s ease-in-out infinite;
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


