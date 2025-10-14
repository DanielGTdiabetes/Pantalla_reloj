import { useEffect, useRef } from 'react';
import DynamicBackground from './components/DynamicBackground';
import StatusBar from './components/StatusBar';
import Clock from './components/Clock';
import Weather from './components/Weather';
import WeatherBrief from './components/WeatherBrief';
import CalendarPeek from './components/CalendarPeek';
import DayStrip from './components/DayStrip';
import MonthTips from './components/MonthTips';
import StormOverlay from './components/StormOverlay';
import SceneEffects from './components/SceneEffects';
import FpsMeter from './components/FpsMeter';
import { DashboardConfigProvider, useDashboardConfig } from './context/DashboardConfigContext';
import { StormStatusProvider } from './context/StormStatusContext';
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
      <SceneEffects />
      <div className="relative z-10 flex h-full w-full max-w-[1920px] flex-col gap-4 px-10 py-6">
        <StatusBar />
        <div className="grid flex-1 grid-cols-[40%_35%_25%] gap-6">
          <Clock />
          <div className="flex h-full flex-col gap-3">
            <div className="flex flex-1">
              <Weather />
            </div>
            <WeatherBrief />
          </div>
          <div className="flex h-full flex-col gap-3">
            <CalendarPeek />
            <DayStrip />
            <MonthTips />
          </div>
        </div>
      </div>
      <StormOverlay />
      <FpsMeter />
    </div>
  );
};

const App = () => (
  <DashboardConfigProvider>
    <StormStatusProvider>
      <DashboardLayout />
    </StormStatusProvider>
  </DashboardConfigProvider>
);

export default App;
