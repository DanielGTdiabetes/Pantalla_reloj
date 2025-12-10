from PIL import Image
import os

def clean_image(path):
    try:
        img = Image.open(path).convert("RGBA")
        datas = img.getdata()
        
        newData = []
        changed = False
        
        # We assume background is either very dark or very light
        # Let's check corners to decide strategy per image
        w, h = img.size
        corners = [
            img.getpixel((0,0)), img.getpixel((w-1,0)),
            img.getpixel((0,h-1)), img.getpixel((w-1,h-1))
        ]
        
        # Simple heuristic: is it 'light' or 'dark' background?
        # Average brightness
        avg_corner_brightness = sum(sum(c[:3]) for c in corners) / (4 * 3)
        
        is_light_bg = avg_corner_brightness > 128
        
        print(f"Processing {os.path.basename(path)}: mode={'Light' if is_light_bg else 'Dark'} bg")
        
        for item in datas:
            # item is (r,g,b,a)
            
            # If already transparent, keep it
            if item[3] == 0:
                newData.append(item)
                continue
            
            r, g, b = item[:3]
            
            make_transparent = False
            
            if is_light_bg:
                # Remove white/near-white
                # Threshold: > 230
                if r > 230 and g > 230 and b > 230:
                    make_transparent = True
            else:
                # Remove black/near-black
                # Threshold: < 25
                if r < 25 and g < 25 and b < 25:
                    make_transparent = True
            
            if make_transparent:
                newData.append((255, 255, 255, 0))
                changed = True
            else:
                newData.append(item)
        
        if changed:
            img.putdata(newData)
            img.save(path, "PNG")
            print(f"  Fixed {path}")
        else:
            print(f"  No changes needed")

    except Exception as e:
        print(f"  Error: {e}")

target_dir = r"D:\pantalla_reloj\Pantalla_reloj\dash-ui\public\icons\3d"

if os.path.exists(target_dir):
    files = [f for f in os.listdir(target_dir) if f.endswith('.png')]
    for f in files:
        clean_image(os.path.join(target_dir, f))
