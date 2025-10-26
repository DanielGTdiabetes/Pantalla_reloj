import { Cloud, Droplets, Wind, ThermometerSun } from 'lucide-react';

const WeatherCard = () => {
  // Placeholder data - en producción esto vendría de una API
  const weather = {
    temp: 24,
    condition: 'Parcialmente nublado',
    humidity: 65,
    wind: 12,
    feelsLike: 26
  };

  return (
    <div className="flex flex-col items-center justify-center h-full space-y-6 p-6">
      <div className="flex items-center space-x-4">
        <Cloud className="w-16 h-16 text-primary" />
        <div>
          <div className="text-5xl font-bold text-foreground">
            {weather.temp}°C
          </div>
          <div className="text-sm text-muted-foreground">
            Sensación: {weather.feelsLike}°C
          </div>
        </div>
      </div>
      
      <div className="text-center text-xl text-muted-foreground">
        {weather.condition}
      </div>

      <div className="grid grid-cols-2 gap-4 w-full">
        <div className="flex items-center space-x-2 bg-muted/30 rounded-lg p-3">
          <Droplets className="w-5 h-5 text-accent" />
          <div>
            <div className="text-xs text-muted-foreground">Humedad</div>
            <div className="text-lg font-semibold">{weather.humidity}%</div>
          </div>
        </div>
        <div className="flex items-center space-x-2 bg-muted/30 rounded-lg p-3">
          <Wind className="w-5 h-5 text-accent" />
          <div>
            <div className="text-xs text-muted-foreground">Viento</div>
            <div className="text-lg font-semibold">{weather.wind} km/h</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WeatherCard;
