import requests
import json
import sys

BASE_URL = "http://localhost:8081"

def set_secret(api_key):
    url = f"{BASE_URL}/api/config/secret/meteoblue_api_key"
    payload = {"api_key": api_key}
    print(f"Setting secret at {url} with payload: {payload}")
    try:
        response = requests.post(url, json=payload)
        print(f"Status Code: {response.status_code}")
        try:
            data = response.json()
            print(f"Response Body: {data}")
            if data.get("ok"):
                print("SET_SECRET_RESULT: SUCCESS")
            else:
                print(f"SET_SECRET_RESULT: FAILURE - {data.get('error')}")
        except:
            print(f"Response Text: {response.text}")
    except Exception as e:
        print(f"Error: {e}")

def test_endpoint(api_key=None):
    url = f"{BASE_URL}/api/weather/test_meteoblue"
    payload = {"api_key": api_key}
    print(f"\nTesting endpoint {url} with payload: {payload}")
    try:
        response = requests.post(url, json=payload)
        print(f"Status Code: {response.status_code}")
        try:
            data = response.json()
            print(f"Response Body: {data}")
            if data.get("ok"):
                print("TEST_ENDPOINT_RESULT: SUCCESS")
            else:
                print(f"TEST_ENDPOINT_RESULT: FAILURE - {data}")
        except:
            print(f"Response Text: {response.text}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    # 1. Set a dummy secret
    print("--- Setting Dummy Secret ---")
    set_secret("stored_dummy_key_123")

    # 2. Test with explicit key (should use this one)
    print("\n--- Test 1: Explicit Key ---")
    test_endpoint("explicit_key_456")

    # 3. Test with NO key (should use stored one)
    print("\n--- Test 2: Stored Key (api_key=None) ---")
    test_endpoint(None)
