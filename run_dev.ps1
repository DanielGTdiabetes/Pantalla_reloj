Write-Host "Iniciando Entorno de Desarrollo de Pantalla Reloj..."

$ConfigPath = "$PSScriptRoot\config.json"
$SecretsPath = "$PSScriptRoot\secrets.json"

# Iniciar Backend
Write-Host "Iniciando Backend (Python FastAPI)..."
Write-Host "Config: $ConfigPath"
Write-Host "Secrets: $SecretsPath"

$BackendCmd = "/k set PANTALLA_CONFIG=$ConfigPath && set PANTALLA_SECRETS_FILE=$SecretsPath && .venv\Scripts\python.exe -m backend.main"
Start-Process -FilePath "cmd" -ArgumentList $BackendCmd -WorkingDirectory "$PSScriptRoot"

# Iniciar Frontend
Write-Host "Iniciando Frontend (Vite)..."
Start-Process -FilePath "cmd" -ArgumentList "/k cd dash-ui && npm run dev" -WorkingDirectory "$PSScriptRoot"

Write-Host "Servicios iniciados en ventanas separadas."
Write-Host "Backend: http://localhost:8081"
Write-Host "Frontend: http://localhost:5173"
