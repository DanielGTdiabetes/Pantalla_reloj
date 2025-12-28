
import sys
import os

# Add the parent directory to sys.path so we can import backend
sys.path.append(os.getcwd())

try:
    from backend.routers import weather
    print("Import backend.routers.weather SUCCESS")
except Exception as e:
    print(f"Import backend.routers.weather FAILED: {e}")

try:
    from backend import main
    print("Import backend.main SUCCESS")
except Exception as e:
    print(f"Import backend.main FAILED: {e}")
