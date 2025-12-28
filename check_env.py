import sys

print(f"Python: {sys.version}")

try:
    import websockets
    print("websockets: INSTALLED")
except ImportError:
    print("websockets: MISSING")

try:
    import requests
    print("requests: INSTALLED")
except ImportError:
    print("requests: MISSING")

try:
    import uvicorn
    print("uvicorn: INSTALLED")
except ImportError:
    print("uvicorn: MISSING")
