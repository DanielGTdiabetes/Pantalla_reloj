
import sys
import logging
import json
import requests

# Setup minimal logging to stdout
logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s:%(name)s:%(message)s'
)
logger = logging.getLogger(__name__)

def test_openweathermap(api_key):
    print(f"Testing OpenWeatherMap with key: {api_key}")
    
    lat = 39.9378
    lon = -0.1014
    
    # Try One Call 3.0 first
    url = f"https://api.openweathermap.org/data/3.0/onecall?lat={lat}&lon={lon}&exclude=minutely,hourly&units=metric&appid={api_key}"
    
    try:
        print(f"Trying OWM OneCall 3.0...")
        resp = requests.get(url, timeout=10)
        
        if resp.status_code == 401:
            print("401 Unauthorized on 3.0, trying 2.5...")
            url = f"https://api.openweathermap.org/data/2.5/onecall?lat={lat}&lon={lon}&exclude=minutely,hourly&units=metric&appid={api_key}"
            resp = requests.get(url, timeout=10)
        
        print(f"Status Code: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json()
            # print(json.dumps(data, indent=2))
            current = data.get("current", {})
            print("SUCCESS!")
            print(f"Temp: {current.get('temp')}ºC")
            print(f"Condition: {current.get('weather', [{}])[0].get('description')}")
        else:
            print("FAILED")
            print(resp.text)
            
    except Exception as e:
        print(f"EXCEPTION: {e}")

if __name__ == "__main__":
    key = "6f9635f0a4f0b259fad7d8a8813ad7a9"
    if len(sys.argv) > 1:
        key = sys.argv[1]
        
    test_openweathermap(key)
