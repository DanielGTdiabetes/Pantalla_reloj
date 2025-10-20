import { Routes, Route } from 'react-router-dom';
import { DashboardConfigProvider } from './context/DashboardConfigContext';
import { StormStatusProvider } from './context/StormStatusContext';
import Display from './pages/Display';
import Config from './pages/Config';

const App = () => (
  <DashboardConfigProvider>
    <StormStatusProvider>
      <div className="h-full w-full">
        <Routes>
          <Route path="/" element={<Display />} />
          <Route path="/config" element={<Config />} />
        </Routes>
      </div>
    </StormStatusProvider>
  </DashboardConfigProvider>
);

export default App;
