#!/usr/bin/env python3
"""Script CLI para el agente coordinador."""

import argparse
import sys
from pathlib import Path

from .coordinator import Coordinator


def main():
    """Función principal del CLI."""
    parser = argparse.ArgumentParser(
        description="Agente Coordinador (Rol 8): Valida PRs y coordina merges"
    )
    
    parser.add_argument(
        "reports_dir",
        type=Path,
        help="Directorio con los reportes JSON de los agentes"
    )
    
    parser.add_argument(
        "-o", "--output",
        type=Path,
        help="Archivo donde guardar el informe final (JSON)"
    )
    
    parser.add_argument(
        "--api-url",
        default="http://127.0.0.1:8081",
        help="URL base de la API (default: http://127.0.0.1:8081)"
    )
    
    parser.add_argument(
        "--lenient",
        action="store_true",
        help="Modo permisivo: no rechaza PRs sin verificaciones completas"
    )
    
    args = parser.parse_args()
    
    # Verificar que el directorio existe
    if not args.reports_dir.exists():
        print(f"ERROR: El directorio {args.reports_dir} no existe", file=sys.stderr)
        sys.exit(1)
    
    # Crear coordinador
    coordinator = Coordinator(
        reports_dir=args.reports_dir,
        strict_mode=not args.lenient,
        api_url=args.api_url
    )
    
    # Ejecutar coordinación
    try:
        report = coordinator.run(output_file=args.output)
        
        # Código de salida: 0 si hay agentes aprobados, 1 si todos fueron rechazados
        if not report.approved_agents:
            print("\n[COORD] ERROR: No hay agentes aprobados para merge", file=sys.stderr)
            sys.exit(1)
        
        if report.blockers:
            print("\n[COORD] WARNING: Hay bloqueadores encontrados", file=sys.stderr)
            # No salir con error si hay bloqueadores pero algunos agentes están aprobados
        
        sys.exit(0)
    
    except KeyboardInterrupt:
        print("\n[COORD] Interrumpido por el usuario", file=sys.stderr)
        sys.exit(130)
    except Exception as e:
        print(f"[COORD] ERROR: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()









