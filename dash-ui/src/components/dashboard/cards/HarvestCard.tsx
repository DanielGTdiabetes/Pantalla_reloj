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
    
    // Frutas de hueso (usar cherry.svg)
    "cereza": "cherry",
    "cerezas": "cherry",
    "fresa": "cherry",
    "fresas": "cherry",
    "melocotón": "cherry",
    "melocotones": "cherry",
    "albaricoque": "cherry",
    "albaricoques": "cherry",
    
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
    
    // Melones y sandías (usar pumpkin.svg)
    "melón": "pumpkin",
    "melones": "pumpkin",
    "sandía": "pumpkin",
    "sandías": "pumpkin",
    
    // Calabazas
    "calabaza": "pumpkin",
    "calabazas": "pumpkin",
    
    // Verduras de hoja
    "lechuga": "lettuce",
    "lechugas": "lettuce",
    "col": "lettuce",
    "coles": "lettuce",
    "coliflor": "lettuce",
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
    
    // Legumbres (usar carrot.svg)
    "guisante": "carrot",
    "guisantes": "carrot",
    "judía": "carrot",
    "judías": "carrot",
    "habón": "carrot",
    "habones": "carrot",
    
    // Tomates, pimientos, berenjenas (usar cherry.svg)
    "tomate": "cherry",
    "tomates": "cherry",
    "pimiento": "cherry",
    "pimientos": "cherry",
    "berenjena": "cherry",
    "berenjenas": "cherry",
    "calabacín": "cherry",
    "calabacines": "cherry",
    "pepino": "cherry",
    "pepinos": "cherry",
    
    // Otros (usar carrot.svg como genérico)
    "alcachofa": "carrot",
    "alcachofas": "carrot",
    "maíz": "carrot",
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
                    className="harvest-card__icon"
                    style={{ width: "24px", height: "24px", marginRight: "8px", verticalAlign: "middle" }}
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
