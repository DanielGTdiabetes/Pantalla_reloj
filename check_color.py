from PIL import Image
try:
    img = Image.open(r"D:\pantalla_reloj\Pantalla_reloj\dash-ui\public\icons\3d\tomate.png")
    print(f"Format: {img.format}, Mode: {img.mode}")
    print(f"Corner 0,0: {img.getpixel((0,0))}")
except Exception as e:
    print(e)
