# Smart Desktop Display (v2)

This is the new frontend for the 7" Touchscreen Desktop Display project.
It replaces the old `dash-ui` (which was diabetes-focused) with a general-purpose dashboard.

## Key Features
- **Single Pane of Glass UI**: Information is overlayed on a live map background.
- **HUD (Heads-Up Display)**:
  - Large Digital Clock & Date.
  - Detailed Weather Widget.
  - Live Status Ticker (Flights, Ships, Events).
- **Tech Stack**:
  - React 18 + TypeScript + Vite.
  - MapLibre GL for the map engine.
  - Lucide React for consistent iconography.

## Development
```bash
cd smart-display
npm install
npm run dev
```

## Deployment
The main `install.sh` script in the root directory has been updated to automatically build and deploy this project instead of the old one.
Just run `sudo bash install.sh` on the target device.
