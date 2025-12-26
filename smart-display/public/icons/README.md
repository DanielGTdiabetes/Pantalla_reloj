# Icons Package

## Description
Internal icon pack for Pantalla_reloj dashboard UI.

## Contents
- **moon/**: Moon phase icons (0%, 25%, 50%, 75%, 100%)
- **harvest/**: Seasonal harvest icons (fruits and vegetables)

## Format
- Simple, clean SVG format
- Designed with `fill="currentColor"` for CSS color customization
- Optimized for UI display at various sizes (24px-96px)

## License
CC0 / MIT - Public domain / Open source

## Date Created
November 2, 2025

## Origin
Internal pack - Created for Pantalla_reloj project
Repository: https://github.com/DanielGTdiabetes/Pantalla_reloj

## Usage
Icons can be referenced directly from the public folder:
```jsx
<img src="/icons/moon/moon-50.svg" className="icon" />
<img src="/icons/harvest/apple.svg" className="icon-lg" />
```

## Styling
Recommended utility classes:
- `.icon`: width: 24-48px; height: auto
- `.icon-lg`: width: 64-96px; height: auto
- Optional: `filter: drop-shadow(...)` for contrast
