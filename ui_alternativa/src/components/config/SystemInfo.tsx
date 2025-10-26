import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

interface SystemStatus {
  backend_status: 'online' | 'offline';
  frontend_version: string;
  backend_version: string;
  uptime: string;
  services: {
    weather: boolean;
    calendar: boolean;
    geoscope: boolean;
    mqtt: boolean;
  };
}

const SystemInfo = () => {
  const [status, setStatus] = useState<SystemStatus>({
    backend_status: 'offline',
    frontend_version: '1.0.0',
    backend_version: 'N/A',
    uptime: 'N/A',
    services: {
      weather: false,
      calendar: false,
      geoscope: false,
      mqtt: false,
    },
  });

  const [checking, setChecking] = useState(false);

  const API_BASE = 'http://localhost:8081/api';

  const checkSystemStatus = async () => {
    setChecking(true);
    try {
      const response = await fetch(`${API_BASE}/status`);
      if (response.ok) {
        const data = await response.json();
        setStatus({
          backend_status: 'online',
          frontend_version: '1.0.0',
          backend_version: data.version || '1.0.0',
          uptime: data.uptime || 'N/A',
          services: data.services || status.services,
        });
      } else {
        setStatus({ ...status, backend_status: 'offline' });
      }
    } catch (error) {
      setStatus({ ...status, backend_status: 'offline' });
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    checkSystemStatus();
    const interval = setInterval(checkSystemStatus, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, []);

  const StatusBadge = ({ status }: { status: boolean | 'online' | 'offline' }) => {
    const isOnline = status === true || status === 'online';
    return (
      <Badge variant={isOnline ? 'default' : 'destructive'} className="gap-1">
        {isOnline ? (
          <CheckCircle className="w-3 h-3" />
        ) : (
          <XCircle className="w-3 h-3" />
        )}
        {isOnline ? 'Activo' : 'Inactivo'}
      </Badge>
    );
  };

  return (
    <div className="space-y-6">
      {/* System Status */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Estado del Sistema</h3>
          <Button
            variant="outline"
            size="sm"
            onClick={checkSystemStatus}
            disabled={checking}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${checking ? 'animate-spin' : ''}`} />
            Actualizar
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="p-4 border border-border rounded-lg">
            <p className="text-sm text-muted-foreground mb-1">Backend</p>
            <StatusBadge status={status.backend_status} />
          </div>
          <div className="p-4 border border-border rounded-lg">
            <p className="text-sm text-muted-foreground mb-1">Tiempo Activo</p>
            <p className="font-mono text-sm">{status.uptime}</p>
          </div>
          <div className="p-4 border border-border rounded-lg">
            <p className="text-sm text-muted-foreground mb-1">Versión Frontend</p>
            <p className="font-mono text-sm">{status.frontend_version}</p>
          </div>
          <div className="p-4 border border-border rounded-lg">
            <p className="text-sm text-muted-foreground mb-1">Versión Backend</p>
            <p className="font-mono text-sm">{status.backend_version}</p>
          </div>
        </div>
      </div>

      {/* Services Status */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold">Estado de Servicios</h3>
        
        <div className="space-y-2">
          <div className="flex items-center justify-between p-3 border border-border rounded-lg">
            <span>Servicio de Clima</span>
            <StatusBadge status={status.services.weather} />
          </div>
          <div className="flex items-center justify-between p-3 border border-border rounded-lg">
            <span>Google Calendar</span>
            <StatusBadge status={status.services.calendar} />
          </div>
          <div className="flex items-center justify-between p-3 border border-border rounded-lg">
            <span>GeoScope</span>
            <StatusBadge status={status.services.geoscope} />
          </div>
          <div className="flex items-center justify-between p-3 border border-border rounded-lg">
            <span>MQTT (Blitzortung)</span>
            <StatusBadge status={status.services.mqtt} />
          </div>
        </div>
      </div>

      {/* System Info */}
      <div className="p-4 bg-muted/30 rounded-lg space-y-2">
        <div className="flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-primary mt-0.5" />
          <div className="text-sm">
            <p className="font-medium mb-1">Información del Sistema</p>
            <p className="text-muted-foreground">
              Panel de configuración accesible vía IP local (no táctil)
            </p>
            <p className="text-muted-foreground mt-1">
              Sistema: Ubuntu 24.04 LTS • Pantalla: 1920×480 px
            </p>
          </div>
        </div>
      </div>

      {/* Backend Connection Warning */}
      {status.backend_status === 'offline' && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
          <div className="flex items-start gap-2">
            <XCircle className="w-5 h-5 text-destructive mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-destructive mb-1">Backend Desconectado</p>
              <p className="text-muted-foreground">
                No se pudo conectar con el backend en localhost:8081. 
                Verifica que el servicio FastAPI esté ejecutándose.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SystemInfo;
