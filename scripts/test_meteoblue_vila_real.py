"""
Script de prueba para consultar Meteoblue (clima actual y pronóstico semanal)
para Vila-real (Castellón, CP 12540).

- Usa la API key definida en la variable de entorno `METEOBLUE_API_KEY`.
- Si no está definida, intenta leerla de `secrets.json` (`meteoblue_api_key`).
- Muestra un resumen del clima actual y los próximos 7 días.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any, Dict

import requests

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.services.meteoblue_service import MeteoblueService

# Coordenadas aproximadas de Vila-real (Castellón, CP 12540)
VILA_REAL_LAT = 39.9389
VILA_REAL_LON = -0.1031


def load_api_key() -> str:
    """Obtiene la API key desde el entorno o `secrets.json`."""
    env_key = os.getenv("METEOBLUE_API_KEY")
    if env_key:
        return env_key

    secrets_path = Path("secrets.json")
    if secrets_path.exists():
        try:
            data: Dict[str, Any] = json.loads(secrets_path.read_text())
            key = data.get("meteoblue_api_key")
            if key:
                return key
        except json.JSONDecodeError:
            pass

    raise SystemExit(
        "No se encontró la API key de Meteoblue. "
        "Define METEOBLUE_API_KEY o añade `meteoblue_api_key` en secrets.json"
    )


def main() -> None:
    api_key = load_api_key()

    service = MeteoblueService(api_key=api_key)
    print("=== Meteoblue: Consulta para Vila-real (Castellón, 12540) ===")
    print(f"Usando API key: {'••••' + api_key[-4:]}")
    print(f"Coordenadas: lat={VILA_REAL_LAT}, lon={VILA_REAL_LON}\n")

    # Petición y parseo
    try:
        raw_data = service.fetch_weather(VILA_REAL_LAT, VILA_REAL_LON)
    except requests.RequestException as exc:
        print(
            "No se pudo obtener datos de Meteoblue (fallo de red o proxy).",
            f"Detalle: {exc}",
            sep="\n",
        )
        return
    current = service.parse_current_weather(raw_data)
    forecast = service.parse_forecast(raw_data, days=7)

    print("Clima actual:")
    print(
        f"  Temperatura: {current.get('temperature')}°{current.get('temperature_unit', 'C')}"
        f" (sensación {current.get('felt_temperature')}°{current.get('temperature_unit', 'C')})"
    )
    print(f"  Humedad: {current.get('humidity')}%")
    print(f"  Viento: {current.get('wind_speed')} km/h")
    print(f"  Condición: {current.get('condition')} (pictocode={current.get('pictocode')})\n")

    print("Pronóstico 7 días:")
    for day in forecast:
        date = day.get("date")
        print(
            f"  {date}: max {day.get('temp_max')}°C, min {day.get('temp_min')}°C, "
            f"lluvia {day.get('precipitation_probability')}%, "
            f"condición {day.get('condition')} (pictocode={day.get('pictocode')})"
        )

    print("\nConsulta completada correctamente.")


if __name__ == "__main__":
    main()
