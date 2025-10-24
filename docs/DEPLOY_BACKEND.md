# Guía de despliegue – Backend Pantalla 8.8"

Pasos para dejar operativo el backend FastAPI (clima AEMET, Wi-Fi, setup web) en
un mini PC con Linux y NetworkManager.

## 1. Usuario y permisos

Crear usuario dedicado sin shell interactivo:

```bash
sudo adduser --system --group --home /opt/pantalla dashsvc
```

Concede acceso a NetworkManager. Si `nmcli` requiere privilegios, añade al grupo
`netdev` o crea una entrada `sudoers` restringida:

```bash
sudo usermod -a -G netdev dashsvc
# o
echo 'dashsvc ALL=(root) NOPASSWD:/usr/bin/nmcli' | sudo tee /etc/sudoers.d/pantalla-dash
sudo chmod 440 /etc/sudoers.d/pantalla-dash
```

## 2. Configuración inicial

Instala la plantilla y ajusta permisos:

```bash
sudo groupadd -f pantalla
sudo install -d -m2770 -o root -g pantalla /etc/pantalla-dash
sudo install -m660 backend/config/config.example.json /etc/pantalla-dash/config.json
sudo install -m600 /dev/null /etc/pantalla-dash/secrets.json
sudo chown dani:pantalla /etc/pantalla-dash/config.json /etc/pantalla-dash/secrets.json
```

Asegura que el usuario del backend pertenezca al grupo `pantalla` y que el
resto de archivos compartan permisos:

```bash
sudo usermod -aG pantalla dani
sudo chgrp -R pantalla /etc/pantalla-dash
sudo chown dani:pantalla /etc/pantalla-dash/backend.env /etc/pantalla-dash/env
sudo chmod 660 /etc/pantalla-dash/backend.env /etc/pantalla-dash/env /etc/pantalla-dash/config.json
sudo chmod 600 /etc/pantalla-dash/secrets.json
```

Recuerda reiniciar sesión (o `newgrp pantalla`) tras añadir el usuario al grupo
para heredar los permisos.

Edita `/etc/pantalla-dash/config.json`:

- `aemet.apiKey` y `aemet.municipioId` con tus datos.
- `weather.city` y `weather.units` para la UI.
- `storm.threshold` para el aviso de tormentas (0-1).
- `wifi.preferredInterface` si no quieres autoselección.
- `calendar.provider` (`url`, `ics` o `google`), junto a `calendar.google.calendarId` si vas a usar Google Calendar.

Activa `systemd-timesyncd` para garantizar hora correcta:

```bash
sudo timedatectl set-ntp true
```

## 3. Dependencias y código

Prepara el entorno:

```bash
sudo mkdir -p /opt/pantalla
sudo chown dashsvc:dashsvc /opt/pantalla
cd /opt/pantalla
sudo -u dashsvc python3 -m venv .venv
sudo -u dashsvc .venv/bin/pip install -r /ruta/al/repositorio/backend/requirements.txt
sudo rsync -a /ruta/al/repositorio/backend/ /opt/pantalla/backend/
```

Asegura permisos de escritura para cachés:

```bash
sudo chown -R dashsvc:dashsvc /opt/pantalla/backend/storage
```

## 4. Servicios `systemd`

Copia los archivos de servicio y scripts auxiliares:

```bash
sudo install -Dm755 system/manage-ap.sh /opt/pantalla/manage-ap.sh
sudo install -Dm755 system/ensure-ap.sh /opt/pantalla/ensure-ap.sh
sudo install -Dm644 system/pantalla-dash-backend.service /etc/systemd/system/
sudo install -Dm644 system/pantalla-ap.service /etc/systemd/system/
sudo install -Dm644 system/pantalla-ap-ensure.service /etc/systemd/system/
sudo install -Dm644 system/pantalla-bg-generate.service /etc/systemd/system/
sudo install -Dm644 system/pantalla-bg-generate.timer /etc/systemd/system/
sudo install -Dm644 system/pantalla-bg-sync.service /etc/systemd/system/
sudo install -Dm644 system/pantalla-bg-sync.path /etc/systemd/system/
sudo install -Dm755 scripts/pantalla-bg-sync-timer /usr/local/sbin/pantalla-bg-sync-timer
sudo mkdir -p /etc/systemd/system/pantalla-bg-generate.timer.d
```

Opcional: crea `/etc/pantalla-dash/ap.conf` para fijar interfaz del hotspot:

```
PREFERRED_IFACE=wlp2s0
```

Recarga y habilita servicios:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now pantalla-dash-backend.service
sudo systemctl enable --now pantalla-ap-ensure.service
sudo systemctl enable --now pantalla-bg-generate.timer
sudo systemctl enable --now pantalla-bg-sync.path
sudo systemctl start pantalla-bg-sync.service
```

El hotspot quedará disponible como `Pantalla-Setup` cuando no haya Wi-Fi activa.
La contraseña se guarda en `/var/lib/pantalla/ap_pass`.

Para consultarla:

```bash
sudo cat /var/lib/pantalla/ap_pass
```

## 5. Verificaciones

Comprueba que el backend responde:

```bash
curl -s http://127.0.0.1:8081/api/weather/today
curl -s http://127.0.0.1:8081/api/network/status
curl -s http://127.0.0.1:8081/api/storms/status
```

Desde un cliente conectado al AP visita `http://10.42.0.1:8081/setup` para usar
la mini-web de configuración (escaneo Wi-Fi y conexión con password).

## 6. Troubleshooting

- **Clima 503**: revisa API key de AEMET y conectividad saliente.
- **AP no arranca**: verifica `nmcli` y la interfaz configurada. Consulta
  `journalctl -u pantalla-ap.service`.
- **Hora incorrecta**: comprueba `timedatectl show-timesync` o llama a
  `/api/time/sync_status`.
- **Wi-Fi sin permisos**: confirma que `dashsvc` puede ejecutar `nmcli` sin
  contraseña.

Para actualizar:

```bash
cd /opt/pantalla
sudo -u dashsvc git pull (si clonado) o vuelve a sincronizar archivos
sudo systemctl restart pantalla-dash-backend.service
```

La UI (frontend) debe apuntar a `http://127.0.0.1:8081` y servirse en kiosk
modo pantalla completa.

### Credenciales para Google Calendar

1. Define las credenciales OAuth en `/etc/pantalla-dash/secrets.json` (`client_id`, `client_secret`).
2. Elige **Google** como proveedor en `/#/config` y sigue el flujo de código de dispositivo.
3. El `refresh_token` se guarda automáticamente en `secrets.json` con permisos `600`.

Consulta [google-calendar.md](./google-calendar.md) para un desglose paso a paso de la integración.
