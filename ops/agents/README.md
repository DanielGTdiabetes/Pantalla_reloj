# Directorio de Agentes - v23

Este directorio contiene la planificación, tracking y documentación para el release v23 de Pantalla_reloj.

---

## Estructura

```
ops/agents/
├── README.md                        # Este archivo
├── A0-plan.md                       # Plan maestro de orquestación v23
├── A1-TODO.md                       # TODO para A1 Backend Core
├── A2-TODO.md                       # TODO para A2 ICS & Calendar
├── A3-TODO.md                       # TODO para A3 Frontend Rotador
├── A4-TODO.md                       # TODO para A4 AEMET Provider
├── A5-TODO.md                       # TODO para A5 OpenSky Provider
├── A6-TODO.md                       # TODO para A6 AIS Provider
├── A7-TODO.md                       # TODO para A7 QA & Docs
├── smoke-report-template.md         # Plantilla de reporte de smoke tests
└── release-checklist.md             # Checklist de publicación
```

---

## Agentes

| ID | Nombre | Responsabilidad | Status |
|---|---|---|---|
| A0 | Orquestador | Coordinación, planificación, merge final | In Progress |
| A1 | Backend Core | `/api/config` persistente, systemd, venv | Pending |
| A2 | ICS & Calendar | ICS uploader, calendar por defecto | Pending |
| A3 | Frontend Rotador | Rotador paneles, iconos, control radar | Pending |
| A4 | AEMET Provider | Radar + CAP, integración | Pending |
| A5 | OpenSky Provider | OAuth2, autenticación | Pending |
| A6 | AIS Provider | Barcos AIS, integración | Pending |
| A7 | QA & Docs | Smoke tests, README, CHANGELOG | Pending |

---

## Proceso de Trabajo

### 1. Setup Inicial (A0)
- [x] Crear `A0-plan.md` con alcance, riesgos y hitos
- [x] Crear `trackers/v23.yml` con matriz de tareas
- [x] Crear TODOs para A1-A7
- [ ] Setup branch `release/v23`
- [ ] Crear PRs iniciales

### 2. Desarrollo (A1-A6)
Cada agente:
1. Lee su TODO correspondiente en `ops/agents/A{N}-TODO.md`
2. Trabaja en su branch `feature/A{N}-*`
3. Ejecuta comandos de verificación
4. Genera reporte en `reports/agent-N.json`
5. Crea PR a `release/v23`

### 3. Validación (A0, A7)
- A0 valida reportes: `python -m agents.coordinator.main reports/ -o informe_final.json`
- A7 ejecuta smoke tests: `./scripts/smoke_v23.sh dani`
- A7 actualiza documentación

### 4. Merge (A0)
- Merge en orden: A1 → A5 → A2 → A4 → A6 → A3 → A7
- Cada merge requiere smoke tests intermedios
- Merge final a `main` requiere aprobación

### 5. Release (A0, A7)
- Seguir `release-checklist.md`
- Tag `v23.0` creado
- Documentación publicada
- Deployment verificado

---

## Comandos Útiles

### Validar Reportes
```bash
python -m agents.coordinator.main reports/ -o informe_final.json
```

### Ejecutar Smoke Tests
```bash
./scripts/smoke_v23.sh dani
```

### Verificar Servicios
```bash
systemctl status pantalla-dash-backend@dani
journalctl -u pantalla-dash-backend@dani -n 50
```

### Verificar API
```bash
curl -sS http://127.0.0.1:8081/api/health
```

---

## Archivos Relacionados

- `ops/trackers/v23.yml` - Tracking detallado de tareas y milestones
- `scripts/smoke_v23.sh` - Script de smoke tests E2E
- `reports/agent-N.json` - Reportes de agentes (se generan durante desarrollo)
- `CHANGELOG.md` - Historial de cambios
- `README.md` - Documentación principal

---

## Referencias

- [A0 Plan Maestro](A0-plan.md)
- [Release Checklist](release-checklist.md)
- [Smoke Test Template](smoke-report-template.md)
- [Agent Coordinator Guide](../../agents/coordinator/README.md)

---

**Última actualización:** 2025-01-XX

