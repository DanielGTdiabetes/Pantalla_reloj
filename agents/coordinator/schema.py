"""Formato de reporte unificado para todos los agentes."""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class ApiHealthReport(BaseModel):
    """Reporte del estado de /api/health."""
    ok: bool = Field(..., description="Estado del endpoint")
    status_code: int = Field(..., description="Código HTTP")
    response_body: Optional[str] = Field(None, description="Cuerpo de respuesta (opcional)")


class AgentReport(BaseModel):
    """Formato de reporte unificado para agentes 1-7."""
    
    agent: str = Field(..., description="ID del agente (ej: 'agent-1', 'agent-2')")
    branch: str = Field(..., description="Rama de trabajo")
    prs: List[str] = Field(..., description="URLs de los PRs relacionados")
    changed_files: List[str] = Field(..., description="Archivos modificados")
    tests_ok: bool = Field(..., description="Tests pasados correctamente")
    manual_checks_ok: bool = Field(..., description="Chequeos manuales realizados y OK")
    api_health: ApiHealthReport = Field(..., description="Estado de /api/health")
    config_persists: bool = Field(
        default=True,
        description="Verificación de que /config persiste correctamente"
    )
    open_risks: List[str] = Field(
        default_factory=list,
        description="Riesgos abiertos identificados"
    )
    next_actions: List[str] = Field(
        default_factory=list,
        description="Próximas acciones recomendadas"
    )
    verification_commands: Optional[List[str]] = Field(
        None,
        description="Comandos de verificación ejecutados"
    )
    verification_outputs: Optional[Dict[str, str]] = Field(
        None,
        description="Salidas clave de los comandos de verificación"
    )
    health_check_curl: Optional[str] = Field(
        None,
        description="Salida de curl -sS http://127.0.0.1:8081/api/health"
    )
    compatibility_explanation: Optional[str] = Field(
        None,
        description="Explicación breve de por qué no rompe compatibilidad"
    )


class MergeOrder(BaseModel):
    """Orden sugerido de merge para los agentes."""
    suggested_order: List[str] = Field(..., description="Orden sugerido (agent-1, agent-5, etc.)")
    reasoning: str = Field(..., description="Razón del orden propuesto")


class CoordinatorReport(BaseModel):
    """Reporte final del coordinador."""
    timestamp: str = Field(..., description="Timestamp del reporte")
    total_agents: int = Field(..., description="Total de agentes procesados")
    approved_agents: List[str] = Field(..., description="Agentes aprobados para merge")
    rejected_agents: List[str] = Field(..., description="Agentes rechazados")
    merge_order: MergeOrder = Field(..., description="Orden de merge sugerido")
    blockers: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Bloqueadores identificados"
    )
    warnings: List[str] = Field(
        default_factory=list,
        description="Advertencias no bloqueantes"
    )














