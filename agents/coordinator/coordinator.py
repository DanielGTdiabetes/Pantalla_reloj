"""Agente Coordinador principal: valida reportes y genera informe final."""

import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .health_checker import HealthChecker, HealthCheckError, ConfigPersistenceError
from .merge_order import MergeOrderCalculator
from .schema import AgentReport, CoordinatorReport, MergeOrder
from .validator import ReportValidator, ValidationError


class Coordinator:
    """Coordinador principal que valida PRs y genera informe final."""
    
    def __init__(
        self,
        reports_dir: Path,
        strict_mode: bool = True,
        api_url: str = "http://127.0.0.1:8081"
    ):
        """
        Inicializa el coordinador.
        
        Args:
            reports_dir: Directorio con los reportes JSON de los agentes
            strict_mode: Si True, rechaza PRs sin verificaciones completas
            api_url: URL base de la API
        """
        self.reports_dir = Path(reports_dir)
        self.validator = ReportValidator(strict_mode=strict_mode)
        self.health_checker = HealthChecker(api_url=api_url)
        self.merge_calculator = MergeOrderCalculator()
    
    def load_all_reports(self) -> Dict[str, Dict[str, Any]]:
        """
        Carga todos los reportes JSON del directorio.
        
        Returns:
            Dict[agent_id, reporte_data]
        """
        reports = {}
        
        if not self.reports_dir.exists():
            return reports
        
        # Buscar archivos JSON en el directorio
        for json_file in self.reports_dir.glob("*.json"):
            try:
                with open(json_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    agent_id = data.get("agent", json_file.stem)
                    reports[agent_id] = data
            except Exception as e:
                print(f"[WARNING] Error al cargar {json_file}: {e}", file=sys.stderr)
        
        return reports
    
    def validate_all_reports(
        self,
        reports: Dict[str, Dict[str, Any]]
    ) -> Tuple[Dict[str, AgentReport], Dict[str, List[str]]]:
        """
        Valida todos los reportes.
        
        Returns:
            Tuple[reportes_válidos, errores_por_agente]
        """
        valid_reports = {}
        errors_by_agent = {}
        
        for agent_id, data in reports.items():
            is_valid, errors, report = self.validator.validate_report(data)
            
            if is_valid and report:
                valid_reports[agent_id] = report
            else:
                errors_by_agent[agent_id] = errors
        
        return valid_reports, errors_by_agent
    
    def verify_api_health(self) -> Tuple[bool, Optional[str]]:
        """
        Verifica que /api/health funcione correctamente.
        
        Returns:
            Tuple[ok, mensaje_error]
        """
        try:
            result = self.health_checker.check_health_python()
            if result["ok"] and result["status_code"] == 200:
                return True, None
            else:
                return False, (
                    f"/api/health retornó código {result['status_code']} "
                    f"o respuesta inválida"
                )
        except HealthCheckError as e:
            return False, str(e)
    
    def verify_config_persistence(self) -> Tuple[bool, Optional[str]]:
        """
        Verifica que /config persista correctamente.
        
        Returns:
            Tuple[ok, mensaje_error]
        """
        try:
            result = self.health_checker.check_config_persistence()
            if result["ok"] and result["config_valid"]:
                return True, None
            else:
                return False, (
                    f"/api/config no persiste correctamente "
                    f"(status: {result.get('status_code')}, "
                    f"config_valid: {result.get('config_valid')})"
                )
        except ConfigPersistenceError as e:
            return False, str(e)
    
    def classify_agents(
        self,
        valid_reports: Dict[str, AgentReport],
        errors_by_agent: Dict[str, List[str]]
    ) -> Tuple[List[str], List[str], List[Dict[str, Any]]]:
        """
        Clasifica agentes en aprobados, rechazados y bloqueadores.
        
        Returns:
            Tuple[aprobados, rechazados, bloqueadores]
        """
        approved = []
        rejected = []
        blockers = []
        
        # Agentes con errores de validación
        for agent_id, errors in errors_by_agent.items():
            rejected.append(agent_id)
            blockers.append({
                "agent": agent_id,
                "type": "validation_error",
                "errors": errors,
            })
        
        # Agentes válidos pero con problemas
        for agent_id, report in valid_reports.items():
            agent_errors = []
            
            # Verificar tests
            if not report.tests_ok:
                agent_errors.append("Tests no pasaron")
            
            # Verificar chequeos manuales
            if not report.manual_checks_ok:
                agent_errors.append("Chequeos manuales no están OK")
            
            # Verificar api_health
            if not report.api_health.ok or report.api_health.status_code != 200:
                agent_errors.append(
                    f"/api/health no funciona correctamente "
                    f"(status: {report.api_health.status_code})"
                )
            
            # Verificar persistencia de config
            if not report.config_persists:
                agent_errors.append("/config no persiste correctamente")
            
            # Verificar riesgos abiertos
            if report.open_risks:
                agent_errors.append(f"Riesgos abiertos: {', '.join(report.open_risks)}")
            
            if agent_errors:
                rejected.append(agent_id)
                blockers.append({
                    "agent": agent_id,
                    "type": "check_failure",
                    "errors": agent_errors,
                })
            else:
                approved.append(agent_id)
        
        return approved, rejected, blockers
    
    def generate_report(
        self,
        valid_reports: Dict[str, AgentReport],
        approved: List[str],
        rejected: List[str],
        blockers: List[Dict[str, Any]]
    ) -> CoordinatorReport:
        """
        Genera el informe final del coordinador.
        
        Returns:
            CoordinatorReport con toda la información
        """
        # Verificar estado actual de la API
        api_health_ok, api_health_error = self.verify_api_health()
        config_persist_ok, config_persist_error = self.verify_config_persistence()
        
        warnings = []
        if not api_health_ok:
            warnings.append(
                f"ADVERTENCIA: /api/health no funciona correctamente: {api_health_error}"
            )
        if not config_persist_ok:
            warnings.append(
                f"ADVERTENCIA: /config no persiste: {config_persist_error}"
            )
        
        # Calcular orden de merge
        merge_order = self.merge_calculator.calculate_order(approved, valid_reports)
        
        return CoordinatorReport(
            timestamp=datetime.now().isoformat(),
            total_agents=len(valid_reports) + len(rejected),
            approved_agents=approved,
            rejected_agents=rejected,
            merge_order=merge_order,
            blockers=blockers,
            warnings=warnings,
        )
    
    def run(self, output_file: Optional[Path] = None) -> CoordinatorReport:
        """
        Ejecuta el proceso completo de coordinación.
        
        Args:
            output_file: Archivo donde guardar el informe final (opcional)
            
        Returns:
            CoordinatorReport con el informe final
        """
        # Cargar todos los reportes
        print(f"[COORD] Cargando reportes desde {self.reports_dir}...")
        reports = self.load_all_reports()
        
        if not reports:
            print("[COORD] No se encontraron reportes", file=sys.stderr)
            return CoordinatorReport(
                timestamp=datetime.now().isoformat(),
                total_agents=0,
                approved_agents=[],
                rejected_agents=[],
                merge_order=MergeOrder(
                    suggested_order=[],
                    reasoning="No hay reportes para procesar"
                ),
            )
        
        print(f"[COORD] Cargados {len(reports)} reportes")
        
        # Validar todos los reportes
        print("[COORD] Validando reportes...")
        valid_reports, errors_by_agent = self.validate_all_reports(reports)
        
        # Clasificar agentes
        print("[COORD] Clasificando agentes...")
        approved, rejected, blockers = self.classify_agents(valid_reports, errors_by_agent)
        
        # Generar informe final
        print("[COORD] Generando informe final...")
        final_report = self.generate_report(valid_reports, approved, rejected, blockers)
        
        # Guardar informe si se especifica
        if output_file:
            output_path = Path(output_file)
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with open(output_path, "w", encoding="utf-8") as f:
                json.dump(final_report.model_dump(), f, indent=2, ensure_ascii=False)
            print(f"[COORD] Informe guardado en {output_path}")
        
        # Imprimir resumen
        print("\n" + "="*60)
        print("INFORME FINAL DEL COORDINADOR")
        print("="*60)
        print(f"Total de agentes: {final_report.total_agents}")
        print(f"Aprobados: {len(final_report.approved_agents)}")
        print(f"Rechazados: {len(final_report.rejected_agents)}")
        
        if final_report.approved_agents:
            print(f"\nOrden de merge sugerido:")
            for i, agent_id in enumerate(final_report.merge_order.suggested_order, 1):
                print(f"  {i}. {agent_id}")
        
        if final_report.rejected_agents:
            print(f"\nAgentes rechazados:")
            for agent_id in final_report.rejected_agents:
                print(f"  - {agent_id}")
        
        if final_report.blockers:
            print(f"\nBloqueadores encontrados:")
            for blocker in final_report.blockers:
                print(f"  - {blocker['agent']}: {blocker['type']}")
                for error in blocker['errors']:
                    print(f"    * {error}")
        
        if final_report.warnings:
            print(f"\nAdvertencias:")
            for warning in final_report.warnings:
                print(f"  - {warning}")
        
        print("="*60)
        
        return final_report













