# Instalación de Chromium - Guía de Resolución de Problemas

## Problema: Paquete transicional a Snap

En Ubuntu 24.04 (Noble) y versiones posteriores, el paquete `chromium-browser` es un **paquete transicional** que solo instala el snap de Chromium. Esto causa problemas porque:

1. El snap tiene restricciones de permisos que pueden causar errores como `Permission denied` al crear `SingletonLock`
2. El snap puede tener problemas con namespaces de montaje
3. El snap no es compatible con algunos entornos de kiosk

## Solución Implementada

El script de instalación (`install.sh`) ahora:

1. **Detecta paquetes transicionales**: Verifica si `chromium-browser` o `chromium` apuntan a snap
2. **Desinstala paquetes transicionales**: Si detecta que apuntan a snap, los desinstala automáticamente
3. **Instala Chromium real**: Intenta instalar Chromium desde:
   - Repositorios estándar de Ubuntu (`chromium`)
   - PPA de Chromium (`ppa:saiarcot895/chromium-beta`) si los repositorios estándar no funcionan
4. **Arregla permisos**: Configura correctamente los permisos del perfil de Chromium
5. **Limpia archivos de bloqueo**: Elimina archivos residuales que pueden causar problemas

## Verificación Manual

Para verificar si Chromium está instalado correctamente (no desde snap):

```bash
# Verificar la ruta real del binario
readlink -f $(which chromium-browser 2>/dev/null || which chromium 2>/dev/null)

# Si contiene "/snap/", es desde snap (no recomendado)
# Si no contiene "/snap/", es una instalación real (correcto)
```

## Configuración Automática

El script de instalación configura automáticamente:

- `CHROMIUM_BIN_OVERRIDE` en `/var/lib/pantalla-reloj/state/kiosk.env`
- Permisos correctos en `/home/<usuario>/.local/share/pantalla-reloj/chromium`
- Permisos correctos en `/home/<usuario>/.cache/pantalla-reloj/chromium`

## Resolución de Problemas

### Error: "Permission denied" al crear SingletonLock

**Causa**: Permisos incorrectos en el directorio del perfil o archivos de bloqueo residuales.

**Solución**:
```bash
# Arreglar permisos
sudo chown -R <usuario>:<usuario> /home/<usuario>/.local/share/pantalla-reloj/chromium
sudo chmod -R u+rwX /home/<usuario>/.local/share/pantalla-reloj/chromium

# Limpiar archivos de bloqueo
find /home/<usuario>/.local/share/pantalla-reloj/chromium -type f \( -name "SingletonLock" -o -name "SingletonCookie" -o -name "SingletonSocket" -o -name "LOCK" \) -delete
```

### Error: Chromium apunta a snap

**Causa**: El paquete `chromium-browser` es transicional a snap.

**Solución**:
```bash
# Desinstalar chromium-browser transicional
sudo apt remove -y chromium-browser

# Instalar Chromium real
sudo apt update
sudo apt install -y chromium

# Si no funciona, usar PPA
sudo add-apt-repository -y ppa:saiarcot895/chromium-beta
sudo apt update
sudo apt install -y chromium
```

### Error: "cannot change mount namespace" (snap)

**Causa**: Problemas con snapd intentando montar directorios del host.

**Solución**: Instalar Chromium real (no snap) siguiendo los pasos anteriores.

## Scripts de Reparación

Si encuentras problemas después de la instalación, puedes usar:

- `scripts/fix_chromium_simple.sh` - Script simplificado para arreglar Chromium y permisos
- `scripts/fix_chromium_real_install.sh` - Script completo con más opciones

Ejecutar:
```bash
sudo bash scripts/fix_chromium_simple.sh <usuario>
```

## Notas

- El script de instalación ahora evita automáticamente los paquetes transicionales a snap
- Los permisos se arreglan automáticamente durante la instalación
- Los archivos de bloqueo se limpian automáticamente al iniciar el servicio
- Si Chromium no está disponible, el servicio kiosk no se habilitará (pero no fallará la instalación)

