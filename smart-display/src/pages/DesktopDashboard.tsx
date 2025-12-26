import React, { useState, useEffect } from 'react';
import { FullScreenWeather } from '../components/fullscreen/FullScreenWeather';
import { FullScreenFarming } from '../components/fullscreen/FullScreenFarming';
import { FullScreenEphemerides } from '../components/fullscreen/FullScreenEphemerides';
import { FullScreenAPOD } from '../components/fullscreen/FullScreenAPOD';
import { FullScreenNews } from '../components/fullscreen/FullScreenNews';
import './DesktopDashboard.css';

// ... imports
import { FullScreenMap } from '../components/fullscreen/FullScreenMap'; // Add input
import { AnimatePresence, motion } from 'framer-motion';

export const DesktopDashboard: React.FC = () => {
    const [moduleIndex, setModuleIndex] = useState(0);
    const [time, setTime] = useState(new Date());
    const [showOverlay, setShowOverlay] = useState(false); // Controls visibility of panels

    const MODULES = [
        'WEATHER',
        'FARMING',
        'EPHEMERIDES',
        'APOD',
        'NEWS'
    ];

    // Clock
    useEffect(() => {
        const timer = setInterval(() => setTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    // Cycle Logic: Map (30s) -> Panel (15s) -> Map ...
    useEffect(() => {
        let active = true;

        const loop = async () => {
            while (active) {
                // 1. Show Map (Overlay hidden)
                setShowOverlay(false);
                await new Promise(r => setTimeout(r, 45000)); // 45s Map
                if (!active) break;

                // 2. Show Panel
                setShowOverlay(true);
                await new Promise(r => setTimeout(r, 20000)); // 20s Panel
                if (!active) break;

                // 3. Move to next panel for next time
                setModuleIndex(prev => (prev + 1) % MODULES.length);
            }
        };

        loop();
        return () => { active = false; };
    }, []);

    const CurrentModule = () => {
        switch (moduleIndex) {
            case 0: return <FullScreenWeather />;
            case 1: return <FullScreenFarming />;
            case 2: return <FullScreenEphemerides />;
            case 3: return <FullScreenAPOD />;
            case 4: return <FullScreenNews />;
            default: return <FullScreenWeather />;
        }
    };

    return (
        <div className="dashboard-container" style={{ position: 'relative', overflow: 'hidden', background: '#000' }}>

            {/* Layer 0: Map (Always Visible in Background) */}
            <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 0 }}>
                <FullScreenMap />
            </div>

            {/* Layer 1: Overlay Modules (Fade In/Out) */}
            <AnimatePresence>
                {showOverlay && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 1.0 }}
                        style={{
                            position: 'absolute', top: 0, left: 0,
                            width: '100%', height: '100%',
                            zIndex: 10,
                            background: 'rgba(0, 0, 0, 0.85)', // Darken background to make text readable
                            backdropFilter: 'blur(5px)'
                        }}
                    >
                        <CurrentModule />
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Layer 2: Persistent Clock (Top Right) */}
            <div style={{
                position: 'absolute',
                top: '1rem',
                right: '2rem',
                zIndex: 100, // Always on top
                color: 'white',
                textShadow: '0 2px 4px rgba(0,0,0,0.8)',
                fontFamily: 'monospace',
                fontSize: '2rem',
                fontWeight: 'bold',
                pointerEvents: 'none'
            }}>
                {time.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
            </div>
        </div>
    );
};

