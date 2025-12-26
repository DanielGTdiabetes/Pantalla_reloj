
import sys
import logging
import requests

logging.basicConfig(level=logging.INFO)

def test_legacy(api_key):
    lat = 39.9378
    lon = -0.1014
    url = f"https://api.openweathermap.org/data/2.5/weather?lat={lat}&lon={lon}&appid={api_key}&units=metric"
    
    print(f"Testing Legacy /weather layer with key: {api_key}")
    try:
        resp = requests.get(url, timeout=10)
        print(f"Status: {resp.status_code}")
        if resp.status_code == 200:
            print("SUCCESS (Legacy API works)")
            print(resp.json())
        else:
            print("FAILED (Legacy API)")
            print(resp.text)
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    key = "6f9635f0a4f0b259fad7d8a8813ad7a9"
    test_legacy(key)
