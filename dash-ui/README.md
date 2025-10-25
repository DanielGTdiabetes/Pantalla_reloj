# Pantalla_reloj Dashboard UI

React + Vite kiosk frontend rendered on the HDMI panel. The dashboard cycles through
modules and exposes a configuration page at `/config` for operators.

## Development

```bash
npm install
npm run dev
```

Set `VITE_BACKEND_URL` when connecting to a remote backend (defaults to
`http://127.0.0.1:8081`).

## Build

```bash
npm run build
```

The generated static files live under `dist/` and are copied to `/var/www/html`
during installation.
