
import { useState, useEffect } from "react";


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
    const bgGradient = getSeverityColor(props.severity);
    const severityLabel = getSeverityLabel(props.severity);

    return (
        <div className={`flex h-full w-full flex-col overflow-hidden rounded-xl bg-gradient-to-br ${bgGradient} text-white shadow-2xl animate-pulse-slow`}>
            {/* Header */}
            <div className="flex items-center justify-between bg-black/20 p-4 backdrop-blur-sm">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/20 backdrop-blur-md">
                        <span className="text-2xl">⚠️</span>
                    </div>
                    <div className="flex flex-col">
                        <span className="text-xs font-black uppercase tracking-widest opacity-80">
                            ALERTA AEMET
                        </span>
                        <span className="text-sm font-bold opacity-90">
                            {currentIndex + 1} de {alerts.length}
                        </span>
                    </div>
                </div>
                <div className="rounded-lg bg-white/20 px-3 py-1 text-xs font-bold uppercase tracking-wider backdrop-blur-sm">
                    {severityLabel}
                </div>
            </div>

            {/* Main Content */}
            <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
                <div className="animate-fade-in-up">
                    <h1 className="text-3xl font-black leading-tight tracking-tight drop-shadow-lg md:text-5xl mb-4">
                        {props.event}
                    </h1>
                    <p className="mx-auto max-w-2xl text-lg font-medium leading-relaxed opacity-95 drop-shadow-md">
                        {props.headline}
                    </p>
                </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-center bg-black/20 p-3 backdrop-blur-sm">
                <span className="text-xs font-mono uppercase tracking-widest opacity-60">
                    {props.status} • {props.source}
                </span>
            </div>

            <style>{`
        .animate-pulse-slow {
          animation: pulseSlow 4s ease-in-out infinite;
        }
        @keyframes pulseSlow {
          0%, 100% { box-shadow: 0 0 20px rgba(0,0,0,0.2); }
          50% { box-shadow: 0 0 40px rgba(0,0,0,0.4); }
        }
      `}</style>
        </div>
    );
};
