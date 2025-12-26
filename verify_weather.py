
import sys
import logging
import json
from backend.services.weather_service import WeatherService

# Setup minimal logging to stdout
logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s:%(name)s:%(message)s'
)
logger = logging.getLogger(__name__)

def test_weather_key(api_key):
    print(f"Testing Meteoblue with key: {api_key}")
    
    service = WeatherService(api_key=api_key)
    lat = 39.9378
    lon = -0.1014
    
    # Direct fetch to see raw response or error
    try:
        print("Fetching raw data...")
        raw = service.fetch_weather(lat, lon, api_key)
        print("Raw fetch successful.")
        # print(json.dumps(raw, indent=2))
    except Exception as e:
        print(f"FAILED raw fetch: {e}")
        return

    # Full parsing
    try:
        result = service.get_weather(lat, lon)
        if result.get("ok"):
            print("SUCCESS parsing!")
            print(f"Condition: {result.get('condition')}")
            print(f"Temp: {result.get('temperature')}")
        else:
            print("FAILED parsing")
            print(json.dumps(result, indent=2))
            
    except Exception as e:
        print(f"EXCEPTION in get_weather: {e}")

if __name__ == "__main__":
    key = "txqJbp7HDkAGVWC0"
    if len(sys.argv) > 1:
        key = sys.argv[1]
        
    test_weather_key(key)
