import React from "react";

type AstronomyIconProps = {
    size?: number;
    className?: string;
};

type MoonPhaseIconProps = AstronomyIconProps & {
    illumination: number; // 0 to 1 ideally, or 0-100
    phaseName?: string;
};

/**
 * Gradient definitions for astronomy icons
 */
const AstroGradients = () => (
    <defs>
        <radialGradient id="sunRiseGradient">
            <stop offset="0%" stopColor="#FFD700" />
            <stop offset="60%" stopColor="#FF8C00" />
            <stop offset="100%" stopColor="#FF4500" />
        </radialGradient>
        <radialGradient id="sunSetGradient">
            <stop offset="0%" stopColor="#FF8C00" />
            <stop offset="60%" stopColor="#FF4500" />
            <stop offset="100%" stopColor="#8B0000" />
        </radialGradient>
        <linearGradient id="horizonGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#4169E1" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#000080" stopOpacity="0.8" />
        </linearGradient>
        <radialGradient id="moonLightGradient" cx="50%" cy="50%" r="50%">
            <stop offset="80%" stopColor="#F4F6F0" />
            <stop offset="100%" stopColor="#D0D0D0" />
        </radialGradient>
        <radialGradient id="moonDarkGradient" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#2c2c2c" />
            <stop offset="100%" stopColor="#000000" />
        </radialGradient>
        <filter id="moonGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
    </defs>
);

export const SunriseIcon: React.FC<AstronomyIconProps> = ({ size = 124, className }) => {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 100 100"
            className={`astro-icon astro-icon--sunrise ${className || ""}`}
            aria-label="Amanecer"
        >
            <AstroGradients />
            {/* Glow */}
            <circle cx="50" cy="65" r="25" fill="url(#sunRiseGradient)" opacity="0.3" filter="url(#moonGlow)" />

            {/* Sun */}
            <circle cx="50" cy="65" r="20" fill="url(#sunRiseGradient)">
                <animate attributeName="cy" values="75;65" dur="3s" repeatCount="1" fill="freeze" calcMode="spline" keySplines="0.4 0 0.2 1" />
            </circle>

            {/* Rays */}
            <g stroke="url(#sunRiseGradient)" strokeWidth="2" strokeLinecap="round" opacity="0.8">
                {[...Array(7)].map((_, i) => {
                    const angle = -90 + (i - 3) * 20; // Fan out from top
                    return (
                        <line
                            key={i}
                            x1="50" y1="65"
                            x2={50 + 35 * Math.cos(angle * Math.PI / 180)}
                            y2={65 + 35 * Math.sin(angle * Math.PI / 180)}
                            strokeDasharray="5 30"
                            strokeDashoffset="5"
                        >
                            <animate attributeName="stroke-dashoffset" from="35" to="0" dur="2s" begin="0.5s" fill="freeze" />
                        </line>
                    )
                })}
            </g>

            {/* Horizon/Landscape */}
            <path d="M 10 75 Q 30 70 50 75 T 90 75 L 90 90 L 10 90 Z" fill="url(#horizonGradient)" opacity="0.9" />
            <path d="M 0 80 Q 50 75 100 80 L 100 100 L 0 100 Z" fill="#1a1a2e" />

            {/* Up Arrow */}
            <path d="M 80 40 L 80 20 M 75 25 L 80 20 L 85 25" stroke="#FFD700" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none">
                <animate attributeName="opacity" values="0;1;0" dur="2s" repeatCount="infinite" />
                <animateTransform attributeName="transform" type="translate" values="0 5; 0 -5" dur="2s" repeatCount="infinite" />
            </path>
        </svg>
    );
};

export const SunsetIcon: React.FC<AstronomyIconProps> = ({ size = 124, className }) => {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 100 100"
            className={`astro-icon astro-icon--sunset ${className || ""}`}
            aria-label="Atardecer"
        >
            <AstroGradients />

            {/* Glow */}
            <circle cx="50" cy="65" r="25" fill="url(#sunSetGradient)" opacity="0.3" filter="url(#moonGlow)" />

            {/* Sun */}
            <circle cx="50" cy="65" r="20" fill="url(#sunSetGradient)">
                <animate attributeName="cy" values="55;65" dur="3s" repeatCount="1" fill="freeze" calcMode="spline" keySplines="0.4 0 0.2 1" />
            </circle>

            {/* Rays (subtler) */}
            <g stroke="url(#sunSetGradient)" strokeWidth="2" strokeLinecap="round" opacity="0.6">
                {[...Array(5)].map((_, i) => {
                    const angle = -90 + (i - 2) * 25;
                    return (
                        <line
                            key={i}
                            x1="50" y1="65"
                            x2={50 + 30 * Math.cos(angle * Math.PI / 180)}
                            y2={65 + 30 * Math.sin(angle * Math.PI / 180)}
                        />
                    )
                })}
            </g>

            {/* Horizon/Landscape */}
            <path d="M 10 75 Q 30 70 50 75 T 90 75 L 90 90 L 10 90 Z" fill="url(#horizonGradient)" opacity="0.9" />
            <path d="M 0 80 Q 50 75 100 80 L 100 100 L 0 100 Z" fill="#1a1a2e" />

            {/* Down Arrow */}
            <path d="M 80 20 L 80 40 M 75 35 L 80 40 L 85 35" stroke="#FF4500" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none">
                <animate attributeName="opacity" values="0;1;0" dur="2s" repeatCount="infinite" />
                <animateTransform attributeName="transform" type="translate" values="0 -5; 0 5" dur="2s" repeatCount="infinite" />
            </path>
        </svg>
    );
};

export const MoonPhaseIcon: React.FC<MoonPhaseIconProps> = ({ size = 124, className, illumination, phaseName }) => {
    // Illumination 0..1 or 0..100
    const illum = illumination > 1 ? illumination / 100 : illumination;

    // Calculate mask offset roughly based on illumination
    // This is a simplification. For true astronomically correct phases, we'd use complex paths.
    // But we can approximate.
    // Full moon = 1.0, New moon = 0.0
    // We need to know if it's waxing or waning to know which side is lit.
    // Assuming 'phaseName' helps or we infer.
    // If phaseName is not provided, we might default to just full/new logic or assume waxing?
    // Let's rely on standard logic: 
    // If we don't know waxing/waning, we can't be sure, but usually we just show "lit" part.
    // However, strict illumination percent doesn't tell us LEFT or RIGHT.
    // Commonly: 
    // New -> First Quarter (Right side lit on N. Hemisphere) -> Full -> Last Quarter (Left side lit) -> New

    const isWaning = (phaseName?.toLowerCase().includes("waning") || phaseName?.toLowerCase().includes("last") || phaseName?.toLowerCase().includes("menguante")) ?? false;

    // Create a mask/path that represents the shadow.
    // Helper to generate path d
    const radius = 35;
    const cx = 50;
    const cy = 50;

    // Visual representation of phase:
    // We can use a mask consisting of a rectangle and an ellipse.

    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 100 100"
            className={`astro-icon astro-icon--moon ${className || ""}`}
            aria-label={`Luna ${Math.round(illum * 100)}%`}
        >
            <AstroGradients />

            {/* Background star field (subtle) */}
            <circle cx="20" cy="20" r="1" fill="white" opacity="0.5" />
            <circle cx="80" cy="15" r="1.5" fill="white" opacity="0.4" />
            <circle cx="10" cy="60" r="1" fill="white" opacity="0.3" />
            <circle cx="90" cy="80" r="1" fill="white" opacity="0.4" />

            {/* Base Moon (Dark/Shadow side) */}
            <circle cx={cx} cy={cy} r={radius} fill="url(#moonDarkGradient)" stroke="#444" strokeWidth="1" />

            {/* Lit Moon Part */}
            {/* 
         We use a mask to show the lit part. 
         Actually, simpler: 
         Draw Full moon.
         Overlay Shadow.
       */}
            <defs>
                <mask id={`moonMask-${illum}-${isWaning ? 'w' : 'x'}`}>
                    <rect x="0" y="0" width="100" height="100" fill="black" />
                    {/* Logic for phase shape */}
                    <circle cx={cx} cy={cy} r={radius} fill="white" />

                    {/* 
               To simulate phase:
               We subtract/intersect an ellipse.
               If illum is 0.5 (Quarter), half is covered.
               
               A better way with SVG for phases:
               Use a path that describes the terminator line.
               M 50,15 A 35,35 0 1,1 50,85 A rx,35 0 1,1 50,15
               Where rx varies from -35 to 35.
           */}
                </mask>
            </defs>

            {/* Render lit side */}
            <path
                fill="url(#moonLightGradient)"
                filter="url(#moonGlow)"
                d={getMoonPath(cx, cy, radius, illum, isWaning)}
            />

            {/* Craters (only on lit part ideally, but let's just overlay semi-transparently) */}
            <g opacity="0.2">
                <circle cx="65" cy="40" r="5" fill="#aaa" />
                <circle cx="45" cy="70" r="3" fill="#aaa" />
                <circle cx="35" cy="35" r="4" fill="#aaa" />
            </g>
        </svg>
    );
};

// Mathematics for moon phase path
function getMoonPath(cx: number, cy: number, r: number, illum: number, isWaning: boolean): string {
    // Correct logic for terminator
    // illum 0 (new) -> 0.5 (quarter) -> 1 (full)
    // When waxing: Right side is lit.
    // When waning: Left side is lit.

    // We can simulate this by drawing two arcs.
    // The outer arc is always a semi-circle (the limb of the moon).
    // The inner arc is the terminator (an ellipse arc).

    // Example: Waxing Crescent (illum < 0.5)
    // Lit part is a sliver on the right.

    // Let's normalize phase to 0..1 where 0=New, 0.5=Full, 1.0=New (cyclic) doesn't fit illum directly.
    // But we have illum and isWaning.

    // Direction: 1 for waxing (right lit), -1 for waning (left lit).
    const direction = isWaning ? -1 : 1;

    // Width of the terminator ellipse. 
    // At Full (illum=1), width is r. At Quarter (illum=0.5), width is 0. At New (illum=0), width is -r?
    // Actually:
    // The terminator is an semi-ellipse with horizontal radius 'rx'.
    // rx goes from -r to r.
    // If illum = 0.5, rx = 0 (straight line).
    // If illum = 1.0, rx = -r (creating full circle with outer arc? No, full circle).
    // If illum = 0.0, rx = r (creating visible empty space?)

    // Let's map illum (0 to 1) to rx (-r to r).
    // rx = r * (2 * illum - 1) ? 
    // illum=0 -> rx = -r 
    // illum=0.5 -> rx = 0
    // illum=1 -> rx = r

    // Sweep flags depend on side.

    if (illum >= 1) {
        return `M ${cx},${cy - r} A ${r},${r} 0 1,1 ${cx},${cy + r} A ${r},${r} 0 1,1 ${cx},${cy - r}`;
    }
    if (illum <= 0) {
        return ""; // New moon
    }

    const rx = r * (2 * illum - 1); // -r to r

    // To draw the lit part correctly:
    if (isWaning) {
        // Lit on LEFT.
        // Outer arc: Top to Bottom around Left.
        // Inner arc: Bottom to Top.

        // Path: Move Top (cx, cy-r)
        // Arc 1 (Outer): to Bottom (cx, cy+r) with radius r. Sweep?
        // Arc 2 (Inner): to Top (cx, cy-r) with radius rx.

        // Left side outer arc: sweep 0.
        // Inner arc needs to bulge correctly.

        // If rx > 0 (Gibbous), inner arc bulges Right.
        // If rx < 0 (Crescent), inner arc bulges Left.

        // SVG Arc: A rx ry x-axis-rotation large-arc-flag sweep-flag x y

        // For Waning (Left Lit):
        // Start Top. Draw outer arc to Bottom (Left side).
        // M cx, cy-r
        // A r,r 0 0,0 cx, cy+r  (Sweep 0 goes left/counter-clockwise from top to bottom?)
        // Let's verify: Top(90) to Bottom(270). CCW is 90->180->270. Yes.

        // Now return to Top via terminator.
        // Terminator goes through center-ish.
        // A Math.abs(rx), r 0 0, sweep? cx, cy-r

        // If Gibbous (illum > 0.5, rx > 0), terminator bulges Right (illum > 0.5 means rx > 0).
        // Waning Gibbous means left side lit, but more than half. Terminator bulges into dark right side.
        // So terminator is convex.

        // If Crescent (illum < 0.5, rx < 0), terminator bulges Left. 
        // Waning Crescent means left side sliver. Terminator is concave.

        const sweep = rx > 0 ? 0 : 1;
        // Wait, checking sweep for Ellipse arc.
        // Start Bottom. End Top.

        // If Gibbous (rx > 0), we want it to curve Right. 
        // Bottom -> Top. Right is CCW? 

        return `M ${cx},${cy - r} A ${r},${r} 0 0,0 ${cx},${cy + r} A ${Math.abs(rx)},${r} 0 0,${itemSweep(rx, true)} ${cx},${cy - r}`;
    } else {
        // Waxing (Right Lit).
        // Outer arc: Top to Bottom around Right.
        // A r,r 0 0,1 cx, cy+r  (Sweep 1 goes right/clockwise)

        return `M ${cx},${cy - r} A ${r},${r} 0 0,1 ${cx},${cy + r} A ${Math.abs(rx)},${r} 0 0,${itemSweep(rx, false)} ${cx},${cy - r}`;
    }
}

function itemSweep(rx: number, isWaning: boolean): number {
    // Determine sweep for terminator
    // Waxing (Right lit):
    // Terminator moves Bottom -> Top.
    // If Gibbous (rx>0), curve Left (Concave? Convex?). Waxing Gibbous = Right big. Terminator bulges Left.
    // If Crescent (rx<0), curve Right. Waxing Crescent = Right sliver. Terminator bulges Right.

    if (!isWaning) {
        // Waxing
        // Bottom -> Top
        // Want bulge Left if rx>0 ? No.
        // rx ranges -r to r. 
        // rx < 0 (Crescent, illum < 0.5). Lit is slice on right. Terminator bulges Left (expanding lit area). Wait.
        // Illumination increases.
        // New Moon (rx=-r) -> Quarter (rx=0) -> Full (rx=r).
        // At rx=-r (start), Terminator is at Right edge.
        // At rx=0, Terminator is straight.
        // At rx=r, Terminator is at Left edge.

        // So for Waxing:
        // Outer arc is Right semi-circle.
        // Inner arc joins Bottom to Top.
        // As illum increases, the area grows. 
        // The inner arc moves from Right edge to Left edge.

        // This means the terminator arc determines the LEFT boundary of the lit shape.
        // So we are drawing the Lit Shape.

        // Waxing Crescent: Lit shape is small right sliver.
        // Left boundary (terminator) is close to right edge. Curving Right.

        // Waxing Gibbous: Lit shape is big right blob.
        // Left boundary (terminator) is on left side. Curving Left.

        // So if rx < 0 (Crescent), curve is same as outer? No.
        // Let's use simple logic:
        // If rx > 0, sweep is 1. If rx < 0, sweep is 0.

        return rx > 0 ? 0 : 1;
    } else {
        // Waning (Left Lit)
        // Outer arc is Left semi-circle. (Top -> Bottom CCW).
        // Inner arc joins Bottom -> Top.
        // Defines Right boundary of lit shape.

        // Waning Gibbous (illum > 0.5, rx > 0). Big left blob.
        // Right boundary (terminator) is on right side. Curving Right.

        // Waning Crescent (illum < 0.5, rx < 0). Small left sliver.
        // Right boundary is on left side. Curving Left.

        return rx > 0 ? 1 : 0;
    }
}

export default { SunriseIcon, SunsetIcon, MoonPhaseIcon };
