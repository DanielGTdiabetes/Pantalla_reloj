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
                {/* Stronger Gradient Overlay for bottom text area */}
                <div className="absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-black via-black/80 to-transparent" />
            </div>

            {/* Content with glass effect backing just in case */}
            <div className="relative z-10 flex h-full flex-col justify-end p-6 md:p-8">
                <div className="animate-fade-in-up flex flex-col gap-3">
                    <div className="self-start inline-flex items-center gap-2 rounded-full bg-black/40 px-3 py-1.5 text-[10px] md:text-xs font-bold uppercase tracking-widest backdrop-blur-lg border border-white/10 shadow-lg">
                        <span className="text-blue-400">🔭</span> <span className="text-white/90">NASA APOD</span>
                    </div>

                    <h1 className="text-2xl md:text-4xl lg:text-5xl font-black leading-tight tracking-tight drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] text-white">
                        {data.title}
                    </h1>

                    <div className="bg-black/20 backdrop-blur-sm rounded-lg p-3 md:p-4 border border-white/5 shadow-2xl">
                        <p className="text-sm md:text-base lg:text-lg font-medium leading-relaxed text-gray-200/95 line-clamp-4 drop-shadow-md">
                            {data.explanation}
                        </p>
                        <div className="mt-3 text-xs opacity-60 font-mono tracking-wide text-gray-400">
                            {data.date}
                        </div>
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
