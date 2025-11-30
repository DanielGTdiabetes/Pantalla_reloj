#!/usr/bin/env python3
"""
Script para descargar el catálogo completo de frutas y verduras de soydetemporada.es
Descarga todos los productos con sus iconos PNG para uso durante todo el año.
"""

import requests
import csv
import json
import os
import io
from pathlib import Path

# Configuración
CSV_URL = "https://soydetemporada.es/data/seasons/calendario.csv"
BASE_IMG_URL = "https://soydetemporada.es/img/products/"  # PNG path confirmed
SCRIPT_DIR = Path(__file__).parent
BACKEND_DIR = SCRIPT_DIR.parent
PROJECT_ROOT = BACKEND_DIR.parent
DATA_DIR = BACKEND_DIR / "data"
ICONS_DIR = PROJECT_ROOT / "dash-ui" / "public" / "icons" / "harvest"
JSON_FILE = DATA_DIR / "harvest_catalog.json"

# Crear directorios
DATA_DIR.mkdir(parents=True, exist_ok=True)
ICONS_DIR.mkdir(parents=True, exist_ok=True)

def fetch_csv():
    """Descarga el CSV del calendario de temporada"""
    print(f"📥 Descargando CSV desde {CSV_URL}...")
    response = requests.get(CSV_URL, headers={'User-Agent': 'Mozilla/5.0'})
    response.raise_for_status()
    return response.content.decode('utf-8')

def download_icon(product_name):
    """Descarga el icono PNG de un producto"""
    filename = f"{product_name}.png"
    filepath = ICONS_DIR / filename
    
    # Si ya existe, no descargar de nuevo
    if filepath.exists():
        print(f"  ✓ {product_name}.png ya existe")
        return filename
    
    url = f"{BASE_IMG_URL}{product_name}.png"
    try:
        print(f"  ⬇️  Descargando {product_name}.png...")
        response = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'})
        if response.status_code == 200:
            with open(filepath, 'wb') as f:
                f.write(response.content)
            print(f"  ✅ {product_name}.png descargado")
            return filename
        else:
            print(f"  ❌ Error {response.status_code} al descargar {product_name}.png")
            return None
    except Exception as e:
        print(f"  ❌ Error descargando {product_name}.png: {e}")
        return None

def parse_csv_and_download(csv_content):
    """Parsea el CSV y descarga todos los iconos"""
    harvest_catalog = []
    reader = csv.reader(io.StringIO(csv_content))
    header = next(reader)  # Saltar encabezado
    
    print(f"\n📋 Procesando productos del calendario...\n")
    
    # Las columnas de meses son índices 1-12 (ENE a DIC)
    month_names = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                   'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
    
    total_products = 0
    successful_downloads = 0
    
    for row in reader:
        if not row:
            continue
        
        product_name = row[0].strip()
        if not product_name:
            continue
            
        total_products += 1
        months = []
        
        # Extraer meses de temporada
        for i in range(1, 13):
            if i < len(row):
                val = row[i].strip().upper()
                # X: temporada óptima, Y/I: inicio, F: fin
                if val in ['X', 'Y', 'I', 'F']:
                    months.append(i)
        
        if not months:
            print(f"⚠️  {product_name}: Sin meses de temporada, omitiendo")
            continue
        
        # Descargar icono
        icon_file = download_icon(product_name)
        
        if icon_file:
            successful_downloads += 1
            # Capitalizar nombre para display
            display_name = product_name.replace('_', ' ').title()
            
            harvest_catalog.append({
                "name": display_name,
                "slug": product_name,
                "months": months,
                "icon": icon_file,
                "season_summary": f"{month_names[months[0]-1]} - {month_names[months[-1]-1]}"
            })
        else:
            print(f"⚠️  {product_name}: Omitido por falta de icono")
    
    return harvest_catalog, total_products, successful_downloads

def save_catalog(catalog):
    """Guarda el catálogo en JSON"""
    with open(JSON_FILE, 'w', encoding='utf-8') as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)
    print(f"\n💾 Catálogo guardado en: {JSON_FILE}")

def main():
    print("=" * 70)
    print("🌱 DESCARGA DE CATÁLOGO COMPLETO - SOY DE TEMPORADA")
    print("=" * 70)
    
    try:
        # Descargar CSV
        csv_content = fetch_csv()
        
        # Parsear y descargar iconos
        catalog, total, successful = parse_csv_and_download(csv_content)
        
        # Guardar catálogo
        save_catalog(catalog)
        
        # Resumen
        print("\n" + "=" * 70)
        print("📊 RESUMEN DE LA DESCARGA")
        print("=" * 70)
        print(f"✅ Productos totales en CSV: {total}")
        print(f"✅ Productos con iconos descargados: {successful}")
        print(f"✅ Productos en catálogo final: {len(catalog)}")
        print(f"📁 Iconos guardados en: {ICONS_DIR}")
        print(f"📄 Catálogo JSON: {JSON_FILE}")
        
        if successful < total:
            print(f"\n⚠️  {total - successful} productos omitidos por falta de iconos")
        
        print("\n✨ ¡Descarga completada con éxito!")
        print("=" * 70)
        
    except Exception as e:
        print(f"\n❌ Error durante la ejecución: {e}")
        import traceback
        traceback.print_exc()
        return 1
    
    return 0

if __name__ == "__main__":
    exit(main())
