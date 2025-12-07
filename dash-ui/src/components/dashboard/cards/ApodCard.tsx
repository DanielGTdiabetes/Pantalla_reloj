import { useRef, useEffect } from "react";
import { StandardCard } from "../StandardCard";

interface ApodData {
    title: string;
    url: string;
    date: string;
    explanation: string;
    media_type: string;
    error?: string;
}

interface ApodCardProps {
    data: ApodData | null;
}

export const ApodCard = ({ data }: ApodCardProps) => {

    if (!data || data.error || data.media_type !== "image") {
        // Fallback or empty if video/error
        if (data?.media_type === "video") return null; // Or show specific msg
        return null;
    }

    return (
        <StandardCard
            noPadding
            className="group relative overflow-hidden"
        >
            {/* Full Image Background with Ken Burns */}
            <div className="absolute inset-0 z-0">
                <img
                    src={data.url}
                    alt={data.title}
                    className="h-full w-full object-cover animate-ken-burns transition-transform duration-[20s] ease-out group-hover:scale-125"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent opacity-90" />
            </div>

            {/* Content Overlay */}
            <div className="relative z-10 flex flex-col justify-end h-full w-full p-6 md:p-8 animate-fade-in-up">

                {/* Badge */}
                <div className="self-start mb-4 inline-flex items-center gap-2 rounded-full bg-blue-500/20 px-3 py-1 text-xs font-bold uppercase tracking-widest backdrop-blur-md border border-blue-400/30 text-blue-200 shadow-[0_0_15px_rgba(59,130,246,0.5)]">
                    <span>🔭</span> <span>NASA APOD</span>
                </div>

                {/* Title */}
                <h1 className="text-3xl md:text-4xl lg:text-5xl font-black leading-none tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-white to-blue-200 drop-shadow-lg mb-4">
                    {data.title}
                </h1>

                {/* Description Box */}
                <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-xl shadow-2xl">
                    <p className="text-sm md:text-base leading-relaxed text-gray-100/90 line-clamp-4 font-medium text-shadow-sm">
                        {data.explanation}
                    </p>
                    <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3">
                        <span className="font-mono text-xs text-blue-300/80 tracking-widest uppercase">
                            {data.date}
                        </span>
                        <div className="h-1 w-12 rounded-full bg-blue-500/50" />
                    </div>
                </div>
            </div>

            <style>{`
                .animate-ken-burns {
                    animation: kenBurns 30s ease-out infinite alternate;
                }
                .animate-fade-in-up {
                    animation: fadeInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                }
                @keyframes kenBurns {
                    from { transform: scale(1.0); }
                    to { transform: scale(1.15); }
                }
                @keyframes fadeInUp {
                    from { opacity: 0; transform: translateY(40px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </StandardCard>
    );
};
