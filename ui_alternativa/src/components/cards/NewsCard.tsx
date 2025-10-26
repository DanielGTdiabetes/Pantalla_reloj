import { Newspaper } from 'lucide-react';

const NewsCard = () => {
  // Placeholder data
  const news = [
    {
      title: 'Avance en energías renovables',
      summary: 'Nueva tecnología solar promete aumentar la eficiencia en un 40% según estudios recientes.'
    },
    {
      title: 'Descubrimiento arqueológico',
      summary: 'Investigadores encuentran antigua ciudad perdida en la selva amazónica.'
    },
    {
      title: 'Innovación en agricultura',
      summary: 'Nuevas técnicas de cultivo vertical podrían revolucionar la producción de alimentos en áreas urbanas.'
    },
    {
      title: 'Tecnología espacial',
      summary: 'Misión exitosa completa el primer aterrizaje en el polo sur lunar.'
    }
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden p-6">
      <div className="flex items-center space-x-3 mb-6">
        <Newspaper className="w-8 h-8 text-primary" />
        <h2 className="text-2xl font-bold">Noticias del día</h2>
      </div>
      
      <div className="flex-1 overflow-hidden relative">
        <div className="animate-scroll-up space-y-6">
          {[...news, ...news].map((item, index) => (
            <div key={index} className="border-l-4 border-primary pl-4 py-2">
              <h3 className="text-lg font-semibold mb-2 text-primary">
                {item.title}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {item.summary}
              </p>
            </div>
          ))}
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-card to-transparent pointer-events-none" />
      </div>
    </div>
  );
};

export default NewsCard;
