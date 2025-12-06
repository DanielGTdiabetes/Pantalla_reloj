import { useRef, useEffect } from "react";

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
        <div className="relative h-full w-full overflow-hidden rounded-xl bg-black text-white shadow-2xl">
            {/* Full Image */}
            <div className="absolute inset-0 z-0">
                <img
                    src={data.url}
                    alt={data.title}
                    className="h-full w-full object-cover animate-ken-burns"
                />
                <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black via-black/50 to-transparent" />
            </div>

            {/* Content */}
            <div className="relative z-10 flex h-full flex-col justify-end p-8">
                <div className="animate-fade-in-up">
                    <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-widest backdrop-blur-md mb-3 border border-white/20">
                        <span>🔭</span> NASA Astronomy Picture of the Day
                    </div>
                    <h1 className="text-3xl font-black leading-tight tracking-tight drop-shadow-xl md:text-5xl max-w-4xl">
                        {data.title}
                    </h1>
                    <p className="mt-4 max-w-3xl text-sm font-medium leading-relaxed text-gray-200/90 line-clamp-3 md:text-lg drop-shadow-md">
                        {data.explanation}
                    </p>
                    <div className="mt-2 text-xs opacity-50 font-mono">
                        {data.date}
                    </div>
                </div>
            </div>

            <style>{`
                .animate-ken-burns {
                    animation: kenBurns 20s ease-out forwards;
                }
                .animate-fade-in-up {
                    animation: fadeInUp 1s ease-out;
                }
                @keyframes kenBurns {
                    from { transform: scale(1.0); }
                    to { transform: scale(1.15); }
                }
                @keyframes fadeInUp {
                    from { opacity: 0; transform: translateY(20px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </div>
    );
};
