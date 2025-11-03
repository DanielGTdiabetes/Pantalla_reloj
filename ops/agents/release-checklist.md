# Checklist de Publicación v23

**Versión:** 23.0  
**Target:** Release a `main`  
**Fecha objetivo:** D+20  

---

## Pre-Release (D-3 a D-1)

### Planning
- [ ] `ops/agents/A0-plan.md` completado y aprobado
- [ ] `ops/trackers/v23.yml` creado con todos los items
- [ ] Branch `release/v23` creada y protegida
- [ ] Ramas hijas creadas: `feature/A1-*` a `feature/A7-*`
- [ ] TODOs para A1-A7 creados en `ops/agents/`

### Development
- [ ] Todos los agentes A1-A6 han completado su trabajo
- [ ] Todos los agentes han generado sus reportes en `reports/agent-N.json`
- [ ] Agente A7 ha ejecutado smoke tests completos (5/5)
- [ ] No hay blockers abiertos en `ops/trackers/v23.yml`

### QA
- [ ] `./scripts/smoke_v23.sh dani` pasa 5/5
- [ ] `pytest backend/tests/ -v` pasa 100%
- [ ] `npm test` en `dash-ui` pasa
- [ ] Pruebas manuales de UI completadas
- [ ] Pruebas visuales documentadas

### Documentation
- [ ] README actualizado con cambios v23
- [ ] CHANGELOG tiene entrada v23 completa
- [ ] Guía de pruebas visuales disponible
- [ ] Reportes de agentes disponibles

---

## Release (D-Day)

### Merge Preparation
- [ ] Coordinador (A0) valida todos los reportes: `python -m agents.coordinator.main reports/ -o informe_final.json`
- [ ] No hay agentes rechazados
- [ ] Merge order confirmado: A1 → A5 → A2 → A4 → A6 → A3 → A7
- [ ] Todas las ramas hijas merged a `release/v23`
- [ ] No hay conflictos de merge
- [ ] CI/CD pasa (si aplica)

### Verification
- [ ] `git checkout release/v23` en entorno limpio
- [ ] `./scripts/install.sh` ejecuta sin errores
- [ ] `./scripts/smoke_v23.sh dani` pasa 5/5
- [ ] UI funciona correctamente en 1920×480
- [ ] Todos los servicios systemd activos
- [ ] Logs limpios sin errores críticos

### Merge to Main
- [ ] PR de `release/v23` a `main` creado
- [ ] PR aprobado por A0 y al menos 1 reviewer adicional
- [ ] Code review completado
- [ ] Todos los comentarios resueltos
- [ ] Merge ejecutado (squash merge)

---

## Post-Release (D+1)

### Tagging
- [ ] Tag creado: `git tag v23.0`
- [ ] Tag anotado: `git tag -a v23.0 -m "Release v23.0: Backend stable, ICS calendar, frontend rotator"`
- [ ] Tag pushed: `git push origin v23.0`

### Deployment
- [ ] Servidor de producción actualizado
- [ ] `git checkout v23.0` en producción
- [ ] `./scripts/install.sh` ejecutado
- [ ] Smoke tests ejecutados en producción (5/5)
- [ ] Verificación manual en producción

### Monitoring
- [ ] Monitoreo de logs activado: `journalctl -u pantalla-dash-backend@dani -f`
- [ ] Monitoreo de errores activado
- [ ] Alertas configuradas
- [ ] Dashboard de métricas visible

### Communication
- [ ] CHANGELOG publicado
- [ ] README publicado
- [ ] Nota de release publicada (si aplica)
- [ ] Equipo notificado

---

## Rollback (Si Necesario)

### Preparation
- [ ] Identificar tag anterior: `git tag | tail -5`
- [ ] Verificar que rollback script existe
- [ ] Documentar pasos de rollback

### Execution
- [ ] `git checkout <tag_anterior>`
- [ ] `./scripts/install.sh` ejecutado
- [ ] Smoke tests ejecutados (5/5)
- [ ] Verificación manual
- [ ] Monitoreo activado

### Post-Rollback
- [ ] Issue creado para investigar causa
- [ ] Equipo notificado
- [ ] Plan de fix documentado
- [ ] Hotfix branch creado (si aplica)

---

## Sign-Off

- **Coordinador (A0):** ____________________ Fecha: _______
- **QA Lead (A7):** ____________________ Fecha: _______
- **Tech Lead:** ____________________ Fecha: _______
- **Release Manager:** ____________________ Fecha: _______

---

## Notes

(Espacio para notas adicionales)

---

**Última actualización:** 2025-01-XX

