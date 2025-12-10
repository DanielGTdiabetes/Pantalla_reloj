from PIL import Image
import os

target_dir = r"D:\pantalla_reloj\Pantalla_reloj\dash-ui\public\icons\3d"
files = [f for f in os.listdir(target_dir) if f.endswith('.png')]

print(f"Checking {len(files)} images for corner transparency...")

not_transparent = []

for f in files:
    path = os.path.join(target_dir, f)
    try:
        img = Image.open(path).convert("RGBA")
        # Check 4 corners
        w, h = img.size
        corners = [
            img.getpixel((0,0)), 
            img.getpixel((w-1,0)), 
            img.getpixel((0,h-1)), 
            img.getpixel((w-1,h-1))
        ]
        
        is_transparent = all(c[3] == 0 for c in corners)
        
        if not is_transparent:
            print(f"  {f} is NOT transparent at corners! {corners}")
            not_transparent.append(path)
            
    except Exception as e:
        print(f"Error checking {f}: {e}")

if not_transparent:
    print(f"Found {len(not_transparent)} images with non-transparent corners.")
    # Aggressively fix them?
    for path in not_transparent:
        print(f"  Fixing {path}...")
        img = Image.open(path).convert("RGBA")
        datas = img.getdata()
        newData = []
        # Get corner color to remove
        bg_ref = img.getpixel((0,0))
        limit = 40 # deviation
        
        for item in datas:
            # simple distance
            dist = max(abs(item[0]-bg_ref[0]), abs(item[1]-bg_ref[1]), abs(item[2]-bg_ref[2]))
            if dist < limit:
                newData.append((0,0,0,0))
            else:
                newData.append(item)
        img.putdata(newData)
        img.save(path)
        print("    Saved.")
else:
    print("All images have transparent corners.")
