# Agente Coordinador (Rol 8)

Coordinador que valida PRs de los agentes 1-7 y asegura que pasen tests, que no rompan `/api/health`, y que `/config` persista.

## Funcionalidades

1. **Validación de reportes**: Verifica que los reportes JSON de los agentes cumplan con el formato unificado.
2. **Chequeos mínimos**: Rechaza PRs que no incluyan:
   - Comandos de verificación ejecutados y salidas clave
   - Captura de `curl -sS http://127.0.0.1:8081/api/health`
   - Explicación breve de por qué no rompe compatibilidad
3. **Verificación de endpoints**: Valida que `/api/health` funcione y que `/config` persista.
4. **Ordenamiento de merges**: Sugiere orden 1→5→2→3→4→6→7 con pruebas intermedias.

## Formato de Reporte Unificado

Todos los agentes deben generar reportes en el siguiente formato:

```json
{
  "agent": "agent-1",
  "branch": "feature/xyz",
  "prs": ["https://github.com/.../pull/123"],
  "changed_files": ["backend/main.py", "backend/models.py"],
  "tests_ok": true,
  "manual_checks_ok": true,
  "api_health": {
    "ok": true,
    "status_code": 200
  },
  "config_persists": true,
  "open_risks": [],
  "next_actions": [],
  "verification_commands": [
    "pytest backend/tests/",
    "curl -sS http://127.0.0.1:8081/api/health"
  ],
  "verification_outputs": {
    "pytest": "...",
    "curl": "..."
  },
  "health_check_curl": "{\"status\":\"ok\",...}",
  "compatibility_explanation": "Los cambios son compatibles porque..."
}
```

## Uso

### CLI

```bash
# Validar reportes en un directorio
python -m agents.coordinator.main reports/ -o informe_final.json

# Modo permisivo (no rechaza por verificaciones faltantes)
python -m agents.coordinator.main reports/ --lenient

# Especificar URL de API diferente
python -m agents.coordinator.main reports/ --api-url http://localhost:8081
```

### Como módulo Python

```python
from pathlib import Path
from agents.coordinator import Coordinator

coordinator = Coordinator(
    reports_dir=Path("reports/"),
    strict_mode=True,
    api_url="http://127.0.0.1:8081"
)

report = coordinator.run(output_file=Path("informe_final.json"))

print(f"Aprobados: {report.approved_agents}")
print(f"Rechazados: {report.rejected_agents}")
```

## Estructura del Informe Final

El informe final incluye:

- `timestamp`: Timestamp del informe
- `total_agents`: Total de agentes procesados
- `approved_agents`: Lista de agentes aprobados para merge
- `rejected_agents`: Lista de agentes rechazados
- `merge_order`: Orden sugerido de merge
- `blockers`: Lista de bloqueadores encontrados
- `warnings`: Advertencias no bloqueantes

## Orden de Merge Sugerido

1. **agent-1** → Base fundamental
2. **agent-5** → Dependencias críticas
3. **agent-2** → Funcionalidades básicas
4. **agent-3** → Extensiones
5. **agent-4** → Mejoras
6. **agent-6** → Optimizaciones
7. **agent-7** → Finalizaciones

Se recomienda ejecutar pruebas intermedias tras cada merge.

## Códigos de Salida

- `0`: Éxito, hay agentes aprobados
- `1`: Error, no hay agentes aprobados o error en la ejecución
- `130`: Interrupción por el usuario (Ctrl+C)










