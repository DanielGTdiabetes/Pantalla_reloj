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
  const iconMap: Record<string, string> = {
    // Frutas
    "naranja": "apple",
    "naranjas": "apple",
    "mandarina": "apple",
    "mandarinas": "apple",
    "limón": "apple",
    "limones": "apple",
    "manzana": "apple",
    "manzanas": "apple",
    "pera": "pear",
    "peras": "pear",
    "cereza": "cherry",
    "cerezas": "cherry",
    "uva": "grapes",
    "uvas": "grapes",
    "calabaza": "pumpkin",
    "calabazas": "pumpkin",
    
    // Verduras
    "zanahoria": "carrot",
    "zanahorias": "carrot",
    "remolacha": "beet",
    "remolachas": "beet",
    "brócoli": "broccoli",
    "brocoli": "broccoli",
    "brócolis": "broccoli",
    "lechuga": "lettuce",
    "lechugas": "lettuce",
    "acelga": "chard",
    "acelgas": "chard",
    "col": "lettuce",
    "coles": "lettuce",
    "ajo": "carrot",
    "ajos": "carrot",
    "cebolla": "beet",
    "cebollas": "beet",
    "guisante": "carrot",
    "guisantes": "carrot",
  };
  
  // Buscar coincidencia exacta primero
  if (iconMap[nameLower]) {
    return `/icons/harvest/${iconMap[nameLower]}.svg`;
  }
  
  // Buscar coincidencia parcial (si el nombre contiene alguna clave del mapa)
  for (const [key, value] of Object.entries(iconMap)) {
    if (nameLower.includes(key)) {
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
