export type WeatherKind =
  | 'clear'
  | 'partly_cloudy'
  | 'cloudy'
  | 'fog'
  | 'rain'
  | 'snow'
  | 'sleet'
  | 'thunderstorm'
  | 'unknown';

export const METEOBLUE_SYMBOL_TO_KIND: Record<number, WeatherKind> = {
  1: 'clear',
  2: 'clear',
  3: 'clear',
  4: 'clear',
  5: 'clear',
  6: 'partly_cloudy',
  7: 'partly_cloudy',
  8: 'cloudy',
  9: 'rain',
  10: 'rain',
  11: 'thunderstorm',
  12: 'thunderstorm',
  13: 'sleet',
  14: 'sleet',
  15: 'snow',
  16: 'snow',
  17: 'rain',
  18: 'rain',
  19: 'thunderstorm',
  20: 'thunderstorm',
  21: 'sleet',
  22: 'sleet',
  23: 'snow',
  24: 'snow',
  25: 'fog',
  26: 'fog',
  27: 'clear',
  28: 'partly_cloudy',
  29: 'rain',
  30: 'sleet',
  31: 'snow',
  32: 'thunderstorm',
  33: 'cloudy',
  34: 'rain',
  35: 'snow',
};

export const WEATHER_KIND_LABEL: Record<WeatherKind, string> = {
  clear: 'Despejado',
  partly_cloudy: 'Parcialmente nublado',
  cloudy: 'Nublado',
  fog: 'Niebla',
  rain: 'Lluvia',
  snow: 'Nieve',
  sleet: 'Aguanieve',
  thunderstorm: 'Tormenta',
  unknown: 'Sin datos',
};
