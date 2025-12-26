@echo off
REM Script para desplegar al mini PC desde Windows
REM Uso: deploy-to-minipc.bat [IP_MINIPC] [USUARIO]
REM Ejemplo: deploy-to-minipc.bat 192.168.0.235 dani

setlocal enabledelayedexpansion

set MINIPC_IP=%1
set MINIPC_USER=%2

if "%MINIPC_IP%"=="" set MINIPC_IP=192.168.0.235
if "%MINIPC_USER%"=="" set MINIPC_USER=dani

set PROJECT_ROOT=%~dp0..
set DIST_DIR=%PROJECT_ROOT%\smart-display\dist

echo [deploy] Desplegando al mini PC %MINIPC_IP% como usuario %MINIPC_USER%
echo [deploy] Directorio dist: %DIST_DIR%

REM Verificar que existe el directorio dist
if not exist "%DIST_DIR%" (
    echo [deploy] ERROR: El directorio dist no existe. Ejecuta primero: npm run build
    exit /b 1
)

echo.
echo [deploy] Copiando frontend (smart-display/dist) al mini PC...
scp -r "%DIST_DIR%\*" %MINIPC_USER%@%MINIPC_IP%:/tmp/pantalla-dist/

echo.
echo [deploy] Instalando archivos en /var/www/html...
ssh %MINIPC_USER%@%MINIPC_IP% "sudo mkdir -p /tmp/pantalla-dist && sudo cp -r /tmp/pantalla-dist/* /var/www/html/ && sudo chown -R www-data:www-data /var/www/html && rm -rf /tmp/pantalla-dist"

echo.
echo [deploy] Copiando backend completo...
REM Excluir __pycache__ y .venv es dificil con scp simple, mejor rsync si estuviera disponible.
REM Usaremos scp recursivo de la carpeta backend
scp -r "%PROJECT_ROOT%\backend\*" %MINIPC_USER%@%MINIPC_IP%:/tmp/pantalla-backend/

echo.
echo [deploy] Instalando backend...
ssh %MINIPC_USER%@%MINIPC_IP% "sudo cp -r /tmp/pantalla-backend/* /opt/pantalla-reloj/backend/ && sudo rm -rf /tmp/pantalla-backend"

echo.
echo [deploy] Reiniciando servicios...
ssh %MINIPC_USER%@%MINIPC_IP% "sudo systemctl restart pantalla-dash-backend@%MINIPC_USER% || sudo systemctl restart pantalla-dash-backend@dani"

echo.
echo [deploy] ========================================
echo [deploy] Despliegue completado!
echo [deploy] ========================================
echo.
endlocal
