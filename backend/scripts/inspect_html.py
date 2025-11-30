import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin

url = "https://soydetemporada.es/"
headers = {'User-Agent': 'Mozilla/5.0'}
response = requests.get(url, headers=headers)
soup = BeautifulSoup(response.content, 'html.parser')

img = soup.find('img', src=lambda s: s and 'acelga' in s)
if img:
    src = img['src']
    full_url = urljoin(url, src)
    print(f"Found image src: {src}")
    print(f"Full URL: {full_url}")
    
    # Try to fetch it
    r = requests.get(full_url, headers=headers)
    print(f"Status code: {r.status_code}")
else:
    print("Image not found in HTML")
