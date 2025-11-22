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

// Función helper para normalizar texto removiendo acentos
const normalizeText = (text: string): string => {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
};

const getHarvestIcon = (itemName: string): string => {
  // SIEMPRE devolver un string válido (fallback incluido)
  if (!itemName || itemName.trim() === "") {
    console.warn("[HarvestCard] Item name is empty, using fallback icon");
    return "/icons/harvest/pumpkin.svg";  // Icono genérico de fallback
  }
  
  const nameLower = normalizeText(itemName);
  
  // Mapeo expandido de nombres comunes a archivos SVG disponibles
  // Incluye plurales, acentos y variaciones comunes
  const iconMap: Record<string, string> = {
    // Frutas cítricas
    "naranja": "apple",
    "naranjas": "apple",
    "mandarina": "apple",
    "mandarinas": "apple",
    "limon": "apple",
    "limones": "apple",
    "manzana": "apple",
    "manzanas": "apple",
    "citrico": "apple",
    "citricos": "apple",
    
    // Frutas de hueso
    "cereza": "cherry",
    "cerezas": "cherry",
    "guinda": "cherry",
    "guindas": "cherry",
    "picota": "cherry",
    "picotas": "cherry",
    "fresa": "strawberry",
    "fresas": "strawberry",
    "freson": "strawberry",
    "fresones": "strawberry",
    "melocoton": "peach",
    "melocotones": "peach",
    "albaricoque": "peach",
    "albaricoques": "peach",
    "nectarina": "peach",
    "nectarinas": "peach",
    "paraguayo": "peach",
    "paraguayos": "peach",
    "ciruela": "peach",
    "ciruelas": "peach",
    
    // Frutas de pepita
    "pera": "pear",
    "peras": "pear",
    "granada": "pear",
    "granadas": "pear",
    "caqui": "pear",
    "caquis": "pear",
    "persimon": "pear",
    "membrillo": "pear",
    "membrillos": "pear",
    "castana": "pear",  // Si no hay icono específico de castaña
    "castanas": "pear",
    "nispero": "pear",
    "nisperos": "pear",
    
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
    "alcaucil": "artichoke",
    "alcauciles": "artichoke",
    "maiz": "corn",
    "maíz": "corn",
    "panizo": "corn",
    "elote": "corn",
    "choclo": "corn",
    "esparrago": "bean",
    "espárrago": "bean",
    "esparragos": "bean",
    "espárragos": "bean",
    "apio": "chard",
    "apios": "chard",
    "puerro": "carrot",
    "puerros": "carrot",
    "nabo": "carrot",
    "nabos": "carrot",
    "patata": "beet",
    "patatas": "beet",
    "papa": "beet",
    "papas": "beet",
    
    // Más frutas
    "plátano": "apple",
    "platano": "apple",
    "plátanos": "apple",
    "platanos": "apple",
    "banana": "apple",
    "bananas": "apple",
    "kiwi": "apple",
    "kiwis": "apple",
    "piña": "apple",
    "piña": "apple",
    "piñas": "apple",
    "anana": "apple",
    "ananás": "apple",
    "mango": "peach",
    "mangos": "peach",
    "aguacate": "pear",
    "aguacates": "pear",
    "palta": "pear",
    "paltas": "pear",
    
    // Más verduras y hortalizas
    "repollo": "lettuce",
    "repollos": "lettuce",
    "col lombarda": "lettuce",
    "col morada": "lettuce",
    "endibia": "lettuce",
    "endibias": "lettuce",
    "canónigo": "lettuce",
    "canonigo": "lettuce",
    "canónigos": "lettuce",
    "canonigos": "lettuce",
    "rábano": "carrot",
    "rabano": "carrot",
    "rábanos": "carrot",
    "rabanos": "carrot",
    "rábano picante": "carrot",
    "rabano picante": "carrot",
    "nabo": "carrot",
    "nabos": "carrot",
    "colinabo": "carrot",
    "colinabos": "carrot",
    "batata": "beet",
    "batatas": "beet",
    "boniato": "beet",
    "boniatos": "beet",
    "calabacín": "zucchini",
    "calabacin": "zucchini",
    "calabacines": "zucchini",
    "calabaza": "pumpkin",
    "calabazas": "pumpkin",
    "calabaza de verano": "zucchini",
    "calabaza de invierno": "pumpkin",
    "pepino": "cucumber",
    "pepinos": "cucumber",
    "pepinillo": "cucumber",
    "pepinillos": "cucumber",
    "berenjena": "eggplant",
    "berenjenas": "eggplant",
    "pimiento": "pepper",
    "pimientos": "pepper",
    "pimiento rojo": "pepper",
    "pimiento verde": "pepper",
    "pimiento amarillo": "pepper",
    "chile": "pepper",
    "chiles": "pepper",
    "ají": "pepper",
    "ajíes": "pepper",
    "tomate": "tomato",
    "tomates": "tomato",
    "tomate cherry": "tomato",
    "tomates cherry": "tomato",
    "tomate pera": "tomato",
    "tomates pera": "tomato",
    "tomate raf": "tomato",
    "tomates raf": "tomato",
    
    // Legumbres y semillas
    "garbanzo": "bean",
    "garbanzos": "bean",
    "lenteja": "bean",
    "lentejas": "bean",
    "haba": "bean",
    "habas": "bean",
    "soja": "bean",
    "soya": "bean",
    "judía verde": "bean",
    "judia verde": "bean",
    "judías verdes": "bean",
    "judias verdes": "bean",
    "habichuela": "bean",
    "habichuelas": "bean",
    
    // Hierbas y especias
    "albahaca": "chard",
    "perejil": "chard",
    "cilantro": "chard",
    "romero": "chard",
    "tomillo": "chard",
    "orégano": "chard",
    "oregano": "chard",
    "menta": "chard",
    "hierbabuena": "chard",
    
    // Setas y hongos
    "champiñón": "artichoke",
    "champiñon": "artichoke",
    "champiñones": "artichoke",
    "champiñones": "artichoke",
    "seta": "artichoke",
    "setas": "artichoke",
    "hongo": "artichoke",
    "hongos": "artichoke",
  };
  
  // Buscar coincidencia exacta primero
  if (iconMap[nameLower]) {
    const iconPath = `/icons/harvest/${iconMap[nameLower]}.svg`;
    console.debug(`[HarvestCard] Icon found (exact match): "${itemName}" → ${iconPath}`);
    return iconPath;
  }
  
  // Buscar coincidencia parcial (si el nombre contiene alguna clave del mapa)
  // Ordenar por longitud descendente para priorizar coincidencias más largas
  const sortedEntries = Object.entries(iconMap).sort((a, b) => b[0].length - a[0].length);
  for (const [key, value] of sortedEntries) {
    if (nameLower.includes(key)) {
      const iconPath = `/icons/harvest/${value}.svg`;
      console.debug(`[HarvestCard] Icon found (partial match): "${itemName}" contains "${key}" → ${iconPath}`);
      return iconPath;
    }
  }
  
  // FALLBACK GARANTIZADO: Si no se encuentra, usar un icono genérico
  // en vez de devolver null
  console.warn(`[HarvestCard] No se encontró icono específico para: "${itemName}" (normalizado: "${nameLower}"), usando fallback genérico`);
  return "/icons/harvest/pumpkin.svg";  // Icono genérico de fallback (calabaza)
};

export const HarvestCard = ({ items }: HarvestCardProps): JSX.Element => {
  const entries = items.length > 0 ? items : [{ name: "Sin datos de cultivo" }];
  const repeatedEntries = repeatItems(entries);

  return (
    <div className="card harvest-card harvest-card-enhanced">
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
              <li key={`harvest-${index}`} style={{ animationDelay: `${index * 0.1}s` }}>
                <img 
                  src={iconPath} 
                  alt={entry.name}
                  className="harvest-icon"
                  style={{ marginRight: "8px", verticalAlign: "middle", width: "36px", height: "36px", display: "inline-block", flexShrink: 0 }}
                  onError={(e) => {
                    // Si falla la carga, intentar con el fallback si no es ya el fallback
                    const target = e.target as HTMLImageElement;
                    if (target.src.includes("/pumpkin.svg")) {
                      console.error(`[HarvestCard] Fallback icon also failed to load para "${entry.name}", ocultando`);
                      target.style.display = "none";
                    } else {
                      console.warn(`[HarvestCard] Error al cargar icono: ${iconPath} para "${entry.name}", intentando fallback`);
                      target.src = "/icons/harvest/pumpkin.svg";
                    }
                  }}
                />
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
