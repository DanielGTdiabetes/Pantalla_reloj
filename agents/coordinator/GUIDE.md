# Guía de Uso del Agente Coordinador

## Resumen

El **Agente Coordinador (Rol 8)** valida los PRs de los agentes 1-7 y asegura que:
- ✅ Pasen todos los tests
- ✅ No rompan `/api/health`
- ✅ `/config` persista correctamente
- ✅ Incluyan todas las verificaciones requeridas

## Formato de Reporte Requerido

Cada agente (1-7) debe generar un archivo JSON con el siguiente formato:

### Campos Obligatorios

```json
{
  "agent": "agent-1",                    // ID del agente (agent-1 a agent-7)
  "branch": "feature/nombre-rama",       // Rama de trabajo
  "prs": ["https://github.com/.../pull/123"],  // URLs de PRs
  "changed_files": ["path/to/file.py"], // Archivos modificados
  "tests_ok": true,                      // Tests pasaron
  "manual_checks_ok": true,              // Chequeos manuales OK
  "api_health": {
    "ok": true,                          // /api/health funciona
    "status_code": 200                   // Código HTTP
  }
}
```

### Campos Opcionales pero Recomendados

```json
{
  "config_persists": true,               // /config persiste (default: true)
  "open_risks": [],                      // Riesgos abiertos
  "next_actions": []                     // Próximas acciones
}
```

### Campos Requeridos en Modo Estricto

En modo estricto (por defecto), el coordinador **rechazará** PRs que no incluyan:

```json
{
  "verification_commands": [             // Comandos ejecutados
    "pytest backend/tests/",
    "curl -sS http://127.0.0.1:8081/api/health"
  ],
  "verification_outputs": {              // Salidas clave
    "pytest": "15 passed in 2.34s",
    "curl": "{\"status\":\"ok\"}"
  },
  "health_check_curl": "{\"status\":\"ok\"}",  // Salida de curl
  "compatibility_explanation": "Los cambios son compatibles porque..."  // Explicación
}
```

## Ejemplo de Reporte Completo

Ver `example_report.json` para un ejemplo completo.

## Generación de Reportes

### Para Agentes 1-7

Cada agente debe generar su reporte después de:
1. Ejecutar los tests
2. Verificar manualmente que todo funciona
3. Ejecutar `curl -sS http://127.0.0.1:8081/api/health`
4. Verificar que `/api/config` persiste
5. Documentar cambios y compatibilidad

### Script de Ejemplo (para agentes)

```python
import json
import subprocess
from pathlib import Path

def generate_agent_report(agent_id: str, branch: str, prs: list, changed_files: list):
    # Ejecutar tests
    test_result = subprocess.run(
        ["pytest", "backend/tests/", "-v"],
        capture_output=True,
        text=True
    )
    tests_ok = test_result.returncode == 0
    
    # Verificar /api/health
    curl_result = subprocess.run(
        ["curl", "-sS", "http://127.0.0.1:8081/api/health"],
        capture_output=True,
        text=True
    )
    health_ok = curl_result.returncode == 0 and curl_result.stdout
    
    # Parsear respuesta de health
    try:
        health_json = json.loads(curl_result.stdout)
        api_health = {
            "ok": health_json.get("status") == "ok",
            "status_code": 200
        }
    except:
        api_health = {"ok": False, "status_code": 500}
    
    report = {
        "agent": agent_id,
        "branch": branch,
        "prs": prs,
        "changed_files": changed_files,
        "tests_ok": tests_ok,
        "manual_checks_ok": True,  # Asumir OK si se verificó manualmente
        "api_health": api_health,
        "config_persists": True,  # Verificar si es necesario
        "open_risks": [],
        "next_actions": [],
        "verification_commands": [
            "pytest backend/tests/ -v",
            "curl -sS http://127.0.0.1:8081/api/health"
        ],
        "verification_outputs": {
            "pytest": test_result.stdout,
            "curl": curl_result.stdout
        },
        "health_check_curl": curl_result.stdout,
        "compatibility_explanation": "Explicar por qué los cambios no rompen compatibilidad"
    }
    
    # Guardar reporte
    output_path = Path(f"reports/{agent_id}.json")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    
    return report

# Ejemplo de uso
if __name__ == "__main__":
    generate_agent_report(
        agent_id="agent-1",
        branch="feature/example",
        prs=["https://github.com/user/repo/pull/123"],
        changed_files=["backend/main.py"]
    )
```

## Uso del Coordinador

### Validar Reportes

```bash
# Desde la raíz del proyecto
python -m agents.coordinator.main reports/ -o informe_final.json
```

### Modo Permisivo

Si algunos agentes no tienen todas las verificaciones pero quieres ver el informe:

```bash
python -m agents.coordinator.main reports/ --lenient -o informe_final.json
```

### Con API Personalizada

```bash
python -m agents.coordinator.main reports/ --api-url http://localhost:8081
```

## Interpretación del Informe Final

El informe final incluye:

### Campos Principales

- `approved_agents`: Agentes que pueden hacer merge
- `rejected_agents`: Agentes que NO deben hacer merge
- `merge_order.suggested_order`: Orden sugerido (1→5→2→3→4→6→7)
- `blockers`: Lista de problemas que bloquean merges
- `warnings`: Advertencias no bloqueantes

### Códigos de Salida

- `0`: Hay agentes aprobados (éxito)
- `1`: No hay agentes aprobados o error crítico
- `130`: Interrupción por usuario (Ctrl+C)

## Flujo de Trabajo Recomendado

1. **Cada agente genera su reporte** en `reports/agent-N.json`
2. **El coordinador valida todos los reportes**:
   ```bash
   python -m agents.coordinator.main reports/ -o informe_final.json
   ```
3. **Revisar el informe final** para ver:
   - Qué agentes están aprobados
   - Qué problemas hay
   - Orden sugerido de merge
4. **Mergear en el orden sugerido** (1→5→2→3→4→6→7)
5. **Ejecutar pruebas intermedias** tras cada merge

## Troubleshooting

### "Campo requerido faltante: 'verification_commands'"

El agente no incluyó los comandos de verificación. Agregar:
```json
"verification_commands": ["pytest ...", "curl ..."]
```

### "/api/health no funciona correctamente"

Verificar que:
1. El backend esté corriendo en `http://127.0.0.1:8081`
2. El endpoint `/api/health` responda con status 200
3. La respuesta sea JSON válido con `{"status": "ok"}`

### "Los tests no han pasado"

Ejecutar los tests y corregir los errores:
```bash
pytest backend/tests/ -v
```

### "FALTA: Captura de 'curl -sS http://127.0.0.1:8081/api/health'"

Incluir en el reporte:
```json
"health_check_curl": "{\"status\":\"ok\",...}"
```

Ejecutar:
```bash
curl -sS http://127.0.0.1:8081/api/health
```

Y copiar la salida al campo `health_check_curl`.
















