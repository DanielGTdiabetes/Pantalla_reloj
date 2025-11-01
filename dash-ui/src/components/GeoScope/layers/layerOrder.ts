/**
 * Orden canónico de capas para GeoScope.
 *
 * Valores más bajos se renderizan antes (debajo) y los valores superiores
 * aparecen sobre el resto. Mantener esta enumeración sincronizada con la
 * documentación y cualquier lógica de orden en el backend evita regresiones.
 */
export enum GeoScopeLayerOrder {
  BaseMap = 0,
  Satellite = 10,
  Radar = 20,
  Ships = 30,
  Aircraft = 40,
  Lightning = 50,
  Hud = 100,
}

export default GeoScopeLayerOrder;
