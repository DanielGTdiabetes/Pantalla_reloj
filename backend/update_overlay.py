
import os

file_path = r"d:\pantalla_reloj\Pantalla_reloj\dash-ui\src\components\OverlayRotator.tsx"

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

old_block = """  const santoralEntries = useMemo(() => {
    const fromSaints = extractStrings(santoral.saints);
    const fromNamedays = extractStrings(santoral.namedays);
    const combined = [...fromSaints, ...fromNamedays];
    const unique = combined.filter((entry, index, self) => {
      const normalized = entry.toLowerCase().trim();
      return self.findIndex((e) => e.toLowerCase().trim() === normalized) === index;
    });
    return unique;
  }, [santoral.saints, santoral.namedays]);"""

new_block = """  const santoralEntries = useMemo(() => {
    const saints = Array.isArray(santoral.saints) ? santoral.saints : [];
    const namedays = extractStrings(santoral.namedays);
    return [...saints, ...namedays] as (string | Record<string, unknown>)[];
  }, [santoral.saints, santoral.namedays]);"""

if old_block in content:
    new_content = content.replace(old_block, new_block)
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(new_content)
    print("Successfully replaced content.")
else:
    print("Could not find old block.")
    # Debug: print surrounding lines
    start_marker = "const santoralEntries = useMemo(() => {"
    idx = content.find(start_marker)
    if idx != -1:
        print("Found start marker. Context:")
        print(content[idx:idx+500])
    else:
        print("Could not find start marker.")
