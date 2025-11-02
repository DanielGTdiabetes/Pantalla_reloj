import { SproutIcon } from "../../icons";

type HarvestItem = {
  name: string;
  status?: string | null;
};

type HarvestCardProps = {
  items: HarvestItem[];
};

const repeatItems = <T,>(items: T[]): T[] => {
  if (items.length === 0) {
    return items;
  }
  return [...items, ...items];
};

const getHarvestIcon = (itemName: string): string | null => {
  if (!itemName || itemName.trim() === "") {
    return null;
  }
  
  const nameLower = itemName.toLowerCase().trim();
  
  // Mapeo de nombres comunes a archivos SVG disponibles
  // Cubre todos los cultivos del año según HARVEST_SEASON_DATA
  const iconMap: Record<string, string> = {
    // Frutas cítricas
    "naranja": "apple",
    "naranjas": "apple",
    "mandarina": "apple",
    "mandarinas": "apple",
    "limón": "apple",
    "limones": "apple",
    "limon": "apple",
    "manzana": "apple",
    "manzanas": "apple",
    
    // Frutas de hueso
    "cereza": "cherry",
    "cerezas": "cherry",
    "fresa": "strawberry",
    "fresas": "strawberry",
    "melocotón": "peach",
    "melocotones": "peach",
    "albaricoque": "peach",
    "albaricoques": "peach",
    
    // Frutas de pepita
    "pera": "pear",
    "peras": "pear",
    "granada": "pear",
    "granadas": "pear",
    "caqui": "pear",
    "caquis": "pear",
    "castaña": "chestnut",
    "castañas": "chestnut",
    
    // Uvas y frutas pequeñas
    "uva": "grapes",
    "uvas": "grapes",
    "higo": "grapes",
    "higos": "grapes",
    
    // Melones y sandías
    "melón": "melon",
    "melon": "melon",
    "melones": "melon",
    "sandía": "watermelon",
    "sandia": "watermelon",
    "sandías": "watermelon",
    
    // Calabazas
    "calabaza": "pumpkin",
    "calabazas": "pumpkin",
    
    // Verduras de hoja
    "lechuga": "lettuce",
    "lechugas": "lettuce",
    "col": "lettuce",
    "coles": "lettuce",
    "coliflor": "cauliflower",
    "coliflores": "cauliflower",
    "acelga": "chard",
    "acelgas": "chard",
    "espinaca": "chard",
    "espinacas": "chard",
    "rúcula": "chard",
    "rucula": "chard",
    
    // Brócoli y coles
    "brócoli": "broccoli",
    "brocoli": "broccoli",
    "brócolis": "broccoli",
    "brocolis": "broccoli",
    
    // Raíces y bulbos
    "zanahoria": "carrot",
    "zanahorias": "carrot",
    "ajo": "carrot",
    "ajos": "carrot",
    "rábano": "carrot",
    "rabano": "carrot",
    "rábanos": "carrot",
    "rabanos": "carrot",
    
    // Remolachas
    "remolacha": "beet",
    "remolachas": "beet",
    "cebolla": "beet",
    "cebollas": "beet",
    
    // Legumbres
    "guisante": "bean",
    "guisantes": "bean",
    "judía": "bean",
    "judia": "bean",
    "judías": "bean",
    "judias": "bean",
    "habón": "bean",
    "habon": "bean",
    "habones": "bean",
    
    // Solanáceas y cucurbitáceas
    "tomate": "tomato",
    "tomates": "tomato",
    "pimiento": "pepper",
    "pimientos": "pepper",
    "berenjena": "eggplant",
    "berenjenas": "eggplant",
    "calabacín": "zucchini",
    "calabacin": "zucchini",
    "calabacines": "zucchini",
    "pepino": "cucumber",
    "pepinos": "cucumber",
    
    // Otros
    "alcachofa": "artichoke",
    "alcachofas": "artichoke",
    "maíz": "corn",
    "maiz": "corn",
  };
  
  // Buscar coincidencia exacta primero
  if (iconMap[nameLower]) {
    return `/icons/harvest/${iconMap[nameLower]}.svg`;
  }
  
  // Buscar coincidencia parcial (si el nombre contiene alguna clave del mapa)
  // Ordenar por longitud descendente para priorizar coincidencias más largas
  const sortedEntries = Object.entries(iconMap).sort((a, b) => b[0].length - a[0].length);
  for (const [key, value] of sortedEntries) {
    if (nameLower.includes(key) || key.includes(nameLower)) {
      return `/icons/harvest/${value}.svg`;
    }
  }
  
  // Log para debug si no se encuentra coincidencia
  console.warn(`[HarvestCard] No se encontró icono para: "${itemName}" (normalizado: "${nameLower}")`);
  return null;
};

export const HarvestCard = ({ items }: HarvestCardProps): JSX.Element => {
  const entries = items.length > 0 ? items : [{ name: "Sin datos de cultivo" }];
  const repeatedEntries = repeatItems(entries);

  return (
    <div className="card harvest-card">
      <div className="harvest-card__header">
        <SproutIcon className="card-icon" aria-hidden="true" />
        <h2>Cosechas</h2>
      </div>
      <div className="harvest-card__scroller">
        <ul className="harvest-card__list">
          {repeatedEntries.map((entry, index) => {
            const iconPath = getHarvestIcon(entry.name);
            return (
              // Usar índice completo para garantizar keys únicas (incluso después de duplicar)
              <li key={`harvest-${index}`}>
                {iconPath ? (
                  <img 
                    src={iconPath} 
                    alt={entry.name}
                    className="h-8 w-8"
                    style={{ marginRight: "8px", verticalAlign: "middle", width: "32px", height: "32px", display: "inline-block" }}
                    onError={(e) => {
                      console.warn(`[HarvestCard] Error al cargar icono: ${iconPath} para "${entry.name}"`);
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                    onLoad={() => {
                      console.debug(`[HarvestCard] Icono cargado correctamente: ${iconPath} para "${entry.name}"`);
                    }}
                  />
                ) : (
                  <span style={{ marginRight: "8px", display: "inline-block", width: "32px", height: "32px" }} />
                )}
                <span className="harvest-card__item">{entry.name}</span>
                {entry.status ? <span className="harvest-card__status">{entry.status}</span> : null}
              </li>
            );
          })}
        </ul>
        <div className="harvest-card__gradient" aria-hidden="true" />
      </div>
    </div>
  );
};

export default HarvestCard;
