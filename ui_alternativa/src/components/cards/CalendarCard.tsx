import { Calendar as CalendarIcon } from 'lucide-react';
import { useState, useEffect } from 'react';

const CalendarCard = () => {
  const [currentDate, setCurrentDate] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentDate(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const monthNames = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();
    
    return { daysInMonth, startingDayOfWeek };
  };

  const { daysInMonth, startingDayOfWeek } = getDaysInMonth(currentDate);
  const today = currentDate.getDate();

  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const blanks = Array.from({ length: startingDayOfWeek }, (_, i) => i);

  return (
    <div className="flex flex-col items-center justify-center h-full p-6">
      <div className="flex items-center space-x-3 mb-6">
        <CalendarIcon className="w-8 h-8 text-accent" />
        <h2 className="text-3xl font-bold">
          {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
        </h2>
      </div>

      <div className="grid grid-cols-7 gap-2 w-full max-w-md">
        {['D', 'L', 'M', 'X', 'J', 'V', 'S'].map((day, i) => (
          <div key={i} className="text-center text-xs font-semibold text-muted-foreground py-2">
            {day}
          </div>
        ))}
        {blanks.map((blank) => (
          <div key={`blank-${blank}`} />
        ))}
        {days.map((day) => (
          <div
            key={day}
            className={`text-center py-2 rounded-lg text-sm ${
              day === today
                ? 'bg-primary text-primary-foreground font-bold'
                : 'text-foreground hover:bg-muted/30'
            }`}
          >
            {day}
          </div>
        ))}
      </div>
    </div>
  );
};

export default CalendarCard;
