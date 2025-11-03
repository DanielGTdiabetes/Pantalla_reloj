"""Validador de reportes de agentes con chequeos mínimos."""

import json
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .schema import AgentReport, ApiHealthReport


class ValidationError(Exception):
    """Error de validación de reporte."""
    pass


class ReportValidator:
    """Valida reportes de agentes según los requisitos mínimos."""
    
    REQUIRED_FIELDS = [
        "agent",
        "branch",
        "prs",
        "changed_files",
        "tests_ok",
        "manual_checks_ok",
        "api_health",
    ]
    
    REQUIRED_VERIFICATIONS = [
        "verification_commands",
        "verification_outputs",
        "health_check_curl",
        "compatibility_explanation",
    ]
    
    def __init__(self, strict_mode: bool = True):
        """
        Inicializa el validador.
        
        Args:
            strict_mode: Si True, rechaza PRs sin verificaciones completas.
        """
        self.strict_mode = strict_mode
    
    def validate_structure(self, data: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """
        Valida la estructura básica del reporte.
        
        Returns:
            Tuple[bool, List[str]]: (es_válido, lista_de_errores)
        """
        errors = []
        
        # Verificar campos requeridos
        for field in self.REQUIRED_FIELDS:
            if field not in data:
                errors.append(f"Campo requerido faltante: '{field}'")
        
        # Verificar tipos básicos
        if "agent" in data and not isinstance(data["agent"], str):
            errors.append("'agent' debe ser una cadena")
        
        if "prs" in data and not isinstance(data["prs"], list):
            errors.append("'prs' debe ser una lista")
        
        if "api_health" in data and not isinstance(data["api_health"], dict):
            errors.append("'api_health' debe ser un objeto")
        
        return len(errors) == 0, errors
    
    def validate_verifications(self, data: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """
        Valida que el reporte incluya todas las verificaciones requeridas.
        
        Returns:
            Tuple[bool, List[str]]: (es_válido, lista_de_errores)
        """
        errors = []
        
        if not self.strict_mode:
            return True, []
        
        # Verificar comandos de verificación
        if "verification_commands" not in data or not data["verification_commands"]:
            errors.append(
                "FALTA: Comandos de verificación ejecutados y salidas clave"
            )
        
        # Verificar salidas de verificación
        if "verification_outputs" not in data or not data["verification_outputs"]:
            errors.append(
                "FALTA: Salidas clave de los comandos de verificación"
            )
        
        # Verificar captura de curl de /api/health
        if "health_check_curl" not in data or not data["health_check_curl"]:
            errors.append(
                "FALTA: Captura de 'curl -sS http://127.0.0.1:8081/api/health'"
            )
        
        # Verificar explicación de compatibilidad
        if "compatibility_explanation" not in data or not data["compatibility_explanation"]:
            errors.append(
                "FALTA: Explicación breve de por qué no rompe compatibilidad"
            )
        
        return len(errors) == 0, errors
    
    def validate_health_check(self, api_health: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """
        Valida que el chequeo de /api/health sea correcto.
        
        Returns:
            Tuple[bool, List[str]]: (es_válido, lista_de_errores)
        """
        errors = []
        
        if "ok" not in api_health:
            errors.append("'api_health.ok' es requerido")
        elif not api_health["ok"]:
            errors.append("'/api/health' no está funcionando correctamente")
        
        if "status_code" not in api_health:
            errors.append("'api_health.status_code' es requerido")
        elif api_health.get("status_code") != 200:
            errors.append(
                f"'/api/health' retornó código {api_health.get('status_code')}, "
                "se esperaba 200"
            )
        
        return len(errors) == 0, errors
    
    def validate_tests(self, data: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """
        Valida que los tests hayan pasado.
        
        Returns:
            Tuple[bool, List[str]]: (es_válido, lista_de_errores)
        """
        errors = []
        
        if "tests_ok" not in data:
            errors.append("'tests_ok' es requerido")
        elif not data["tests_ok"]:
            errors.append("Los tests no han pasado")
        
        return len(errors) == 0, errors
    
    def validate_manual_checks(self, data: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """
        Valida que los chequeos manuales estén OK.
        
        Returns:
            Tuple[bool, List[str]]: (es_válido, lista_de_errores)
        """
        errors = []
        
        if "manual_checks_ok" not in data:
            errors.append("'manual_checks_ok' es requerido")
        elif not data["manual_checks_ok"]:
            errors.append("Los chequeos manuales no están OK")
        
        return len(errors) == 0, errors
    
    def validate_config_persistence(self, data: Dict[str, Any]) -> Tuple[bool, List[str]]:
        """
        Valida que /config persista correctamente.
        
        Returns:
            Tuple[bool, List[str]]: (es_válido, lista_de_errores)
        """
        errors = []
        
        if "config_persists" in data and not data["config_persists"]:
            errors.append(
                "La persistencia de /config no está funcionando correctamente"
            )
        
        return len(errors) == 0, errors
    
    def validate_report(self, data: Dict[str, Any]) -> Tuple[bool, List[str], AgentReport]:
        """
        Valida un reporte completo de agente.
        
        Args:
            data: Datos del reporte JSON
            
        Returns:
            Tuple[bool, List[str], Optional[AgentReport]]:
                (es_válido, lista_de_errores, reporte_parseado)
        """
        all_errors = []
        
        # Validar estructura
        valid_structure, errors = self.validate_structure(data)
        all_errors.extend(errors)
        
        if not valid_structure:
            return False, all_errors, None
        
        # Validar verificaciones
        valid_verifications, errors = self.validate_verifications(data)
        all_errors.extend(errors)
        
        # Validar api_health
        if "api_health" in data:
            valid_health, errors = self.validate_health_check(data["api_health"])
            all_errors.extend(errors)
        else:
            valid_health = False
        
        # Validar tests
        valid_tests, errors = self.validate_tests(data)
        all_errors.extend(errors)
        
        # Validar chequeos manuales
        valid_manual, errors = self.validate_manual_checks(data)
        all_errors.extend(errors)
        
        # Validar persistencia de config
        valid_config, errors = self.validate_config_persistence(data)
        all_errors.extend(errors)
        
        # Intentar parsear el reporte
        try:
            report = AgentReport(**data)
        except Exception as e:
            all_errors.append(f"Error al parsear reporte: {e}")
            return False, all_errors, None
        
        # Determinar si es válido
        is_valid = (
            valid_structure and
            valid_health and
            valid_tests and
            valid_manual and
            valid_config and
            (valid_verifications if self.strict_mode else True)
        )
        
        return is_valid, all_errors, report
    
    def load_and_validate(self, report_path: Path) -> Tuple[bool, List[str], Optional[AgentReport]]:
        """
        Carga y valida un reporte desde un archivo JSON.
        
        Args:
            report_path: Ruta al archivo JSON del reporte
            
        Returns:
            Tuple[bool, List[str], Optional[AgentReport]]:
                (es_válido, lista_de_errores, reporte_parseado)
        """
        try:
            with open(report_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except FileNotFoundError:
            return False, [f"Archivo no encontrado: {report_path}"], None
        except json.JSONDecodeError as e:
            return False, [f"Error al parsear JSON: {e}"], None
        
        return self.validate_report(data)









