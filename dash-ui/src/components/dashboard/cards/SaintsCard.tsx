import { useState, useEffect } from "react";

// Restore EnrichedSaint for compatibility
export type EnrichedSaint = {
  name: string;
  bio?: string | null;
  image?: string | null;
  url?: string | null;
};

interface SaintsCardProps {
  saints: (string | EnrichedSaint)[];
}

interface SaintInfo {
  extract?: string;
  thumbnail?: { source: string };
  originalimage?: { source: string };
}

export default function SaintsCard({ saints }: SaintsCardProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [saintInfo, setSaintInfo] = useState<SaintInfo | null>(null);
  const [loading, setLoading] = useState(false);

  // Helper to get name
  const getSaintName = (s: string | EnrichedSaint) => {
    if (typeof s === 'string') return s;
    return s.name;
  };

  // 1. Lógica de rotación (Carrusel) - 15 segundos por santo
  useEffect(() => {
    if (!saints || saints.length === 0) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % saints.length);
    }, 15000);
    return () => clearInterval(interval);
  }, [saints]);

  // 2. Lógica de Prefijos Inteligente
  const formatName = (name: string) => {
    if (name.includes("San") || name.includes("Beato") || name.includes("Santa")) return name;
    // Regla heurística: termina en 'a' es Santa (salvo excepciones)
    if (name.endsWith("a") && !["Luka", "Josua", "Bautisma"].includes(name)) return `Santa ${name}`;
    return `San ${name}`;
  };

  const currentEntry = saints && saints.length > 0 ? saints[currentIndex] : "Cargando...";
  const currentName = getSaintName(currentEntry);
  const fullName = formatName(currentName);

  // 3. Integración Wikipedia (Cliente)
  useEffect(() => {
    if (!currentName || currentName === "Cargando...") return;

    setLoading(true);
    const fetchWiki = async () => {
      try {
        // Intentar buscar con el prefijo "San/Santa"
        const searchName = fullName.replace(/ /g, "_");
        const res = await fetch(`https://es.wikipedia.org/api/rest_v1/page/summary/${searchName}`);

        if (res.ok) {
          const data = await res.json();
          // Solo aceptamos si es una persona (type standard) para evitar desambiguaciones raras
          if (data.type === 'standard') {
            setSaintInfo(data);
            return;
          }
        }

        // Reintento: Buscar solo por el nombre sin "San" (a veces Wikipedia lo tiene directo)
        const res2 = await fetch(`https://es.wikipedia.org/api/rest_v1/page/summary/${currentName}`);
        if (res2.ok) {
          const data2 = await res2.json();
          setSaintInfo(data2);
        } else {
          setSaintInfo(null);
        }
      } catch (e) {
        console.warn("Wiki fetch error", e);
        setSaintInfo(null);
      } finally {
        setLoading(false);
      }
    };

    fetchWiki();
  }, [currentName, fullName]);

  if (!saints || saints.length === 0) {
    return <div className="flex h-full items-center justify-center p-4 text-white/50">Hoy no hay santos destacados</div>;
  }

  const imageUrl = saintInfo?.originalimage?.source || saintInfo?.thumbnail?.source;

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-xl bg-black/20">
      {/* Imagen de Fondo con Blur */}
      {imageUrl && (
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-40 blur-sm transition-opacity duration-1000"
          style={{ backgroundImage: `url(${imageUrl})` }}
        />
      )}

      {/* Capa de degradado para leer el texto */}
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/80 to-transparent" />

      {/* Contenido */}
      <div className="relative z-10 flex h-full flex-col items-center justify-end p-6 text-center pb-12">

        {/* Nombre Gigante */}
        <h2 className="mb-3 text-3xl font-bold text-yellow-400 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] transition-all duration-500">
          {fullName}
        </h2>

        {/* Biografía Breve */}
        <div className="line-clamp-4 max-w-prose text-sm leading-relaxed text-gray-100 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] bg-black/30 p-2 rounded-lg backdrop-blur-sm">
          {saintInfo?.extract ? saintInfo.extract : "Santoral del día"}
        </div>

        {/* Indicador de progreso (Puntos) */}
        <div className="absolute bottom-4 flex gap-2">
          {saints.map((_, idx) => (
            <div
              key={idx}
              className={`h-1.5 rounded-full transition-all duration-300 ${idx === currentIndex ? "w-6 bg-yellow-500" : "w-1.5 bg-white/30"}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
