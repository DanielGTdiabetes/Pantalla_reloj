import requests

def check_resources():
    csv_url = "https://soydetemporada.es/data/seasons/calendario.csv"
    svg_url = "https://soydetemporada.es/img/products/acelga.svg" # Guessing path based on user request for SVG
    
    print(f"Checking CSV: {csv_url}")
    try:
        r = requests.head(csv_url)
        print(f"CSV Status: {r.status_code}")
    except Exception as e:
        print(f"CSV Error: {e}")

    paths = [
        "https://soydetemporada.es/img/products/acelga.svg",
        "https://soydetemporada.es/icons/acelga.svg",
        "https://soydetemporada.es/assets/products/acelga.svg",
        "https://soydetemporada.es/static/img/products/acelga.svg",
        "https://soydetemporada.es/images/products/acelga.svg"
    ]
    
    for p in paths:
        print(f"Checking: {p}")
        try:
            r = requests.head(p)
            print(f"Status: {r.status_code}")
            if r.status_code == 200:
                print(f"FOUND: {p}")
                break
        except Exception as e:
            print(f"Error: {e}")

if __name__ == "__main__":
    check_resources()
