# QA Checklist

Manual verification steps covering the requested acceptance criteria:

1. **Configuración base sin animaciones**
   - Ajustar la API para devolver `ui.rotation.enabled=false`, `ui.map.cinema.enabled=false` y `ui.map.cinema.panLngDegPerSec=0`.
   - Reiniciar el kiosco y abrir la vista principal.
   - Confirmar que el mapa permanece estático (bearing = 0, sin `rotateTo`/`setBearing` repetitivos) y que no aparecen logs periódicos sobre animaciones.

2. **Movimiento en reposo opcional**
   - Activar `ui.map.idlePan.enabled=true` y fijar `ui.map.idlePan.intervalSec=120`.
   - Verificar que, transcurridos aproximadamente dos minutos, el mapa realiza un pequeño `easeTo` sin rotar ni variar el pitch.

3. **Modo cine habilitado**
   - Establecer `ui.rotation.enabled=true`, `ui.map.cinema.enabled=true` y un valor positivo para `ui.map.cinema.panLngDegPerSec`.
   - Confirmar que no existen bucles infinitos (`requestAnimationFrame`/`setInterval`) dedicados a girar el mapa y que solo se ejecutan animaciones discretas permitidas (p. ej. `idlePan` si está habilitado).

4. **Escenarios de suspensión**
   - Con la pestaña oculta o tras un evento `webglcontextlost`, comprobar que no quedan timers activos y que las animaciones no se reanudan hasta volver al primer plano.

5. **UI de configuración**
   - Abrir `/#/config` y validar que existen controles para los flags `rotation.enabled`, `map.cinema.enabled`, `map.cinema.panLngDegPerSec`, `map.idlePan.enabled` e `intervalSec`.
   - Verificar que los campos dependientes quedan deshabilitados cuando la rotación o el modo cine están desactivados y que los textos de ayuda describen el comportamiento.

Marca cada punto como completado tras ejecutarlo para documentar la revisión manual.
