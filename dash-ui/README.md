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

## Reverse proxy (nginx)

Configura un bloque único del servidor para servir la SPA y reenviar /api al backend:

```nginx
server {
    listen 80;
    server_name _;

    root /var/www/html;
    index index.html;

    location /assets/ {
        try_files $uri =404;
    }

    location / {
        try_files $uri /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8081;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

La aplicación usa `window.location.origin`, por lo que funcionará igual si nginx escucha en 80 u 8080.

## Notas sobre npm ci

Si `npm ci` falla por un `package-lock.json` desincronizado, ejecuta:

```bash
rm -f package-lock.json && npm install
```

No olvides commitear el lockfile regenerado.

