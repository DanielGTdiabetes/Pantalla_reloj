import asyncio
import logging
import sys
from services.saints_service import fetch_saint_info_wikipedia, enrich_saints

async def main():
    with open("saints_check_result.txt", "w", encoding="utf-8") as f:
        f.write("Testing saint fetch for San Ambrosio...\n")
        
        names_to_test = ["Ambrosio"]
        
        f.write(f"Fetching info for: {names_to_test}\n")
        results = await enrich_saints(names_to_test)
        
        for res in results:
            f.write("\n" + "="*40 + "\n")
            f.write(f"Name: {res['name']}\n")
            f.write(f"Has Bio: {'Yes' if res['bio'] else 'No'}\n")
            if res['bio']:
                f.write(f"Bio preview: {res['bio'][:100]}...\n")
            f.write(f"Has Image: {'Yes' if res['image'] else 'No'}\n")
            f.write(f"Image URL: {res['image']}\n")
            f.write(f"Wiki URL: {res['url']}\n")
            f.write("="*40 + "\n")

if __name__ == "__main__":
    asyncio.run(main())
