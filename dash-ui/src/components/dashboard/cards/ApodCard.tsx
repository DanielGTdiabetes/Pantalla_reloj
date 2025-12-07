interface ApodData {
    title: string;
    url: string;
    date: string;
    explanation: string;
    media_type: string;
    thumbnail_url?: string;
    error?: string;
}

interface ApodCardProps {
    data: ApodData | null;
}

export const ApodCard = ({ data }: ApodCardProps) => {

    if (!data || data.error) {
        return (
            <div className="apod-card-dark apod-card-dark--empty">
                <span className="apod-card-dark__icon">🔭</span>
                <span>Foto del día no disponible</span>
            </div>
        );
    }

    const isVideo = data.media_type === "video";
    const imageUrl = isVideo ? (data.thumbnail_url || "") : data.url;

    return (
        <div className="apod-card-dark">
            {/* Background Image */}
            {imageUrl && (
                <div className="apod-card-dark__bg">
                    <img src={imageUrl} alt={data.title} className="apod-card-dark__bg-img" />
                    <div className="apod-card-dark__overlay" />
                </div>
            )}

            {/* Content */}
            <div className="apod-card-dark__content">
                <div className="apod-card-dark__badge">
                    <span>🔭</span>
                    <span>NASA APOD</span>
                    {isVideo && <span className="apod-card-dark__video-tag">📹 Video</span>}
                </div>

                <h1 className="apod-card-dark__title">{data.title}</h1>

                <p className="apod-card-dark__desc">{data.explanation}</p>

                <div className="apod-card-dark__footer">
                    <span className="apod-card-dark__date">{data.date}</span>
                </div>
            </div>

            <style>{`
                .apod-card-dark {
                    position: relative;
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                    width: 100%;
                    overflow: hidden;
                    background: #0f172a;
                    color: white;
                }
                .apod-card-dark--empty {
                    align-items: center;
                    justify-content: center;
                    gap: 0.5rem;
                    opacity: 0.7;
                }
                .apod-card-dark__icon {
                    font-size: 3rem;
                }
                .apod-card-dark__bg {
                    position: absolute;
                    inset: 0;
                    z-index: 0;
                }
                .apod-card-dark__bg-img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover;
                    animation: kenBurns 30s ease-out infinite alternate;
                }
                .apod-card-dark__overlay {
                    position: absolute;
                    inset: 0;
                    background: linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.5) 50%, transparent 100%);
                }
                .apod-card-dark__content {
                    position: relative;
                    z-index: 10;
                    display: flex;
                    flex-direction: column;
                    justify-content: flex-end;
                    height: 100%;
                    padding: 0.75rem;
                }
                .apod-card-dark__badge {
                    display: inline-flex;
                    align-items: center;
                    gap: 0.4rem;
                    background: rgba(59, 130, 246, 0.3);
                    border: 1px solid rgba(59, 130, 246, 0.5);
                    padding: 0.25rem 0.5rem;
                    border-radius: 1rem;
                    font-size: 0.7rem;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.1em;
                    width: fit-content;
                    margin-bottom: 0.5rem;
                }
                .apod-card-dark__video-tag {
                    background: rgba(239, 68, 68, 0.3);
                    padding: 0.1rem 0.3rem;
                    border-radius: 0.25rem;
                    margin-left: 0.25rem;
                }
                .apod-card-dark__title {
                    font-size: 1.4rem;
                    font-weight: 900;
                    line-height: 1.2;
                    margin: 0 0 0.5rem 0;
                    text-shadow: 0 2px 4px rgba(0,0,0,0.5);
                }
                .apod-card-dark__desc {
                    font-size: 0.85rem;
                    line-height: 1.4;
                    margin: 0;
                    display: -webkit-box;
                    -webkit-line-clamp: 3;
                    -webkit-box-orient: vertical;
                    overflow: hidden;
                    opacity: 0.9;
                }
                .apod-card-dark__footer {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-top: 0.5rem;
                    padding-top: 0.5rem;
                    border-top: 1px solid rgba(255,255,255,0.1);
                }
                .apod-card-dark__date {
                    font-size: 0.75rem;
                    font-family: monospace;
                    opacity: 0.7;
                    text-transform: uppercase;
                    letter-spacing: 0.1em;
                }
                @keyframes kenBurns {
                    from { transform: scale(1.0); }
                    to { transform: scale(1.15); }
                }
            `}</style>
        </div>
    );
};
