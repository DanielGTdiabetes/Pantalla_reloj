import { BookOpen } from 'lucide-react';

const EphemeridesCard = () => {
  const ephemerides = [
    {
      year: 1492,
      event: 'Cristóbal Colón descubre América, llegando a la isla de Guanahani en las Bahamas.'
    },
    {
      year: 1917,
      event: 'Inicio de la Revolución de Octubre en Rusia, marcando un punto de inflexión en la historia mundial.'
    },
    {
      year: 1945,
      event: 'Fundación de las Naciones Unidas, estableciendo un marco para la cooperación internacional.'
    },
    {
      year: 1969,
      event: 'Primera transmisión de datos a través de ARPANET, precursor de Internet.'
    },
    {
      year: 2001,
      event: 'Lanzamiento del iPod de Apple, revolucionando la forma en que escuchamos música.'
    }
  ];

  return (
    <div className="flex flex-col h-full overflow-hidden p-6">
      <div className="flex items-center space-x-3 mb-6">
        <BookOpen className="w-8 h-8 text-secondary" />
        <h2 className="text-2xl font-bold">Efemérides</h2>
      </div>
      
      <div className="flex-1 overflow-hidden relative">
        <div className="animate-scroll-up space-y-6">
          {[...ephemerides, ...ephemerides].map((item, index) => (
            <div key={index} className="bg-muted/20 rounded-lg p-4 border border-border/50">
              <div className="text-2xl font-bold text-secondary mb-2">
                {item.year}
              </div>
              <p className="text-sm text-foreground leading-relaxed">
                {item.event}
              </p>
            </div>
          ))}
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-card to-transparent pointer-events-none" />
      </div>
    </div>
  );
};

export default EphemeridesCard;
