
import sys
import os
from pathlib import Path

# Add backend to path
sys.path.append(str(Path(__file__).parent.parent))

from backend.secret_store import SecretStore

def main():
    if len(sys.argv) < 2:
        print("Usage: python set_aisstream_key.py <api_key>")
        sys.exit(1)
        
    key = sys.argv[1]
    store = SecretStore()
    store.set_secret("aisstream_api_key", key)
    print(f"Stored aisstream_api_key: {key[:4]}...")

if __name__ == "__main__":
    main()
