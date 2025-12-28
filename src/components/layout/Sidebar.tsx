import React from 'react';
import { NavLink } from 'react-router-dom';
import { Home, Map, CloudSun, Calendar, Settings, Plane, Ship, Radar } from 'lucide-react';
import './Sidebar.css';

const navItems = [
    { icon: Home, label: 'Inicio', path: '/' },
    { icon: Map, label: 'Mapa', path: '/map' },
    { icon: CloudSun, label: 'Tiempo', path: '/weather' },
    { icon: Radar, label: 'Radar', path: '/radar' },
    { icon: Plane, label: 'Vuelos', path: '/flights' },
    { icon: Ship, label: 'Barcos', path: '/ships' },
    { icon: Calendar, label: 'Agenda', path: '/calendar' },
    { icon: Settings, label: 'Ajustes', path: '/settings' },
];

export const Sidebar: React.FC = () => {
    return (
        <nav className="sidebar glass-panel">
            <div className="sidebar-logo">
                <div className="logo-dot"></div>
            </div>

            <div className="nav-items-scroll">
                <div className="nav-items">
                    {navItems.map((item) => (
                        <NavLink
                            key={item.path}
                            to={item.path}
                            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                        >
                            <item.icon size={28} strokeWidth={2} />
                            <span className="sr-only">{item.label}</span>
                        </NavLink>
                    ))}
                </div>
            </div>
        </nav>
    );
};
