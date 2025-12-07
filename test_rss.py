
import asyncio
import re
import html
import httpx
from urllib.parse import urlparse

async def parse_rss_feed(feed_url: str):
    print(f"Fetching {feed_url}...")
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            response = await client.get(feed_url, headers={
                "User-Agent": "Mozilla/5.0 (compatible; PantallaReloj/1.0)"
            })
            print(f"Status: {response.status_code}")
            content = response.text
            # content = content.replace("\n", " ") # mimic what happens sometimes? no.
            
        items = []
        item_pattern = re.compile(r'<(?:item|entry)[^>]*>(.*?)</(?:item|entry)>', re.DOTALL | re.IGNORECASE)
        matches = item_pattern.findall(content)
        print(f"Found {len(matches)} items")
        
        for i, match in enumerate(matches[:3]):
            print(f"--- Item {i} ---")
            # print(match[:200]) 
            
            title_match = re.search(r'<(?:title|dc:title)[^>]*>(.*?)</(?:title|dc:title)>', match, re.DOTALL | re.IGNORECASE)
            if title_match:
                title = html.unescape(re.sub(r'<[^>]+>', '', title_match.group(1)).strip())
                print(f"Title found: {title}")
            else:
                print("No title found")
                
            desc_match = re.search(r'<(?:description|summary|content|dc:description)[^>]*>(.*?)</(?:description|summary|content|dc:description)>', match, re.DOTALL | re.IGNORECASE)
            if desc_match:
                print("Description found")
            else:
                print("Description NOT found")

    except Exception as exc:
        print(f"Error: {exc}")

asyncio.run(parse_rss_feed("https://api2.rtve.es/rss/temas_noticias.xml"))
