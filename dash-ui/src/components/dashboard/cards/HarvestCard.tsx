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
    // Frutas cítricas (usar apple.svg como genérico)
    "naranja": "apple",
    "naranjas": "apple",
    "mandarina": "apple",
    "mandarinas": "apple",
    "limón": "apple",
    "limones": "apple",
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
    "castaña": "pear",
    "castañas": "pear",
    
    // Uvas y frutas pequeñas
    "uva": "grapes",
    "uvas": "grapes",
    "higo": "grapes",
    "higos": "grapes",
    
    // Melones y sandías
    "melón": "melon",
    "melones": "melon",
    "sandía": "watermelon",
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
    "acelga": "chard",
    "acelgas": "chard",
    "espinaca": "chard",
    "espinacas": "chard",
    "rúcula": "chard",
    
    // Brócoli y coles
    "brócoli": "broccoli",
    "brocoli": "broccoli",
    "brócolis": "broccoli",
    
    // Raíces y bulbos
    "zanahoria": "carrot",
    "zanahorias": "carrot",
    "ajo": "carrot",
    "ajos": "carrot",
    "rábano": "carrot",
    "rábanos": "carrot",
    
    // Remolachas
    "remolacha": "beet",
    "remolachas": "beet",
    "cebolla": "beet",
    "cebollas": "beet",
    
    // Legumbres
    "guisante": "bean",
    "guisantes": "bean",
    "judía": "bean",
    "judías": "bean",
    "habón": "bean",
    "habones": "bean",
    
    // Solanáceas y cucurbitáceas
    "tomate": "tomato",
    "tomates": "tomato",
    "pimiento": "pepper",
    "pimientos": "pepper",
    "berenjena": "eggplant",
    "berenjenas": "eggplant",
    "calabacín": "zucchini",
    "calabacines": "zucchini",
    "pepino": "cucumber",
    "pepinos": "cucumber",
    
    // Otros
    "alcachofa": "artichoke",
    "alcachofas": "artichoke",
    "maíz": "corn",
  };
  
  // Buscar coincidencia exacta primero
  if (iconMap[nameLower]) {
    return `/icons/harvest/${iconMap[nameLower]}.svg`;
  }
  
  // Buscar coincidencia parcial (si el nombre contiene alguna clave del mapa)
  for (const [key, value] of Object.entries(iconMap)) {
    if (nameLower.includes(key) || key.includes(nameLower)) {
      return `/icons/harvest/${value}.svg`;
    }
  }
  
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
                    style={{ marginRight: "8px", verticalAlign: "middle" }}
                  />
                ) : null}
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
