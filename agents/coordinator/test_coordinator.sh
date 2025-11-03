#!/usr/bin/env bash
# Script de prueba para el agente coordinador

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Crear directorio de reportes de prueba
TEST_REPORTS_DIR="$PROJECT_ROOT/tmp/test_reports"
mkdir -p "$TEST_REPORTS_DIR"

echo "[TEST] Creando reportes de prueba..."

# Copiar ejemplo de reporte
cp "$SCRIPT_DIR/example_report.json" "$TEST_REPORTS_DIR/agent-1.json"

# Modificar para crear más ejemplos
cat > "$TEST_REPORTS_DIR/agent-5.json" << 'EOF'
{
  "agent": "agent-5",
  "branch": "feature/deps",
  "prs": ["https://github.com/user/repo/pull/124"],
  "changed_files": ["backend/config_manager.py"],
  "tests_ok": true,
  "manual_checks_ok": true,
  "api_health": {
    "ok": true,
    "status_code": 200
  },
  "config_persists": true,
  "open_risks": [],
  "next_actions": [],
  "verification_commands": ["pytest backend/tests/"],
  "verification_outputs": {"pytest": "15 passed"},
  "health_check_curl": "{\"status\":\"ok\"}",
  "compatibility_explanation": "Solo mejoras internas, sin cambios de API"
}
EOF

# Crear un reporte inválido (sin verificaciones)
cat > "$TEST_REPORTS_DIR/agent-2.json" << 'EOF'
{
  "agent": "agent-2",
  "branch": "feature/broken",
  "prs": ["https://github.com/user/repo/pull/125"],
  "changed_files": ["backend/main.py"],
  "tests_ok": false,
  "manual_checks_ok": false,
  "api_health": {
    "ok": false,
    "status_code": 500
  }
}
EOF

echo "[TEST] Ejecutando coordinador..."

# Ejecutar coordinador
cd "$PROJECT_ROOT"
python3 -m agents.coordinator.main "$TEST_REPORTS_DIR" -o "$PROJECT_ROOT/tmp/final_report.json" || true

echo "[TEST] Completado. Revisar $PROJECT_ROOT/tmp/final_report.json"








