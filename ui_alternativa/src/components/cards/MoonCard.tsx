import { Moon } from 'lucide-react';

const MoonCard = () => {
  // Placeholder data - en producción calcularía la fase lunar real
  const moonPhases = [
    { phase: 'Luna Nueva', emoji: '🌑', date: '1 Nov' },
    { phase: 'Cuarto Creciente', emoji: '🌓', date: '9 Nov' },
    { phase: 'Luna Llena', emoji: '🌕', date: '15 Nov' },
    { phase: 'Cuarto Menguante', emoji: '🌗', date: '23 Nov' }
  ];

  const currentPhase = moonPhases[2]; // Luna Llena como ejemplo

  return (
    <div className="flex flex-col items-center justify-center h-full space-y-6 p-6">
      <div className="flex items-center space-x-3">
        <Moon className="w-8 h-8 text-primary" />
        <h2 className="text-2xl font-bold">Fases Lunares</h2>
      </div>

      <div className="text-center space-y-4">
        <div className="text-7xl">{currentPhase.emoji}</div>
        <div>
          <div className="text-2xl font-bold text-primary">{currentPhase.phase}</div>
          <div className="text-sm text-muted-foreground">{currentPhase.date}</div>
        </div>
      </div>

      <div className="w-full space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground text-center">
          Próximas fases
        </h3>
        <div className="grid grid-cols-4 gap-2">
          {moonPhases.map((phase, index) => (
            <div 
              key={index}
              className={`text-center p-2 rounded-lg transition-colors ${
                phase.phase === currentPhase.phase 
                  ? 'bg-primary/20 border border-primary' 
                  : 'bg-muted/20'
              }`}
            >
              <div className="text-2xl mb-1">{phase.emoji}</div>
              <div className="text-xs text-muted-foreground">{phase.date}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default MoonCard;
