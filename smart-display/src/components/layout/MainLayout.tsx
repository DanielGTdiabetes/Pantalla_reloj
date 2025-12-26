import React from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { Settings } from 'lucide-react';
import './MainLayout.css';

export const MainLayout: React.FC = () => {
    return (
        <div className="app-container">
            <NavLink to="/settings" className="settings-overlay-btn">
                <Settings size={24} />
            </NavLink>
            <main className="main-content">
                <Outlet />
            </main>
        </div>
    );
};
