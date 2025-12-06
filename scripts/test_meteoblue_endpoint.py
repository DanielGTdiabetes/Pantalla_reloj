import requests
import json

def test_meteoblue_endpoint():
    url = "http://localhost:8081/api/weather/test_meteoblue"
    payload = {"api_key": "test_key_123"}
    
    print(f"Sending POST to {url} with payload: {payload}")
    try:
        response = requests.post(url, json=payload)
        print(f"Status Code: {response.status_code}")
        print(f"Response Body: {response.json()}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_meteoblue_endpoint()
