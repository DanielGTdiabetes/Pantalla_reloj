import React from "react";

type StandardCardProps = {
    title?: string;
    subtitle?: string;
    icon?: React.ReactNode;
    children?: React.ReactNode;
    footer?: React.ReactNode;
    className?: string;
    noPadding?: boolean;
    headerClassName?: string;
};

export const StandardCard = ({
    title,
    subtitle,
    icon,
    children,
    footer,
    className = "",
    noPadding = false,
    headerClassName = "",
}: StandardCardProps) => {
    const hasHeader = title || subtitle || icon;

    return (
        <div
            className={`
                standard-card
                w-full h-full 
                relative overflow-hidden 
                rounded-3xl 
                border border-white/10 
                bg-black/40 backdrop-blur-xl 
                shadow-2xl 
                flex flex-col 
                ${className}
            `}
        >
            {/* Cinematic Glow Effects */}
            <div className="standard-card__glow standard-card__glow--cyan" />
            <div className="standard-card__glow standard-card__glow--purple" />
            <div className="standard-card__glow standard-card__glow--blue" />

            {/* Header - Only render if we have content */}
            {hasHeader && (
                <header className={`standard-card__header ${headerClassName}`}>
                    <div className="standard-card__header-text">
                        {title && (
                            <h2 className="standard-card__title">{title}</h2>
                        )}
                        {subtitle && (
                            <span className="standard-card__subtitle">{subtitle}</span>
                        )}
                    </div>
                    {icon && (
                        <div className="standard-card__icon">{icon}</div>
                    )}
                </header>
            )}

            {/* Main Content */}
            <main
                className={`
                    standard-card__main
                    flex-1 min-h-0 w-full 
                    relative z-10
                    ${noPadding ? "" : "px-5 py-3"}
                `}
            >
                {children}
            </main>

            {/* Footer */}
            {footer && (
                <footer className="standard-card__footer">
                    {footer}
                </footer>
            )}

            <style>{`
                .standard-card {
                    font-family: system-ui, -apple-system, sans-serif;
                }

                /* Glow effects */
                .standard-card__glow {
                    position: absolute;
                    border-radius: 50%;
                    filter: blur(60px);
                    pointer-events: none;
                    opacity: 0.15;
                }

                .standard-card__glow--cyan {
                    width: 8rem;
                    height: 8rem;
                    top: -2.5rem;
                    left: -2.5rem;
                    background: #22d3ee;
                }

                .standard-card__glow--purple {
                    width: 10rem;
                    height: 10rem;
                    top: 2.5rem;
                    right: -2rem;
                    background: #a855f7;
                }

                .standard-card__glow--blue {
                    width: 12rem;
                    height: 12rem;
                    bottom: -3rem;
                    left: 2.5rem;
                    background: #3b82f6;
                }

                /* Header */
                .standard-card__header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 1rem;
                    padding: 1rem 1.25rem 0.5rem;
                    position: relative;
                    z-index: 10;
                    flex-shrink: 0;
                }

                .standard-card__header-text {
                    display: flex;
                    flex-direction: column;
                    gap: 0.125rem;
                    min-width: 0;
                    flex: 1;
                }

                .standard-card__title {
                    font-size: 0.75rem;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.2em;
                    color: rgba(165, 243, 252, 0.85);
                    text-shadow: 0 2px 4px rgba(0,0,0,0.3);
                    margin: 0;
                    line-height: 1.3;
                }

                .standard-card__subtitle {
                    font-size: 0.625rem;
                    color: rgba(255,255,255,0.5);
                    font-weight: 500;
                    letter-spacing: 0.05em;
                }

                .standard-card__icon {
                    flex-shrink: 0;
                    font-size: 1.5rem;
                    color: rgba(255,255,255,0.9);
                    filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .standard-card__icon img {
                    width: 2.5rem;
                    height: 2.5rem;
                    object-fit: contain;
                }

                /* Main content */
                .standard-card__main {
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                }

                /* Footer */
                .standard-card__footer {
                    flex-shrink: 0;
                    padding: 0.5rem 1.25rem 1rem;
                    position: relative;
                    z-index: 10;
                }
            `}</style>
        </div>
    );
};

