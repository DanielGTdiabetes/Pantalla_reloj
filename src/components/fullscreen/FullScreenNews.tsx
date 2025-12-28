import React, { useEffect, useState } from 'react';
import { Newspaper, Globe, Clock } from 'lucide-react';
import './FullScreenNews.css';

interface NewsItem {
    title: string;
    summary: string;
    link: string;
    source: string;
    published_at?: string;
    image?: string;
}

export const FullScreenNews: React.FC = () => {
    const [news, setNews] = useState<NewsItem[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);

    useEffect(() => {
        fetch('/api/news')
            .then(r => r.json())
            .then(d => {
                if (d.items && Array.isArray(d.items)) {
                    setNews(d.items);
                }
            })
            .catch(console.error);
    }, []);

    // Rotate news every 10 seconds
    useEffect(() => {
        if (news.length === 0) return;
        const interval = setInterval(() => {
            setCurrentIndex(prev => (prev + 1) % news.length);
        }, 10000);
        return () => clearInterval(interval);
    }, [news.length]);

    if (news.length === 0) {
        return (
            <div className="fs-news-loading">
                <Newspaper size={64} className="animate-pulse mb-4" />
                <p>Cargando noticias...</p>
            </div>
        );
    }

    const currentItem = news[currentIndex];

    // Fallback image if none provided
    const bgImage = currentItem.image || 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?q=80&w=2070&auto=format&fit=crop';

    return (
        <div className="fs-news-container" style={{
            backgroundImage: `linear-gradient(rgba(0,0,0,0.85), rgba(0,0,0,0.9)), url(${bgImage})`
        }}>
            {/* Left Column: Headlines List */}
            <div className="fs-news-col-left">
                <div className="fs-news-header">
                    <Newspaper size={48} className="text-blue-400" />
                    <h1>Noticias</h1>
                </div>
                <div className="fs-news-list">
                    {news.slice(0, 8).map((item, idx) => (
                        <div key={idx}
                            className={`fs-news-list-item ${idx === currentIndex ? 'active' : ''}`}
                            onClick={() => setCurrentIndex(idx)}
                        >
                            <span className="fs-news-source-badge">{item.source}</span>
                            <p>{item.title}</p>
                        </div>
                    ))}
                </div>
            </div>

            {/* Right Column: Detail View */}
            <div className="fs-news-col-right">
                <div key={currentItem.link} className="fs-news-card fade-in">
                    <div className="fs-news-meta">
                        <span className="fs-meta-pill">
                            <Globe size={16} /> {currentItem.source}
                        </span>
                        {currentItem.published_at && (
                            <span className="fs-meta-pill">
                                <Clock size={16} /> {currentItem.published_at.slice(0, 16)}
                            </span>
                        )}
                    </div>

                    <h1 className="fs-news-title">{currentItem.title}</h1>

                    {currentItem.image && (
                        <div className="fs-news-image">
                            <img src={currentItem.image} alt="News" />
                        </div>
                    )}

                    <div className="fs-news-summary" dangerouslySetInnerHTML={{ __html: currentItem.summary }} />
                </div>

                <div className="fs-news-progress">
                    {news.slice(0, 8).map((_, i) => (
                        <div key={i} className={`fs-dot ${i === currentIndex ? 'active' : ''}`} />
                    ))}
                </div>
            </div>
        </div>
    );
};
