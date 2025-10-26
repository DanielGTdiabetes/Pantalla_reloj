import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Save, Eye, EyeOff } from 'lucide-react';

interface APIConfig {
  mapbox_token: string;
  openweather_key: string;
  google_calendar_enabled: boolean;
  google_calendar_id: string;
}

const APIConfiguration = () => {
  const [config, setConfig] = useState<APIConfig>({
    mapbox_token: '',
    openweather_key: '',
    google_calendar_enabled: false,
    google_calendar_id: '',
  });

  const [showTokens, setShowTokens] = useState<{ [key: string]: boolean }>({});
  const [saving, setSaving] = useState(false);

  const API_BASE = 'http://localhost:8081/api';

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const response = await fetch(`${API_BASE}/config`);
      if (response.ok) {
        const data = await response.json();
        setConfig({
          mapbox_token: data.mapbox_token || '',
          openweather_key: data.openweather_key || '',
          google_calendar_enabled: data.calendar?.google_enabled || false,
          google_calendar_id: data.calendar?.google_calendar_id || '',
        });
      }
    } catch (error) {
      console.error('Error loading config:', error);
      // Load from localStorage as fallback
      const savedMapboxToken = localStorage.getItem('mapbox_token');
      if (savedMapboxToken) {
        setConfig(prev => ({ ...prev, mapbox_token: savedMapboxToken }));
      }
    }
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      const response = await fetch(`${API_BASE}/config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          mapbox_token: config.mapbox_token,
          openweather_key: config.openweather_key,
          calendar: {
            google_enabled: config.google_calendar_enabled,
            google_calendar_id: config.google_calendar_id,
          },
        }),
      });

      if (response.ok) {
        toast.success('Configuración guardada correctamente');
        // Also save to localStorage for immediate frontend use
        localStorage.setItem('mapbox_token', config.mapbox_token);
      } else {
        toast.error('Error al guardar la configuración');
      }
    } catch (error) {
      toast.error('No se pudo conectar con el backend');
      // Save to localStorage as fallback
      localStorage.setItem('mapbox_token', config.mapbox_token);
      toast.success('Configuración guardada localmente');
    } finally {
      setSaving(false);
    }
  };

  const toggleShowToken = (field: string) => {
    setShowTokens(prev => ({ ...prev, [field]: !prev[field] }));
  };

  return (
    <div className="space-y-6">
      {/* Mapbox Token */}
      <div className="space-y-2">
        <Label htmlFor="mapbox_token">Token de Mapbox</Label>
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Input
              id="mapbox_token"
              type={showTokens['mapbox'] ? 'text' : 'password'}
              value={config.mapbox_token}
              onChange={(e) => setConfig({ ...config, mapbox_token: e.target.value })}
              placeholder="pk.eyJ1..."
              className="font-mono text-sm pr-10"
            />
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-0 top-0 h-full px-3"
              onClick={() => toggleShowToken('mapbox')}
            >
              {showTokens['mapbox'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Obtén tu token en{' '}
          <a
            href="https://account.mapbox.com/access-tokens/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            account.mapbox.com
          </a>
        </p>
      </div>

      {/* OpenWeatherMap API Key */}
      <div className="space-y-2">
        <Label htmlFor="openweather_key">API Key de OpenWeatherMap</Label>
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Input
              id="openweather_key"
              type={showTokens['openweather'] ? 'text' : 'password'}
              value={config.openweather_key}
              onChange={(e) => setConfig({ ...config, openweather_key: e.target.value })}
              placeholder="Introduce tu API key"
              className="font-mono text-sm pr-10"
            />
            <Button
              variant="ghost"
              size="sm"
              className="absolute right-0 top-0 h-full px-3"
              onClick={() => toggleShowToken('openweather')}
            >
              {showTokens['openweather'] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Obtén tu API key en{' '}
          <a
            href="https://openweathermap.org/api"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            openweathermap.org
          </a>
        </p>
      </div>

      {/* Google Calendar */}
      <div className="space-y-4 p-4 border border-border rounded-lg">
        <div className="flex items-center justify-between">
          <Label htmlFor="google_calendar_enabled" className="text-base">Google Calendar</Label>
          <input
            id="google_calendar_enabled"
            type="checkbox"
            checked={config.google_calendar_enabled}
            onChange={(e) => setConfig({ ...config, google_calendar_enabled: e.target.checked })}
            className="w-4 h-4"
          />
        </div>
        
        {config.google_calendar_enabled && (
          <div className="space-y-2">
            <Label htmlFor="google_calendar_id">ID del Calendario</Label>
            <Input
              id="google_calendar_id"
              type="text"
              value={config.google_calendar_id}
              onChange={(e) => setConfig({ ...config, google_calendar_id: e.target.value })}
              placeholder="tu-email@gmail.com"
            />
          </div>
        )}
      </div>

      {/* Save Button */}
      <Button onClick={saveConfig} disabled={saving} className="w-full">
        <Save className="w-4 h-4 mr-2" />
        {saving ? 'Guardando...' : 'Guardar Configuración'}
      </Button>
    </div>
  );
};

export default APIConfiguration;
