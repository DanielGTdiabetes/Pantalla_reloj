Write-Host "Iniciando Entorno de Desarrollo de Pantalla Reloj..."

$ConfigPath = "$PSScriptRoot\config.json"
$SecretsPath = "$PSScriptRoot\secrets.json"
$LogPath = "$PSScriptRoot\backend.log"

# Iniciar Backend
Write-Host "Iniciando Backend (Python FastAPI)..."
Write-Host "Config: $ConfigPath"
Write-Host "Secrets: $SecretsPath"
Write-Host "Log: $LogPath"

$BackendCmd = "/k set PANTALLA_CONFIG=$ConfigPath && set PANTALLA_SECRETS_FILE=$SecretsPath && set PANTALLA_BACKEND_LOG=$LogPath && .venv\Scripts\python.exe -m backend.main"
Start-Process -FilePath "cmd" -ArgumentList $BackendCmd -WorkingDirectory "$PSScriptRoot"

# Iniciar Frontend
Write-Host "Iniciando Frontend (Vite)..."
Start-Process -FilePath "cmd" -ArgumentList "/k cd dash-ui && npm run dev" -WorkingDirectory "$PSScriptRoot"

Write-Host "Servicios iniciados."
Write-Host "Backend: http://localhost:8081"
Write-Host "Frontend: http://localhost:5173"
Write-Host "Logs de Backend: $LogPath"
