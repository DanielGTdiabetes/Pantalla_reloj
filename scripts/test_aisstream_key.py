
import asyncio
import json
import websockets
import sys

async def test_aisstream(api_key):
    uri = "wss://stream.aisstream.io/v0/stream"
    
    subscription = {
        "APIKey": api_key,
        "BoundingBoxes": [[[-10.0, 35.0], [4.5, 44.0]]], # Spain approx
        "FiltersShipMMSI": None,
        "FilterMessageTypes": ["PositionReport"]
    }

    print(f"Connecting to {uri} with key {api_key[:4]}...")
    
    try:
        async with websockets.connect(uri) as websocket:
            await websocket.send(json.dumps(subscription))
            print("Subscription sent. Waiting for response...")
            
            try:
                message = await asyncio.wait_for(websocket.recv(), timeout=10.0)
                data = json.loads(message)
                print("Received message!")
                # print(json.dumps(data, indent=2))
                if "MessageType" in data:
                    print("SUCCESS: Valid API Key and data received.")
                    return True
                else:
                    print("Received unknown message format.")
                    return True
            except asyncio.TimeoutError:
                print("Timeout waiting for message. (This might just mean no ships in bbox, but connection was likely accepted)")
                return True
            except websockets.exceptions.ConnectionClosedError as e:
                print(f"Connection closed error: {e}")
                if "401" in str(e) or "403" in str(e):
                     print("FAILURE: Invalid API Key.")
                return False
                
    except Exception as e:
        print(f"Connection failed: {e}")
        return False

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python test_aisstream_key.py <api_key>")
        sys.exit(1)
    
    key = sys.argv[1]
    asyncio.run(test_aisstream(key))
