import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface InfoWidgetProps {
    icon: LucideIcon;
    label: string;
    value: string | number;
    subtext?: string;
    color?: string;
    alert?: boolean;
}

export const InfoWidget: React.FC<InfoWidgetProps> = ({ icon: Icon, label, value, subtext, color, alert }) => (
    <div className={`glass-card ${alert ? 'alert-pulse' : ''}`}>
        <Icon size={24} color={color || 'var(--text-primary)'} className="card-icon" />
        <div className="card-data">
            <span className="card-label">{label}</span>
            <span className="card-value">{value}</span>
            {subtext && <span className="card-subtext">{subtext}</span>}
        </div>
    </div>
);
