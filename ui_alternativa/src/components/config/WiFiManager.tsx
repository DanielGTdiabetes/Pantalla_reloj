import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Wifi, WifiOff, Lock, Signal, RefreshCw, Check } from 'lucide-react';
import { toast } from 'sonner';

interface WiFiNetwork {
  ssid: string;
  signal: number;
  security: string;
  in_use: boolean;
}

const WiFiManager = () => {
  const [networks, setNetworks] = useState<WiFiNetwork[]>([]);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [selectedNetwork, setSelectedNetwork] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [currentConnection, setCurrentConnection] = useState<string | null>(null);

  const API_BASE = 'http://localhost:8081/api';

  const scanNetworks = async () => {
    setScanning(true);
    try {
      const response = await fetch(`${API_BASE}/wifi/scan`);
      if (response.ok) {
        const data = await response.json();
        setNetworks(data.networks || []);
        toast.success('Redes escaneadas correctamente');
      } else {
        toast.error('Error al escanear redes Wi-Fi');
      }
    } catch (error) {
      toast.error('No se pudo conectar con el backend');
      // Datos de prueba si no hay backend
      setNetworks([
        { ssid: 'Red_Casa', signal: 85, security: 'WPA2', in_use: false },
        { ssid: 'Vecino_WiFi', signal: 45, security: 'WPA2', in_use: false },
        { ssid: 'Public_Network', signal: 30, security: 'Open', in_use: false },
      ]);
    } finally {
      setScanning(false);
    }
  };

  const getCurrentConnection = async () => {
    try {
      const response = await fetch(`${API_BASE}/wifi/current`);
      if (response.ok) {
        const data = await response.json();
        setCurrentConnection(data.ssid || null);
      }
    } catch (error) {
      console.error('Error getting current connection:', error);
    }
  };

  const connectToNetwork = async (ssid: string) => {
    if (!ssid) return;

    setConnecting(true);
    try {
      const response = await fetch(`${API_BASE}/wifi/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ssid, password }),
      });

      if (response.ok) {
        toast.success(`Conectado a ${ssid}`);
        setSelectedNetwork(null);
        setPassword('');
        getCurrentConnection();
      } else {
        const error = await response.json();
        toast.error(error.detail || 'Error al conectar');
      }
    } catch (error) {
      toast.error('No se pudo conectar con el backend');
    } finally {
      setConnecting(false);
    }
  };

  const getSignalIcon = (signal: number) => {
    if (signal >= 70) return <Signal className="w-5 h-5 text-primary" />;
    if (signal >= 50) return <Signal className="w-5 h-5 text-yellow-500" />;
    return <Signal className="w-5 h-5 text-destructive" />;
  };

  useEffect(() => {
    getCurrentConnection();
    scanNetworks();
  }, []);

  return (
    <div className="space-y-4">
      {/* Current Connection */}
      {currentConnection && (
        <div className="p-4 bg-primary/10 rounded-lg border border-primary/20 flex items-center gap-3">
          <Wifi className="w-5 h-5 text-primary" />
          <div>
            <p className="font-medium">Conectado a</p>
            <p className="text-sm text-muted-foreground">{currentConnection}</p>
          </div>
        </div>
      )}

      {/* Scan Button */}
      <Button 
        onClick={scanNetworks} 
        disabled={scanning}
        className="w-full"
      >
        <RefreshCw className={`w-4 h-4 mr-2 ${scanning ? 'animate-spin' : ''}`} />
        {scanning ? 'Escaneando...' : 'Escanear Redes'}
      </Button>

      {/* Networks List */}
      <div className="space-y-2">
        {networks.length === 0 && !scanning && (
          <div className="text-center text-muted-foreground py-8">
            <WifiOff className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p>No se encontraron redes. Escanea para buscar.</p>
          </div>
        )}

        {networks.map((network) => (
          <div
            key={network.ssid}
            className="p-4 border border-border rounded-lg hover:border-primary/50 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 flex-1">
                {getSignalIcon(network.signal)}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{network.ssid}</p>
                    {network.in_use && (
                      <Check className="w-4 h-4 text-primary" />
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    {network.security !== 'Open' && (
                      <Lock className="w-3 h-3" />
                    )}
                    <span>{network.security}</span>
                    <span>•</span>
                    <span>{network.signal}%</span>
                  </div>
                </div>
              </div>

              {selectedNetwork !== network.ssid && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (network.security === 'Open') {
                      connectToNetwork(network.ssid);
                    } else {
                      setSelectedNetwork(network.ssid);
                    }
                  }}
                >
                  Conectar
                </Button>
              )}
            </div>

            {/* Password Input */}
            {selectedNetwork === network.ssid && (
              <div className="mt-4 space-y-3 border-t border-border pt-4">
                <div className="space-y-2">
                  <Label htmlFor="password">Contraseña</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Introduce la contraseña"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => connectToNetwork(network.ssid)}
                    disabled={connecting || !password}
                    className="flex-1"
                  >
                    {connecting ? 'Conectando...' : 'Confirmar'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelectedNetwork(null);
                      setPassword('');
                    }}
                  >
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default WiFiManager;
