import React, { useState, useEffect } from 'react';
import { FullScreenWeather } from '../components/fullscreen/FullScreenWeather';
import { FullScreenFarming } from '../components/fullscreen/FullScreenFarming';
import { FullScreenEphemerides } from '../components/fullscreen/FullScreenEphemerides';
import { FullScreenAPOD } from '../components/fullscreen/FullScreenAPOD';
import { FullScreenNews } from '../components/fullscreen/FullScreenNews';
import './DesktopDashboard.css';

export const DesktopDashboard: React.FC = () => {
    const [moduleIndex, setModuleIndex] = useState(0);
    const [time, setTime] = useState(new Date());

    const MODULES = [
        'WEATHER',
        'FARMING',
        'EPHEMERIDES',
        'APOD',
        'NEWS'
    ];

    // Clock only
    useEffect(() => {
        const timer = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    // Module Rotation
    useEffect(() => {
        // Fetch config for cycle time? Default 20s
        const rotationInterval = 20000;

        const timer = setInterval(() => {
            setModuleIndex(prev => (prev + 1) % MODULES.length);
        }, rotationInterval);
        return () => clearInterval(timer);
    }, []);

    return (
        <div className="dashboard-container" style={{ position: 'relative', overflow: 'hidden', background: '#000' }}>

            {/* Persistent Clock Overlay (Top Right) */}
            <div style={{
                position: 'absolute',
                top: '1rem',
                right: '2rem',
                zIndex: 100,
                color: 'white',
                textShadow: '0 2px 4px rgba(0,0,0,0.5)',
                fontFamily: 'monospace',
                fontSize: '1.5rem',
                fontWeight: 'bold',
                pointerEvents: 'none'
            }}>
                {time.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
            </div>

            {/* Modules Carousel */}
            <div style={{ width: '100%', height: '100%' }}>
                {moduleIndex === 0 && <FullScreenWeather />}
                {moduleIndex === 1 && <FullScreenFarming />}
                {moduleIndex === 2 && <FullScreenEphemerides />}
                {moduleIndex === 3 && <FullScreenAPOD />}
                {moduleIndex === 4 && <FullScreenNews />}
            </div>
        </div>
    );
};

