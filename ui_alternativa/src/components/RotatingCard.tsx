import { useState, useEffect } from 'react';
import TimeCard from './cards/TimeCard';
import WeatherCard from './cards/WeatherCard';
import NewsCard from './cards/NewsCard';
import EphemeridesCard from './cards/EphemeridesCard';
import CalendarCard from './cards/CalendarCard';
import HarvestCard from './cards/HarvestCard';
import MoonCard from './cards/MoonCard';
import SaintsCard from './cards/SaintsCard';

const cards = [
  { id: 'time', component: TimeCard, duration: 8000 },
  { id: 'weather', component: WeatherCard, duration: 10000 },
  { id: 'calendar', component: CalendarCard, duration: 10000 },
  { id: 'moon', component: MoonCard, duration: 10000 },
  { id: 'harvest', component: HarvestCard, duration: 12000 },
  { id: 'saints', component: SaintsCard, duration: 12000 },
  { id: 'news', component: NewsCard, duration: 20000 },
  { id: 'ephemerides', component: EphemeridesCard, duration: 20000 },
];

const RotatingCard = () => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    const currentCard = cards[currentIndex];
    const timer = setTimeout(() => {
      setIsTransitioning(true);
      setTimeout(() => {
        setCurrentIndex((prev) => (prev + 1) % cards.length);
        setIsTransitioning(false);
      }, 400);
    }, currentCard.duration);

    return () => clearTimeout(timer);
  }, [currentIndex]);

  const CurrentCardComponent = cards[currentIndex].component;

  return (
    <div className="w-full h-full bg-gradient-to-br from-card via-card to-muted/10 rounded-lg border border-border shadow-2xl overflow-hidden">
      <div
        className={`w-full h-full transition-all duration-400 ${
          isTransitioning ? 'opacity-0 scale-95' : 'opacity-100 scale-100'
        }`}
      >
        <CurrentCardComponent />
      </div>

      {/* Progress indicators */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex space-x-2">
        {cards.map((_, index) => (
          <div
            key={index}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              index === currentIndex
                ? 'w-8 bg-primary'
                : 'w-1.5 bg-muted-foreground/30'
            }`}
          />
        ))}
      </div>
    </div>
  );
};

export default RotatingCard;
