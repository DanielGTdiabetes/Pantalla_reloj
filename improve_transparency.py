import os
import math
from PIL import Image

def get_color_distance(c1, c2):
    return math.sqrt(
        (c1[0] - c2[0])**2 +
        (c1[1] - c2[1])**2 +
        (c1[2] - c2[2])**2
    )

def remove_background(path, threshold=50):
    print(f"Processing {path}...")
    try:
        img = Image.open(path).convert("RGBA")
        datas = img.getdata()
        
        # Sample background from corners
        w, h = img.size
        corners = [
            img.getpixel((0, 0)),
            img.getpixel((w-1, 0)),
            img.getpixel((0, h-1)),
            img.getpixel((w-1, h-1))
        ]
        
        # Average corner color (assuming they are similar)
        # Or take the most common one if they diff
        bg_r = sum(c[0] for c in corners) // 4
        bg_g = sum(c[1] for c in corners) // 4
        bg_b = sum(c[2] for c in corners) // 4
        bg_color = (bg_r, bg_g, bg_b)
        
        print(f"  Estimated bg color: {bg_color}")
        
        newData = []
        changed = False
        
        for item in datas:
            # item is (r,g,b,a)
            # Check if transparent already
            if item[3] < 10:
                newData.append(item)
                continue
                
            dist = get_color_distance(item[:3], bg_color)
            
            if dist < threshold:
                # Fully transparent
                newData.append((255, 255, 255, 0))
                changed = True
            elif dist < threshold + 20:
                # Semi-transparent (antialiasing edge)
                alpha = int(255 * ((dist - threshold) / 20))
                newData.append((item[0], item[1], item[2], alpha))
                changed = True
            else:
                newData.append(item)
        
        if changed:
            img.putdata(newData)
            img.save(path, "PNG")
            print(f"  Saved {path}")
        else:
            print(f"  No changes needed for {path}")
            
    except Exception as e:
        print(f"  Failed to process {path}: {e}")

target_dir = r"D:\pantalla_reloj\Pantalla_reloj\dash-ui\public\icons\3d"

if not os.path.exists(target_dir):
    print(f"Directory not found: {target_dir}")
else:
    files = [f for f in os.listdir(target_dir) if f.endswith('.png')]
    print(f"Found {len(files)} PNGs in {target_dir}")

    for f in files:
        remove_background(os.path.join(target_dir, f), threshold=60)
