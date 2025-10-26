import { useState, useEffect } from 'react';
import WorldMap from '@/components/WorldMap';
import RotatingCard from '@/components/RotatingCard';
import MapboxTokenInput from '@/components/MapboxTokenInput';

const Index = () => {
  const [mapboxToken, setMapboxToken] = useState<string>('');
  const [showTokenInput, setShowTokenInput] = useState(false);

  useEffect(() => {
    const savedToken = localStorage.getItem('mapbox_token');
    if (savedToken) {
      setMapboxToken(savedToken);
    } else {
      setShowTokenInput(true);
    }
  }, []);

  const handleTokenSubmit = (token: string) => {
    setMapboxToken(token);
    setShowTokenInput(false);
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-background">
      {showTokenInput && <MapboxTokenInput onTokenSubmit={handleTokenSubmit} />}
      
      <div className="flex w-full h-full">
        {/* Map section - 80% width */}
        <div className="w-[80%] h-full">
          <WorldMap mapboxToken={mapboxToken} />
        </div>

        {/* Rotating cards section - 20% width */}
        <div className="w-[20%] h-full p-4 relative">
          <RotatingCard />
        </div>
      </div>
    </div>
  );
};

export default Index;
