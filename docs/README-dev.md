## Pruebas manuales (desarrollo)

Usa el backend en `:8081`.

- Schema:
  - `curl -sS :8081/api/config/schema | jq '.secrets | map(.key)'` => EXACTAMENTE ["aemet_api_key","opensky_client_id","opensky_client_secret","aistream_api_key"].

- AEMET:
  - Guardar: `curl -sS -X POST :8081/api/config/secret/aemet_api_key -H 'content-type: application/json' -d '{"api_key":"..."}' -i`
  - Probar: `curl -sS :8081/api/aemet/test | jq .` => `{ok:true}` con clave válida.

- OpenSky:
  - Guardar: `curl -sS -X POST :8081/api/config/secret/opensky_client_id --data 'value=ID'`
  - Guardar: `curl -sS -X POST :8081/api/config/secret/opensky_client_secret --data 'value=SECRET'`
  - Probar: `curl -sS :8081/api/opensky/status | jq '{token_valid, expires_in}'` => `token_valid:true` cuando correcto.

- AISstream:
  - Configurar provider `aisstream` en `/config` y guardar API key con `/api/config/secret/aistream_api_key`.
  - Health: `curl -sS :8081/api/health/full | jq '.integrations.ships'` muestra `last_fetch_ok` o `last_error` legible.

- UI /config:
  - Sin duplicados: sección única “Aviones (OpenSky)”. AEMET con campo oculto + “Probar AEMET”. AIS con selector proveedor y secreto enmascarado.
  - Estilos cambian al momento; velocidades (lenta<media<rápida) se notan; “pausar con overlays” no mueve la cámara.
  - Arranque: el mapa se mueve desde el principio con la velocidad configurada.

Script rápido: `bash scripts/dev/quickcheck.sh`


