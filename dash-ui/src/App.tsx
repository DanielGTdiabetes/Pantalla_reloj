import { useEffect, useRef } from 'react';
import DynamicBackground from './components/DynamicBackground';
import StatusBar from './components/StatusBar';
import Clock from './components/Clock';
import Weather from './components/Weather';
import CalendarPeek from './components/CalendarPeek';
import StormOverlay from './components/StormOverlay';
import { DashboardConfigProvider, useDashboardConfig } from './context/DashboardConfigContext';
import { BACKEND_BASE_URL } from './services/config';

const useGeolocationSync = () => {
  const postedRef = useRef(false);

  useEffect(() => {
    if (postedRef.current) return;
    if (!('geolocation' in navigator)) return;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (postedRef.current) return;
        postedRef.current = true;
        const { latitude, longitude } = position.coords;
        void fetch(`${BACKEND_BASE_URL}/api/location/override`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat: latitude, lon: longitude }),
        }).catch(() => {
          // La ubicación es opcional; silenciosamente ignoramos errores.
        });
      },
      () => {
        postedRef.current = true;
      },
      { enableHighAccuracy: true, maximumAge: 5 * 60_000, timeout: 5_000 },
    );
  }, []);
};

const DashboardLayout = () => {
  const { config } = useDashboardConfig();
  useGeolocationSync();

  const refreshMinutes = config?.background?.intervalMinutes ?? 60;

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
      <DynamicBackground refreshMinutes={refreshMinutes} />
      <div className="relative z-10 flex h-full w-full max-w-[1920px] flex-col gap-4 px-10 py-6">
        <StatusBar />
        <div className="grid flex-1 grid-cols-[40%_35%_25%] gap-6">
          <Clock />
          <Weather />
          <CalendarPeek />
        </div>
      </div>
      <StormOverlay />
    </div>
  );
};

const App = () => (
  <DashboardConfigProvider>
    <DashboardLayout />
  </DashboardConfigProvider>
);

export default App;
