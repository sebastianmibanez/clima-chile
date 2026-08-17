// Puntos que estamos midiendo. Santiago primero; capitales regionales después.
// Elegidos por interés propio, no por cercanía a estación — `estaciones.mjs` dice
// cuánta verdad observada hay realmente disponible en cada uno.
export const UBICACIONES = [
  { nombre: 'Quinta Normal', lat: -33.4450, lon: -70.6828 },
  { nombre: 'La Florida',    lat: -33.5520, lon: -70.5850 },
  { nombre: 'Puente Alto',   lat: -33.6110, lon: -70.5760 },
  { nombre: 'Renca',         lat: -33.4030, lon: -70.7290 },
  { nombre: 'Colina',        lat: -33.2020, lon: -70.6750 },
];

// Distancia en km entre dos puntos (haversine).
export function km(aLat, aLon, bLat, bLon) {
  const R = 6371, rad = g => g * Math.PI / 180;
  const dLat = rad(bLat - aLat), dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
