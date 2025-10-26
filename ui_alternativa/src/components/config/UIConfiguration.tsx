import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Save } from 'lucide-react';

interface UIConfig {
  rotation_delay: number;
  theme: string;
  rotation_order: string[];
}

const AVAILABLE_CARDS = [
  { id: 'time', label: 'Hora y Fecha' },
  { id: 'weather', label: 'Clima' },
  { id: 'calendar', label: 'Calendario' },
  { id: 'moon', label: 'Fases Lunares' },
  { id: 'harvest', label: 'Cosecha del Mes' },
  { id: 'saints', label: 'Santoral' },
  { id: 'news', label: 'Noticias' },
  { id: 'ephemerides', label: 'Efemérides' },
];

const THEMES = [
  { id: 'crt_green', label: 'CRT Verde (Retro)' },
  { id: 'synthwave', label: 'Synthwave' },
  { id: 'minimal', label: 'Minimalista' },
  { id: 'dark', label: 'Oscuro' },
];

const UIConfiguration = () => {
  const [config, setConfig] = useState<UIConfig>({
    rotation_delay: 15,
    theme: 'crt_green',
    rotation_order: ['time', 'weather', 'calendar', 'moon', 'harvest', 'saints', 'news', 'ephemerides'],
  });

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
        if (data.ui) {
          setConfig({
            rotation_delay: data.ui.rotation_delay || 15,
            theme: data.ui.theme || 'crt_green',
            rotation_order: data.ui.rotation_order || config.rotation_order,
          });
        }
      }
    } catch (error) {
      console.error('Error loading UI config:', error);
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
          ui: config,
        }),
      });

      if (response.ok) {
        toast.success('Configuración de UI guardada. Recarga la página para aplicar cambios.');
      } else {
        toast.error('Error al guardar la configuración');
      }
    } catch (error) {
      toast.error('No se pudo conectar con el backend');
    } finally {
      setSaving(false);
    }
  };

  const moveCard = (index: number, direction: 'up' | 'down') => {
    const newOrder = [...config.rotation_order];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    
    if (targetIndex < 0 || targetIndex >= newOrder.length) return;
    
    [newOrder[index], newOrder[targetIndex]] = [newOrder[targetIndex], newOrder[index]];
    setConfig({ ...config, rotation_order: newOrder });
  };

  const toggleCard = (cardId: string) => {
    const isEnabled = config.rotation_order.includes(cardId);
    if (isEnabled) {
      setConfig({
        ...config,
        rotation_order: config.rotation_order.filter(id => id !== cardId),
      });
    } else {
      setConfig({
        ...config,
        rotation_order: [...config.rotation_order, cardId],
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Theme Selection */}
      <div className="space-y-2">
        <Label htmlFor="theme">Tema Visual</Label>
        <Select value={config.theme} onValueChange={(value) => setConfig({ ...config, theme: value })}>
          <SelectTrigger id="theme">
            <SelectValue placeholder="Selecciona un tema" />
          </SelectTrigger>
          <SelectContent>
            {THEMES.map(theme => (
              <SelectItem key={theme.id} value={theme.id}>
                {theme.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Rotation Delay */}
      <div className="space-y-2">
        <Label htmlFor="rotation_delay">Tiempo de Rotación (segundos)</Label>
        <Input
          id="rotation_delay"
          type="number"
          min="5"
          max="60"
          value={config.rotation_delay}
          onChange={(e) => setConfig({ ...config, rotation_delay: parseInt(e.target.value) || 15 })}
        />
        <p className="text-xs text-muted-foreground">
          Tiempo que cada tarjeta permanece visible antes de rotar
        </p>
      </div>

      {/* Card Order */}
      <div className="space-y-3">
        <Label>Orden y Tarjetas Visibles</Label>
        <div className="space-y-2">
          {AVAILABLE_CARDS.map((card, index) => {
            const isEnabled = config.rotation_order.includes(card.id);
            const orderIndex = config.rotation_order.indexOf(card.id);
            
            return (
              <div
                key={card.id}
                className="flex items-center gap-3 p-3 border border-border rounded-lg"
              >
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={() => toggleCard(card.id)}
                  className="w-4 h-4"
                />
                <span className="flex-1">{card.label}</span>
                {isEnabled && (
                  <>
                    <span className="text-sm text-muted-foreground">#{orderIndex + 1}</span>
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => moveCard(orderIndex, 'up')}
                        disabled={orderIndex === 0}
                      >
                        ↑
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => moveCard(orderIndex, 'down')}
                        disabled={orderIndex === config.rotation_order.length - 1}
                      >
                        ↓
                      </Button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Save Button */}
      <Button onClick={saveConfig} disabled={saving} className="w-full">
        <Save className="w-4 h-4 mr-2" />
        {saving ? 'Guardando...' : 'Guardar Configuración'}
      </Button>
    </div>
  );
};

export default UIConfiguration;
