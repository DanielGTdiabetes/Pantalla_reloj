import React, { useEffect, useState } from 'react';
import { Sprout, Leaf, Apple } from 'lucide-react';
import './FullScreenFarming.css';

interface FarmingData {
    month: number;
    fruits: string[];
    vegetables: string[];
    sowing: string[];
}

const normalizeIconName = (name: string): string => {
    // Basic normalization: lowercase, spaces to dashes
    let normalized = name.toLowerCase().trim();

    // Handle specific typical replacements for Spanish filenames
    normalized = normalized
        .replace(/ /g, '-')
        .replace(/á/g, 'a')
        .replace(/é/g, 'e')
        .replace(/í/g, 'i')
        .replace(/ó/g, 'o')
        .replace(/ú/g, 'u')
        .replace(/ñ/g, 'n')
        .replace(/ü/g, 'u');

    // Remove text in parentheses (e.g., "(semillero)")
    normalized = normalized.replace(/\(.*\)/g, '').replace(/-+$/, '');

    return normalized;
};

export const FullScreenFarming: React.FC = () => {
    const [data, setData] = useState<FarmingData | null>(null);
    const [category, setCategory] = useState<'fruits' | 'vegetables' | 'sowing'>('fruits');

    useEffect(() => {
        fetch('/api/farming/current')
            .then(res => res.json())
            .then(d => setData(d))
            .catch(e => console.error(e));
    }, []);

    // Rotate category every 12 seconds if component stays mounted
    useEffect(() => {
        const interval = setInterval(() => {
            setCategory(prev => {
                if (prev === 'fruits') return 'vegetables';
                if (prev === 'vegetables') return 'sowing';
                return 'fruits';
            });
        }, 12000);
        return () => clearInterval(interval);
    }, []);

    if (!data) return <div className="fs-loading">Cargando datos de cultivo...</div>;

    let items: string[] = [];
    let title = "";
    let Icon = Apple;
    let bgColor = "";

    if (category === 'fruits') {
        items = data.fruits;
        title = "Frutas de Temporada";
        Icon = Apple;
        bgColor = "linear-gradient(135deg, #fceeb5 0%, #ffc09f 100%)"; // Warm colors
    } else if (category === 'vegetables') {
        items = data.vegetables;
        title = "Verduras del Mes";
        Icon = Leaf;
        bgColor = "linear-gradient(135deg, #dcfce7 0%, #86efac 100%)"; // Greenish
    } else {
        items = data.sowing;
        title = "Calendario de Siembra";
        Icon = Sprout;
        bgColor = "linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%)"; // Blueish/Soil
    }

    return (
        <div className="fs-farming-container" style={{ background: bgColor }}>
            <div className="fs-farming-header">
                <Icon size={48} color="#1f2937" />
                <h1>{title}</h1>
            </div>

            <div className="fs-farming-grid">
                {items.map((item) => {
                    const iconName = normalizeIconName(item);
                    return (
                        <div key={item} className="fs-farming-item">
                            <div className="fs-farming-icon-wrapper">
                                <img
                                    src={`/icons/harvest/${iconName}.svg`}
                                    onError={(e) => {
                                        // Fallback if specific icon missing
                                        (e.target as HTMLImageElement).style.display = 'none';
                                        (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                                    }}
                                    alt={item}
                                />
                                {/* Fallback text/icon if image fails */}
                                <div className="fs-fallback-icon hidden">
                                    <Leaf size={32} />
                                </div>
                            </div>
                            <span className="fs-farming-label">{item}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
