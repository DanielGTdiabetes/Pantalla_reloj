# Guía de despliegue – Backend Pantalla Futurista

Esta guía cubre la instalación del backend mínimo (FastAPI + Uvicorn) que expone
servicios de clima, Wi-Fi y TTS para la Pantalla Futurista. Está pensado para
Raspberry Pi OS o distribuciones basadas en Debian con NetworkManager.

## 1. Preparar usuario de servicio

Crear usuario y grupo sin acceso interactivo:

```bash
sudo adduser --system --group --home /opt/pantalla dashsvc
```

Conceder acceso a NetworkManager. Dos opciones:

1. Añadir `dashsvc` al grupo `netdev` (si la política local lo permite):
   ```bash
   sudo usermod -a -G netdev dashsvc
   ```
2. O crear una política sudo restringida (recomendado cuando `nmcli` requiere privilegios):
   ```bash
   echo 'dashsvc ALL=(root) NOPASSWD:/usr/bin/nmcli' | sudo tee /etc/sudoers.d/pantalla-dash
   sudo chmod 440 /etc/sudoers.d/pantalla-dash
   ```
   Luego exporta `NMCLI_BIN="sudo /usr/bin/nmcli"` si cambias el binario (por defecto no es necesario).

## 2. Configuración segura

Crear directorio y archivo de configuración:

```bash
sudo install -d -m700 /etc/pantalla-dash
sudo install -m600 backend/config/config.example.json /etc/pantalla-dash/config.json
sudo chown root:root /etc/pantalla-dash/config.json
```

Edita `/etc/pantalla-dash/config.json` con:

- Latitud/longitud, ciudad y unidades.
- `weather.apiKey` con tu clave de OpenWeatherMap.
- `wifi.preferredInterface` si la interfaz no es `wlan0`.
- Opcionales: tema inicial, intervalo de fondos, voz y volumen TTS.

## 3. Instalar dependencias

Dentro de `/opt/pantalla` (o la ruta elegida):

```bash
sudo mkdir -p /opt/pantalla
sudo chown dashsvc:dashsvc /opt/pantalla
cd /opt/pantalla
sudo -u dashsvc python3 -m venv .venv
sudo -u dashsvc .venv/bin/pip install -r /ruta/al/repositorio/backend/requirements.txt
```

Copia el código (o enlaza) al directorio de trabajo:

```bash
sudo rsync -a /ruta/al/repositorio/backend/ /opt/pantalla/backend/
```

Asegúrate de que `backend/storage/cache` y `backend/storage/logs` son propiedad de `dashsvc`:

```bash
sudo chown -R dashsvc:dashsvc /opt/pantalla/backend/storage
```

## 4. Servicio systemd

Copiar la unidad incluida:

```bash
sudo cp /ruta/al/repositorio/system/pantalla-dash-backend.service /etc/systemd/system/
```

Editar `WorkingDirectory` si el backend vive en otra ruta.

Recargar y habilitar:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now pantalla-dash-backend.service
```

El servicio inicia Uvicorn en `127.0.0.1:8787`. Revisa estado y logs:

```bash
sudo systemctl status pantalla-dash-backend.service
journalctl -u pantalla-dash-backend.service -f
```

## 5. Pruebas rápidas

Ejecutar pruebas desde la propia Pi:

```bash
curl -s http://127.0.0.1:8787/api/weather/current
curl -s http://127.0.0.1:8787/api/wifi/status
curl -s http://127.0.0.1:8787/api/tts/voices
```

La UI servida en `:8080` debe apuntar a `http://127.0.0.1:8787` (se incluye de
forma predeterminada en los servicios del frontend).

## 6. Troubleshooting

- **Clima 503**: verifica que `weather.apiKey` sea válido y que el dispositivo tenga conectividad saliente.
- **Wi-Fi sin permisos**: confirma que `dashsvc` puede ejecutar `nmcli` sin contraseña.
- **TTS silencioso**: instala `pico2wave` (`sudo apt install libttspico-utils`) o `espeak-ng`, y asegúrate de tener un reproductor (`alsa-utils` para `aplay`).
- **Permisos de config**: deben ser `600` con propietario `root`. El backend rechazará configuraciones inválidas.

Mantén el backend actualizado sincronizando el repositorio y reiniciando el servicio:

```bash
sudo systemctl restart pantalla-dash-backend.service
```
