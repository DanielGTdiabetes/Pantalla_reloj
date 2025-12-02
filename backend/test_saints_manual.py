import asyncio
import logging
from services.saints_service import fetch_saint_info_wikipedia, enrich_saints

logging.basicConfig(level=logging.INFO)

async def main():
    with open("test_saints_output.txt", "w", encoding="utf-8") as f:
        f.write("Testing single saint fetch...\n")
        # Test with a known saint
        name = "San Francisco de Asís"
        info = await fetch_saint_info_wikipedia(name)
        f.write(f"Result for {name}:\n")
        f.write(f"Name: {info['name']}\n")
        f.write(f"Bio: {info['bio']}\n")
        f.write(f"Image: {info['image']}\n")
        f.write("-" * 20 + "\n")

        f.write("Testing enrichment list...\n")
        names = ["Santa Bárbara", "San Nicolás", "Santo Tomás"]
        results = await enrich_saints(names)
        for res in results:
            f.write(f"Name: {res['name']}\n")
            f.write(f"Bio: {res['bio'][:50]}..." if res['bio'] else "No bio\n")
            f.write(f"Image: {res['image']}\n")
            f.write("-" * 20 + "\n")

if __name__ == "__main__":
    asyncio.run(main())
