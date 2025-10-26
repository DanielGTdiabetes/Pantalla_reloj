import { useState } from 'react';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Key } from 'lucide-react';

interface MapboxTokenInputProps {
  onTokenSubmit: (token: string) => void;
}

const MapboxTokenInput = ({ onTokenSubmit }: MapboxTokenInputProps) => {
  const [token, setToken] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (token.trim()) {
      localStorage.setItem('mapbox_token', token.trim());
      onTokenSubmit(token.trim());
    }
  };

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-card/95 backdrop-blur-sm border border-border rounded-lg p-4 shadow-2xl max-w-md">
      <div className="flex items-center space-x-2 mb-3">
        <Key className="w-5 h-5 text-primary" />
        <h3 className="font-semibold">Configuración de Mapbox</h3>
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        <Input
          type="text"
          placeholder="Pega tu token de Mapbox aquí"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="font-mono text-sm"
        />
        <div className="flex space-x-2">
          <Button type="submit" className="flex-1">
            Guardar Token
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => window.open('https://account.mapbox.com/access-tokens/', '_blank')}
          >
            Obtener Token
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          El token se guardará localmente en tu navegador
        </p>
      </form>
    </div>
  );
};

export default MapboxTokenInput;
