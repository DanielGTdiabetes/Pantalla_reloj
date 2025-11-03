"""Lógica de ordenamiento de merges para agentes."""

from typing import List, Dict, Any, Optional
from .schema import MergeOrder


class MergeOrderCalculator:
    """Calcula el orden sugerido de merge para los agentes."""
    
    # Orden sugerido: 1→5→2→3→4→6→7
    DEFAULT_ORDER = ["agent-1", "agent-5", "agent-2", "agent-3", "agent-4", "agent-6", "agent-7"]
    
    REASONING = (
        "Orden sugerido: 1→5→2→3→4→6→7. "
        "Este orden minimiza dependencias y permite pruebas intermedias "
        "tras cada merge. Los agentes 1 y 5 son fundamentales y se prueban primero, "
        "seguidos por 2, 3 y 4 que pueden tener dependencias entre sí, "
        "y finalmente 6 y 7 que suelen depender de los anteriores."
    )
    
    def __init__(self, custom_order: Optional[List[str]] = None):
        """
        Inicializa el calculador.
        
        Args:
            custom_order: Orden personalizado (opcional)
        """
        self.default_order = custom_order or self.DEFAULT_ORDER
    
    def calculate_order(
        self,
        approved_agents: List[str],
        agent_reports: Dict[str, Any]
    ) -> MergeOrder:
        """
        Calcula el orden de merge basado en los agentes aprobados.
        
        Args:
            approved_agents: Lista de IDs de agentes aprobados
            agent_reports: Dict con información de los agentes
            
        Returns:
            MergeOrder con el orden sugerido
        """
        # Filtrar solo los agentes aprobados y ordenarlos según el orden por defecto
        ordered_approved = []
        
        # Primero, agregar en el orden sugerido
        for agent_id in self.default_order:
            if agent_id in approved_agents:
                ordered_approved.append(agent_id)
        
        # Agregar cualquier agente aprobado que no esté en el orden por defecto
        for agent_id in approved_agents:
            if agent_id not in ordered_approved:
                ordered_approved.append(agent_id)
        
        # Generar reasoning personalizado si hay cambios
        if len(ordered_approved) < len(self.default_order):
            missing = set(self.default_order) - set(approved_agents)
            reasoning = (
                f"{self.REASONING} "
                f"Nota: Algunos agentes no están aprobados: {sorted(missing)}. "
                f"Se mergearán solo los aprobados en el orden sugerido."
            )
        else:
            reasoning = self.REASONING
        
        return MergeOrder(
            suggested_order=ordered_approved,
            reasoning=reasoning
        )
    
    def get_default_order(self) -> List[str]:
        """Retorna el orden por defecto."""
        return self.default_order.copy()

