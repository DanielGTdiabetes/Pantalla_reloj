# Build notes (dash-ui)

- Node LTS recomendado: 20.x (ver `.nvmrc`).
- Mantén `package-lock.json` sincronizado con `package.json`.
- En el instalador / servidores CI:
  1. Ejecuta `npm ci` cuando el lockfile esté alineado.
  2. Si `npm ci` falla por lock desincronizado, limpiar `node_modules`, correr `npm install` y reintentar la build.

