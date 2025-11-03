"""Verificador de /api/health y persistencia de /config."""

import json
import subprocess
from typing import Any, Dict, Optional
from urllib.request import urlopen
from urllib.error import URLError, HTTPError


class HealthCheckError(Exception):
    """Error al verificar /api/health."""
    pass


class ConfigPersistenceError(Exception):
    """Error al verificar persistencia de /config."""
    pass


class HealthChecker:
    """Verifica el estado de /api/health y la persistencia de /config."""
    
    def __init__(self, api_url: str = "http://127.0.0.1:8081"):
        """
        Inicializa el verificador.
        
        Args:
            api_url: URL base de la API (sin trailing slash)
        """
        self.api_url = api_url.rstrip("/")
        self.health_endpoint = f"{self.api_url}/api/health"
        self.config_endpoint = f"{self.api_url}/api/config"
    
    def check_health_curl(self) -> Dict[str, Any]:
        """
        Ejecuta curl -sS para verificar /api/health.
        
        Returns:
            Dict con 'ok', 'status_code', 'response_body'
        """
        try:
            result = subprocess.run(
                ["curl", "-sS", "-w", "\\n%{http_code}", self.health_endpoint],
                capture_output=True,
                text=True,
                timeout=5,
                check=False
            )
            
            # El último renglón es el código HTTP
            lines = result.stdout.strip().split("\n")
            if len(lines) < 2:
                # No hay cuerpo, solo código
                status_code = int(lines[-1]) if lines else 0
                body = ""
            else:
                status_code = int(lines[-1])
                body = "\n".join(lines[:-1])
            
            ok = status_code == 200 and body.strip()
            
            # Intentar parsear JSON
            try:
                if body:
                    json.loads(body)
            except json.JSONDecodeError:
                pass  # No es JSON válido, pero puede ser OK si status_code es 200
            
            return {
                "ok": ok,
                "status_code": status_code,
                "response_body": body if body else None,
            }
        except FileNotFoundError:
            raise HealthCheckError("curl no está instalado")
        except subprocess.TimeoutExpired:
            raise HealthCheckError("Timeout al ejecutar curl")
        except Exception as e:
            raise HealthCheckError(f"Error al ejecutar curl: {e}")
    
    def check_health_python(self) -> Dict[str, Any]:
        """
        Verifica /api/health usando urllib (Python puro).
        
        Returns:
            Dict con 'ok', 'status_code', 'response_body'
        """
        try:
            with urlopen(self.health_endpoint, timeout=5) as response:
                status_code = response.getcode()
                body_bytes = response.read()
                body = body_bytes.decode("utf-8", "replace")
                
                # Intentar parsear JSON
                payload = None
                try:
                    payload = json.loads(body)
                except json.JSONDecodeError:
                    pass
                
                ok = status_code == 200 and (
                    payload is None or payload.get("status") == "ok"
                )
                
                return {
                    "ok": ok,
                    "status_code": status_code,
                    "response_body": body if body else None,
                }
        except HTTPError as e:
            return {
                "ok": False,
                "status_code": e.code,
                "response_body": None,
            }
        except URLError as e:
            raise HealthCheckError(f"Error de conexión: {e}")
        except Exception as e:
            raise HealthCheckError(f"Error inesperado: {e}")
    
    def check_config_persistence(self) -> Dict[str, Any]:
        """
        Verifica que /api/config persista correctamente.
        
        Returns:
            Dict con 'ok', 'status_code', 'config_valid'
        """
        try:
            with urlopen(self.config_endpoint, timeout=5) as response:
                status_code = response.getcode()
                body_bytes = response.read()
                body = body_bytes.decode("utf-8", "replace")
                
                if status_code != 200:
                    return {
                        "ok": False,
                        "status_code": status_code,
                        "config_valid": False,
                    }
                
                # Intentar parsear JSON de configuración
                try:
                    config = json.loads(body)
                    # Verificar estructura básica
                    has_structure = isinstance(config, dict)
                    
                    return {
                        "ok": True,
                        "status_code": status_code,
                        "config_valid": has_structure,
                    }
                except json.JSONDecodeError:
                    return {
                        "ok": False,
                        "status_code": status_code,
                        "config_valid": False,
                    }
        except HTTPError as e:
            return {
                "ok": False,
                "status_code": e.code,
                "config_valid": False,
            }
        except URLError as e:
            raise ConfigPersistenceError(f"Error de conexión: {e}")
        except Exception as e:
            raise ConfigPersistenceError(f"Error inesperado: {e}")




