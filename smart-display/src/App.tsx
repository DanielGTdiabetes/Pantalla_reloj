import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { MainLayout } from './components/layout/MainLayout';
import { DesktopDashboard } from './pages/DesktopDashboard';

import { SettingsPage } from './pages/SettingsPage';

// Placeholder pages
const Placeholder = ({ title }: { title: string }) => (
  <div style={{ padding: '2rem' }}>
    <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>{title}</h1>
    <p style={{ color: 'var(--text-muted)' }}>Módulo en construcción...</p>
  </div>
);

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MainLayout />}>
          <Route index element={<DesktopDashboard />} />
          <Route path="map" element={<Placeholder title="Mapa Global" />} />
          <Route path="weather" element={<Placeholder title="Tiempo Detallado" />} />
          <Route path="flights" element={<Placeholder title="Tráfico Aéreo" />} />
          <Route path="ships" element={<Placeholder title="Tráfico Marítimo" />} />
          <Route path="radar" element={<Placeholder title="Radar de Lluvia" />} />
          <Route path="calendar" element={<Placeholder title="Agenda" />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
