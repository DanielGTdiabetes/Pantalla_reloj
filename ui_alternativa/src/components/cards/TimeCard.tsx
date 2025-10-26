import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

const TimeCard = () => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('es-ES', { 
      hour: '2-digit', 
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('es-ES', { 
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  return (
    <div className="flex flex-col items-center justify-center h-full space-y-4">
      <Clock className="w-12 h-12 text-primary" />
      <div className="text-center">
        <div className="text-6xl font-bold text-primary mb-2 tracking-tight">
          {formatTime(time)}
        </div>
        <div className="text-lg text-muted-foreground capitalize">
          {formatDate(time)}
        </div>
      </div>
    </div>
  );
};

export default TimeCard;
