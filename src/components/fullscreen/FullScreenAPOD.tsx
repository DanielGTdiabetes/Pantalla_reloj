import React, { useEffect, useState } from 'react';
import { Rocket } from 'lucide-react';
import './FullScreenAPOD.css';

interface ApodData {
    url: string;
    title: string;
    explanation: string;
    media_type: string;
}

export const FullScreenAPOD: React.FC = () => {
    const [data, setData] = useState<ApodData | null>(null);

    useEffect(() => {
        fetch('/api/ephemerides/apod')
            .then(r => r.json())
            .then(d => {
                if (d.url && !d.error) {
                    setData(d);
                }
            })
            .catch(console.error);
    }, []);

    if (!data) return <div className="fs-apod-loading">Buscando en las estrellas...</div>;

    if (data.media_type === 'video') {
        return (
            <div className="fs-apod-container video-mode">
                <iframe src={data.url} title={data.title} frameBorder="0" allowFullScreen className="fs-apod-video" />
                <div className="fs-apod-overlay">
                    <h1>{data.title}</h1>
                </div>
            </div>
        );
    }

    return (
        <div className="fs-apod-container" style={{ backgroundImage: `url(${data.url})` }}>
            <div className="fs-apod-overlay">
                <div className="fs-apod-header">
                    <Rocket size={32} className="text-red-400" />
                    <span>NASA: Foto del Día</span>
                </div>
                <h1>{data.title}</h1>
                <div className="fs-apod-text-container">
                    <div className="scroll-wrapper">
                        {data.explanation}
                    </div>
                </div>
            </div>
        </div>
    );
};
