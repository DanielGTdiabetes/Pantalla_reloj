import requests

url = "https://soydetemporada.es/img/products/acelga.svg"
headers = {'User-Agent': 'Mozilla/5.0'}
r = requests.get(url, headers=headers)
print(f"SVG Status: {r.status_code}")
