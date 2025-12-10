@echo off
REM Script para desplegar al mini PC desde Windows
REM Uso: deploy-to-minipc.bat [IP_MINIPC] [USUARIO]
REM Ejemplo: deploy-to-minipc.bat 192.168.0.234 dani

setlocal enabledelayedexpansion

set MINIPC_IP=%1
set MINIPC_USER=%2

if "%MINIPC_IP%"=="" set MINIPC_IP=192.168.0.234
if "%MINIPC_USER%"=="" set MINIPC_USER=dani

set PROJECT_ROOT=%~dp0..
set DIST_DIR=%PROJECT_ROOT%\dash-ui\dist

echo [deploy] Desplegando al mini PC %MINIPC_IP% como usuario %MINIPC_USER%
echo [deploy] Directorio dist: %DIST_DIR%

REM Verificar que existe el directorio dist
if not exist "%DIST_DIR%" (
    echo [deploy] ERROR: El directorio dist no existe. Ejecuta primero: npm run build
    exit /b 1
)

echo.
echo [deploy] Copiando frontend (dash-ui/dist) al mini PC...
scp -r "%DIST_DIR%\*" %MINIPC_USER%@%MINIPC_IP%:/tmp/pantalla-dist/

echo.
echo [deploy] Instalando archivos en /var/www/html...
ssh %MINIPC_USER%@%MINIPC_IP% "sudo cp -r /tmp/pantalla-dist/* /var/www/html/ && sudo chown -R www-data:www-data /var/www/html && rm -rf /tmp/pantalla-dist"

echo.
echo [deploy] Copiando backend...
scp "%PROJECT_ROOT%\backend\default_config.json" %MINIPC_USER%@%MINIPC_IP%:/tmp/
scp "%PROJECT_ROOT%\backend\main.py" %MINIPC_USER%@%MINIPC_IP%:/tmp/

echo.
echo [deploy] Instalando backend...
ssh %MINIPC_USER%@%MINIPC_IP% "sudo cp /tmp/default_config.json /opt/pantalla-reloj/backend/ 2>/dev/null || sudo cp /tmp/default_config.json ~/Pantalla_reloj/backend/ && sudo cp /tmp/main.py /opt/pantalla-reloj/backend/ 2>/dev/null || sudo cp /tmp/main.py ~/Pantalla_reloj/backend/"

echo.
echo [deploy] Copiando servicios systemd actualizados...
scp "%PROJECT_ROOT%\systemd\pantalla-xorg.service" %MINIPC_USER%@%MINIPC_IP%:/tmp/
scp "%PROJECT_ROOT%\systemd\pantalla-dash-backend@.service" %MINIPC_USER%@%MINIPC_IP%:/tmp/
scp "%PROJECT_ROOT%\systemd\pantalla-kiosk-chrome@.service" %MINIPC_USER%@%MINIPC_IP%:/tmp/

echo.
echo [deploy] Instalando servicios systemd...
ssh %MINIPC_USER%@%MINIPC_IP% "sudo cp /tmp/pantalla-xorg.service /etc/systemd/system/ && sudo cp /tmp/pantalla-dash-backend@.service /etc/systemd/system/ && sudo cp /tmp/pantalla-kiosk-chrome@.service /etc/systemd/system/ && sudo systemctl daemon-reload"

echo.
echo [deploy] Reiniciando servicios...
ssh %MINIPC_USER%@%MINIPC_IP% "sudo systemctl restart pantalla-dash-backend@1 2>/dev/null || sudo systemctl restart pantalla-reloj"

echo.
echo [deploy] Reseteando vista del mapa a Espana...
curl -X POST http://%MINIPC_IP%/api/config/reset-map-view

echo.
echo [deploy] Limpiando cache del navegador del kiosk...
ssh %MINIPC_USER%@%MINIPC_IP% "rm -rf ~/.cache/chromium 2>/dev/null; rm -rf ~/.config/chromium/Default/Cache 2>/dev/null"

echo.
echo [deploy] Refrescando kiosk...
ssh %MINIPC_USER%@%MINIPC_IP% "DISPLAY=:0 xdotool key F5 2>/dev/null || echo 'xdotool no disponible, recarga manual necesaria'"

echo.
echo [deploy] ========================================
echo [deploy] Despliegue completado!
echo [deploy] ========================================
echo.
echo Para verificar:
echo   1. Abre http://%MINIPC_IP%/ en el navegador
echo   2. Verifica que se ve toda Espana (zoom 5.5)
echo   3. Verifica aviones y barcos en la consola
echo.
echo Si el mapa sigue ampliado, ejecuta:
echo   curl -X POST http://%MINIPC_IP%/api/config/reset-map-view
echo.

endlocal

