import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import WiFiManager from "@/components/config/WiFiManager";
import APIConfiguration from "@/components/config/APIConfiguration";
import UIConfiguration from "@/components/config/UIConfiguration";
import SystemInfo from "@/components/config/SystemInfo";
import { Wifi, Key, Settings, Info } from "lucide-react";

const Config = () => {
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="space-y-2">
          <h1 className="text-4xl font-bold text-primary">Configuración del Sistema</h1>
          <p className="text-muted-foreground">
            Panel de control para Pantalla_reloj - Acceso vía IP local
          </p>
        </div>

        <Tabs defaultValue="wifi" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="wifi" className="flex items-center gap-2">
              <Wifi className="w-4 h-4" />
              <span className="hidden sm:inline">Wi-Fi</span>
            </TabsTrigger>
            <TabsTrigger value="api" className="flex items-center gap-2">
              <Key className="w-4 h-4" />
              <span className="hidden sm:inline">APIs</span>
            </TabsTrigger>
            <TabsTrigger value="ui" className="flex items-center gap-2">
              <Settings className="w-4 h-4" />
              <span className="hidden sm:inline">UI</span>
            </TabsTrigger>
            <TabsTrigger value="system" className="flex items-center gap-2">
              <Info className="w-4 h-4" />
              <span className="hidden sm:inline">Sistema</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="wifi" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Gestor de Red Wi-Fi</CardTitle>
                <CardDescription>
                  Escanea y conecta a redes Wi-Fi disponibles
                </CardDescription>
              </CardHeader>
              <CardContent>
                <WiFiManager />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="api" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Configuración de APIs</CardTitle>
                <CardDescription>
                  Configura las claves de acceso a servicios externos
                </CardDescription>
              </CardHeader>
              <CardContent>
                <APIConfiguration />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ui" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Configuración de Interfaz</CardTitle>
                <CardDescription>
                  Personaliza el comportamiento y apariencia del sistema
                </CardDescription>
              </CardHeader>
              <CardContent>
                <UIConfiguration />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="system" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Información del Sistema</CardTitle>
                <CardDescription>
                  Estado y diagnóstico del sistema
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SystemInfo />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Config;
