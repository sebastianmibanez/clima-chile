// Puntos que estamos midiendo. Santiago primero; después la costa.
// Elegidos por interés propio, no por cercanía a estación — `estaciones.mjs` dice
// cuánta verdad observada hay realmente disponible en cada uno.
// En orden de prioridad. Las tres primeras son las que importan para el producto;
// Quinta Normal queda de referencia porque es la estación con el registro más limpio
// (0,0 km de distancia, sin huecos) y sirve de control cuando algo se ve raro.
//
// `region` es lo que la página muestra bajo el nombre de la comuna. Existe desde que hay
// puntos fuera de Santiago: antes estaba escrito a mano en el HTML.
export const UBICACIONES = [
  { nombre: 'Pudahuel',      lat: -33.4400, lon: -70.7900, region: 'Santiago de Chile' },
  { nombre: 'Renca',         lat: -33.4030, lon: -70.7290, region: 'Santiago de Chile' },
  { nombre: 'La Florida',    lat: -33.5520, lon: -70.5850, region: 'Santiago de Chile' },
  { nombre: 'Puente Alto',   lat: -33.6110, lon: -70.5760, region: 'Santiago de Chile' },
  { nombre: 'Colina',        lat: -33.2020, lon: -70.6750, region: 'Santiago de Chile' },
  { nombre: 'Quinta Normal', lat: -33.4450, lon: -70.6828, region: 'Santiago de Chile' },
  { nombre: 'Viña del Mar',  lat: -33.0245, lon: -71.5518, region: 'Región de Valparaíso' },
  { nombre: 'Concón',        lat: -32.9228, lon: -71.5253, region: 'Región de Valparaíso' },
];

// Distancia en km entre dos puntos (haversine).
export function km(aLat, aLon, bLat, bLon) {
  const R = 6371, rad = g => g * Math.PI / 180;
  const dLat = rad(bLat - aLat), dLon = rad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
