import { useState, useEffect } from "react";
import { SproutIcon } from "../../icons";

type HarvestItem = {
  name: string;
  status?: string | null;
};

type HarvestCardProps = {
  items: HarvestItem[];
};

// Mapeo de nombres de cultivos a códigos Unicode de Twemoji (Hex)
const CROP_EMOJIS: Record<string, string> = {
  // Frutas
  "tomate": "1f345", // 🍅
  "tomato": "1f345",
  "manzana": "1f34e", // 🍎
  "apple": "1f34e",
  "pera": "1f350", // 🍐
  "pear": "1f350",
  "naranja": "1f34a", // 🍊
  "orange": "1f34a",
  "mandarina": "1f34a",
  "limon": "1f34b", // 🍋
  "lemon": "1f34b",
  "platano": "1f34c", // 🍌
  "banana": "1f34c",
  "sandia": "1f349", // 🍉
  "watermelon": "1f349",
  "uva": "1f347", // 🍇
  "grape": "1f347",
  "fresa": "1f353", // 🍓
  "strawberry": "1f353",
  "cereza": "1f352", // 🍒
  "cherry": "1f352",
  "melocoton": "1f351", // 🍑
  "peach": "1f351",
  "piña": "1f34d", // 🍍
  "pineapple": "1f34d",
  "mango": "1f96d", // 🥭
  "kiwi": "1f95d", // 🥝
  "aguacate": "1f951", // 🥑
  "avocado": "1f951",
  "coco": "1f965", // 🥥
  "coconut": "1f965",
  "melon": "1f348", // 🍈
  "arandano": "1f9e6", // 🫐
  "blueberry": "1f9e6",

  // Verduras y Hortalizas
  "berenjena": "1f346", // 🍆
  "eggplant": "1f346",
  "patata": "1f954", // 🥔
  "potato": "1f954",
  "zanahoria": "1f955", // 🥕
  "carrot": "1f955",
  "maiz": "1f33d", // 🌽
  "corn": "1f33d",
  "pimiento": "1f971", // 🫑 (Bell pepper)
  "pepper": "1f971",
  "chile": "1f336", // 🌶️
  "pepino": "1f952", // 🥒
  "cucumber": "1f952",
  "lechuga": "1f96c", // 🥬
  "lettuce": "1f96c",
  "repollo": "1f96c",
  "col": "1f96c",
  "brocoli": "1f966", // 🥦
  "broccoli": "1f966",
  "ajo": "1f9c4", // 🧄
  "garlic": "1f9c4",
  "cebolla": "1f9c5", // 🧅
  "onion": "1f9c5",
  "seta": "1f344", // 🍄
  "mushroom": "1f344",
  "calabaza": "1f383", // 🎃
  "pumpkin": "1f383",
  "cacahuete": "1f95c", // 🥜
  "peanut": "1f95c",
  "castana": "1f330", // 🌰
  "chestnut": "1f330",
  "batata": "1f360", // 🍠
  "sweet potato": "1f360",
  "aceituna": "1f9ab", // 🫒
  "olive": "1f9ab",
  "judia": "1f9ed", // ed (Pea pod - closest to beans/green beans)
  "bean": "1f9ed",
  "guisante": "1f9ed",
  "pea": "1f9ed",
  "verdura": "1f96c", // 🥬

  // Fallback
  "default": "1f331" // 🌱
};

// Función helper para normalizar texto removiendo acentos
const normalizeText = (text: string): string => {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
};

const getTwemojiUrl = (itemName: string): string => {
  const nameLower = normalizeText(itemName);
  let code = CROP_EMOJIS["default"];

  // 1. Búsqueda exacta
  if (CROP_EMOJIS[nameLower]) {
    code = CROP_EMOJIS[nameLower];
  } else {
    // 2. Búsqueda parcial (ej. "tomate cherry" -> "tomate")
    // Ordenamos por longitud para priorizar coincidencias más largas (ej. "pimiento rojo" antes que "pimiento")
    const keys = Object.keys(CROP_EMOJIS).sort((a, b) => b.length - a.length);
    for (const key of keys) {
      if (key !== "default" && nameLower.includes(key)) {
        code = CROP_EMOJIS[key];
        break;
      }
    }
  }

  return `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/${code}.svg`;
};

export const HarvestCard = ({ items }: HarvestCardProps): JSX.Element => {
  const entries = items.length > 0 ? items : [{ name: "Sin datos de cultivo" }];
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (entries.length <= 1) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % entries.length);
    }, 5000); // 5 seconds per item

    return () => clearInterval(interval);
  }, [entries.length]);

  const currentItem = entries[currentIndex];
  const iconUrl = getTwemojiUrl(currentItem.name);

  return (
    <div className="card harvest-card harvest-card-enhanced">
      <div className="harvest-card__header">
        <SproutIcon className="card-icon" aria-hidden="true" />
        <h2>Cosechas</h2>
      </div>
      <div className="harvest-carousel">
        <div className="harvest-slide fade-in" key={currentIndex}>
          <img
            src={iconUrl}
            alt={currentItem.name}
            className="harvest-icon-large"
            style={{ width: "80px", height: "80px", objectFit: "contain" }}
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              // Fallback to sprout if specific image fails
              target.src = `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/${CROP_EMOJIS["default"]}.svg`;
            }}
          />
          <div className="harvest-info">
            <span className="harvest-name">{currentItem.name}</span>
            {currentItem.status && <span className="harvest-status">{currentItem.status}</span>}
          </div>
        </div>
      </div>
    </div>
  );
};

export default HarvestCard;
