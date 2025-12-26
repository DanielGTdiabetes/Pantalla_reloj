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
    const mapping: Record<string, string> = {
        'manzana': 'apple',
        'remolacha': 'beet',
        'brocoli': 'broccoli',
        'zanahoria': 'carrot',
        'uva': 'grapes',
        'lechuga': 'lettuce',
        'pera': 'pear',
        'fresa': 'fresa',
        'freson': 'freson',
        'limon': 'limon',
        'naranja': 'naranja',
        'platano': 'platano',
        'tomate': 'tomate',
        'acelga': 'chard',
        'ajo': 'ajo',
        'berenjena': 'berenjena',
        'calabaza': 'calabaza',
        'cebolla': 'cebolla',
        'cereza': 'cherry',
        'chirimoya': 'chirimoya',
        'escarola': 'escarola',
        'sandia': 'sandia',
        'rabanito': 'rabanito',
        'kiwi': 'fruit_3d',
        'mandarina': 'naranja',
        'caqui': 'fruit_3d',
        'granada': 'fruit_3d',
        'alcachofa': 'sprout_3d',
        'apio': 'sprout_3d',
        'cardo': 'sprout_3d',
        'col': 'lettuce',
        'coliflor': 'broccoli',
        'endibia': 'lettuce',
        'espinaca': 'chard',
        'guisante': 'sprout_3d',
        'haba': 'sprout_3d',
        'nabo': 'carrot',
        'puerro': 'ajo',
        'judia': 'sprout_3d'
    };

    let normalized = name.toLowerCase().trim();
    normalized = normalized
        .replace(/á/g, 'a')
        .replace(/é/g, 'e')
        .replace(/í/g, 'i')
        .replace(/ó/g, 'o')
        .replace(/ú/g, 'u')
        .replace(/ñ/g, 'n')
        .replace(/ü/g, 'u');

    // Remove text in parentheses
    normalized = normalized.replace(/\(.*\)/g, '').trim();
    normalized = normalized.replace(/ /g, '-');

    if (mapping[normalized]) return mapping[normalized];

    // Check for substrings
    if (normalized.includes('manzana')) return 'apple';
    if (normalized.includes('pera')) return 'pear';
    if (normalized.includes('naranja')) return 'naranja';
    if (normalized.includes('limon')) return 'limon';
    if (normalized.includes('uva')) return 'grapes';
    if (normalized.includes('col')) return 'broccoli';

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
                <Icon size={64} color="#1f2937" className="main-category-icon" />
                <h1>{title}</h1>
            </div>

            <div className="fs-farming-grid">
                {items.map((item) => {
                    const iconName = normalizeIconName(item);
                    const isPng = iconName.endsWith('_3d');
                    const iconPath = isPng ? `/icons/harvest/${iconName}.png` : `/icons/harvest/${iconName}.svg`;

                    return (
                        <div key={item} className="fs-farming-item">
                            <div className="fs-farming-icon-wrapper">
                                <img
                                    src={iconPath}
                                    onError={(e) => {
                                        // Fallback if specific icon missing
                                        const target = e.target as HTMLImageElement;
                                        const defFallback = category === 'fruits' ? '/icons/harvest/fruit_3d.png' : '/icons/harvest/sprout_3d.png';

                                        if (target.src !== window.location.origin + defFallback) {
                                            target.src = defFallback;
                                            target.classList.add('is-fallback');
                                        } else {
                                            target.style.display = 'none';
                                            target.nextElementSibling?.classList.remove('hidden');
                                        }
                                    }}
                                    alt={item}
                                />
                                {/* Final Fallback text/icon if image also fails */}
                                <div className="fs-fallback-icon hidden">
                                    <Leaf size={48} />
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
