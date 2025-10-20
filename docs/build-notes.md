# Notas de build del instalador

El instalador intenta primero `npm ci` al construir `dash-ui`. Si falla por un lockfile desincronizado, limpia `node_modules`, ejecuta `npm install` para resincronizar y vuelve a compilar.

Mantén `package-lock.json` actualizado en el repositorio para asegurar builds reproducibles.
