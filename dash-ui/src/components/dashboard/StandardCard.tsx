import React from "react";

type StandardCardProps = {
    title?: string;
    subtitle?: string;
    icon?: React.ReactNode;
    children?: React.ReactNode;
    footer?: React.ReactNode;
    className?: string;
    noPadding?: boolean;
};

export const StandardCard = ({
    title,
    subtitle,
    icon,
    children,
    footer,
    className = "",
    noPadding = false,
}: StandardCardProps) => {
    return (
        <div className={`w-full h-full relative overflow-hidden rounded-3xl border border-white/10 bg-black/40 backdrop-blur-xl shadow-2xl flex flex-col ${className}`}>
            {/* Cinematic Glow Effects */}
            <div className="absolute -top-10 -left-10 w-32 h-32 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute top-10 right-0 w-40 h-40 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute bottom-0 left-10 w-48 h-48 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />

            {/* Header */}
            <header className="flex-none px-6 pt-5 pb-2 flex items-center justify-between z-10 w-full">
                {(title || subtitle) ? (
                    <div className="flex flex-col items-start gap-0.5">
                        {title ? (
                            <h2 className="text-sm font-bold uppercase tracking-[0.2em] text-cyan-200/80 drop-shadow-md">
                                {title}
                            </h2>
                        ) : null}
                        {subtitle ? (
                            <span className="text-xs text-white/50 font-medium tracking-wider">
                                {subtitle}
                            </span>
                        ) : null}
                    </div>
                ) : <div />}

                {icon ? (
                    <div className="text-2xl text-white/90 drop-shadow-md filter">{icon as any}</div>
                ) : null}
            </header>

            {/* Main Content */}
            <main className={`flex-1 min-h-0 w-full z-10 ${noPadding ? "" : "px-6 py-2"} relative flex flex-col items-center justify-center`}>
                {children as any}
            </main>

            {/* Footer */}
            {footer ? (
                <footer className="flex-none px-6 pb-4 pt-2 z-10 w-full">
                    {footer as any}
                </footer>
            ) : null}
        </div>
    );
};
