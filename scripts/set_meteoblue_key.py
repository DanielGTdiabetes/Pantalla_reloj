
import sys
import os
from pathlib import Path

# Add backend to path
sys.path.append(str(Path(__file__).parent.parent))

from backend.secret_store import SecretStore

def main():
    if len(sys.argv) < 2:
        print("Usage: python set_meteoblue_key.py <api_key>")
        return

    api_key = sys.argv[1]
    store = SecretStore()
    store.set_secret("meteoblue_api_key", api_key)
    print(f"Set meteoblue_api_key to: {api_key}")
    
    # Verify
    read_back = store.get_secret("meteoblue_api_key")
    print(f"Read back: {read_back}")

if __name__ == "__main__":
    main()
