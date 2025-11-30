import requests
import csv
import json
import os
import io

# Configuration
CSV_URL = "https://soydetemporada.es/data/seasons/calendario.csv"
BASE_IMG_URL = "https://soydetemporada.es/img/products/"
DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
ICONS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "dash-ui", "public", "icons", "soydetemporada")
JSON_FILE = os.path.join(DATA_DIR, "harvest_season.json")

# Ensure directories exist
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(ICONS_DIR, exist_ok=True)

def fetch_csv():
    print(f"Fetching CSV from {CSV_URL}...")
    response = requests.get(CSV_URL)
    response.raise_for_status()
    # Handle encoding if necessary, usually utf-8
    return response.content.decode('utf-8')

def download_image(name):
    filename = f"{name}.png"
    filepath = os.path.join(ICONS_DIR, filename)
    
    # Skip if already exists (optional, but good for speed)
    # if os.path.exists(filepath):
    #     return filename

    url = f"{BASE_IMG_URL}{name}.png"
    try:
        print(f"Downloading image for {name}...")
        response = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'})
        if response.status_code == 200:
            with open(filepath, 'wb') as f:
                f.write(response.content)
            return filename
        else:
            print(f"Failed to download image for {name}: Status {response.status_code}")
            return None
    except Exception as e:
        print(f"Error downloading image for {name}: {e}")
        return None

def parse_csv(csv_content):
    harvest_data = []
    reader = csv.reader(io.StringIO(csv_content))
    header = next(reader) # Skip header
    
    # Month columns are indices 1 to 12 (ENE to DIC)
    # 1=Jan, 2=Feb, ...
    
    for row in reader:
        if not row: continue
        
        name = row[0]
        months = []
        
        for i in range(1, 13):
            val = row[i].strip().upper()
            # X: In season
            # Y, I: Start
            # F: End
            if val in ['X', 'Y', 'I', 'F']:
                months.append(i)
        
        if months:
            icon_file = download_image(name)
            if icon_file:
                harvest_data.append({
                    "name": name.capitalize(), # Capitalize for display
                    "months": months,
                    "icon": icon_file
                })
            else:
                print(f"Skipping {name} due to missing icon.")
                
    return harvest_data

def main():
    try:
        csv_content = fetch_csv()
        data = parse_csv(csv_content)
        
        with open(JSON_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            
        print(f"Successfully saved {len(data)} items to {JSON_FILE}")
        
    except Exception as e:
        print(f"Script failed: {e}")

if __name__ == "__main__":
    main()
