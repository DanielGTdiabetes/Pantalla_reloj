import { Sprout } from 'lucide-react';

const HarvestCard = () => {
  // Data de ejemplo - varía según el mes
  const monthlyHarvest = {
    month: 'Octubre',
    vegetables: [
      { name: 'Calabazas', emoji: '🎃' },
      { name: 'Remolachas', emoji: '🥕' },
      { name: 'Acelgas', emoji: '🥬' },
      { name: 'Brócoli', emoji: '🥦' }
    ],
    fruits: [
      { name: 'Manzanas', emoji: '🍎' },
      { name: 'Peras', emoji: '🍐' },
      { name: 'Uvas', emoji: '🍇' },
      { name: 'Granadas', emoji: '🍒' }
    ]
  };

  return (
    <div className="flex flex-col h-full p-6">
      <div className="flex items-center space-x-3 mb-6">
        <Sprout className="w-8 h-8 text-accent" />
        <h2 className="text-2xl font-bold">Cosecha de {monthlyHarvest.month}</h2>
      </div>

      <div className="flex-1 space-y-6">
        <div>
          <h3 className="text-lg font-semibold text-primary mb-3">Verduras y Hortalizas</h3>
          <div className="grid grid-cols-2 gap-3">
            {monthlyHarvest.vegetables.map((item, index) => (
              <div 
                key={index}
                className="flex items-center space-x-2 bg-muted/20 rounded-lg p-3 border border-border/50"
              >
                <span className="text-2xl">{item.emoji}</span>
                <span className="text-sm font-medium">{item.name}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-lg font-semibold text-secondary mb-3">Frutas de Temporada</h3>
          <div className="grid grid-cols-2 gap-3">
            {monthlyHarvest.fruits.map((item, index) => (
              <div 
                key={index}
                className="flex items-center space-x-2 bg-muted/20 rounded-lg p-3 border border-border/50"
              >
                <span className="text-2xl">{item.emoji}</span>
                <span className="text-sm font-medium">{item.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default HarvestCard;
