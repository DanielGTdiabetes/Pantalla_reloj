import { Cross } from 'lucide-react';

const SaintsCard = () => {
  // Data de ejemplo
  const todaySaints = [
    { name: 'San Francisco de Asís', description: 'Patrono de los animales y la ecología' },
    { name: 'Santa Teresa de Lisieux', description: 'Doctora de la Iglesia, conocida como la pequeña flor' }
  ];

  const upcomingSaints = [
    { date: '15 Oct', name: 'Santa Teresa de Ávila' },
    { date: '18 Oct', name: 'San Lucas Evangelista' },
    { date: '25 Oct', name: 'San Crispín' },
    { date: '31 Oct', name: 'San Alfonso Rodríguez' }
  ];

  return (
    <div className="flex flex-col h-full p-6">
      <div className="flex items-center space-x-3 mb-6">
        <Cross className="w-8 h-8 text-secondary" />
        <h2 className="text-2xl font-bold">Santoral</h2>
      </div>

      <div className="space-y-6">
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground mb-3">Santo del día</h3>
          {todaySaints.map((saint, index) => (
            <div 
              key={index}
              className="bg-gradient-to-br from-muted/30 to-muted/10 rounded-lg p-4 border border-border/50 mb-3"
            >
              <div className="text-lg font-bold text-secondary mb-1">
                {saint.name}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {saint.description}
              </p>
            </div>
          ))}
        </div>

        <div>
          <h3 className="text-sm font-semibold text-muted-foreground mb-3">Próximos santos</h3>
          <div className="space-y-2">
            {upcomingSaints.map((saint, index) => (
              <div 
                key={index}
                className="flex items-center justify-between bg-muted/20 rounded-lg p-3"
              >
                <span className="text-sm font-medium">{saint.name}</span>
                <span className="text-xs text-primary font-semibold">{saint.date}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SaintsCard;
