#!/usr/bin/env node
// ¿Qué estación automática de la DMC hay cerca de cada ubicación que queremos medir?
// El catálogo es abierto; los datos horarios exigen token (ver README).
//
//   node estaciones.mjs
//
// Fuente: Dirección Meteorológica de Chile (DMC).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { UBICACIONES, km } from './ubicaciones.mjs';
import { getJSON } from './http.mjs';

const CATALOGO = 'https://climatologia.meteochile.gob.cl/application/servicios/getEstacionesRedEma';
const CACHE = 'estaciones-dmc.json';

// Más allá de esto la estación ya no representa el clima local del punto.
const CERCA_KM = 12;
const ALTURA_OK = 150;  // metros de diferencia tolerables: sobre eso el sesgo es de altura, no de modelo

// A caché: el catálogo cambia una vez al año, no cada corrida.
if (!existsSync(CACHE)) writeFileSync(CACHE, JSON.stringify(getJSON(CATALOGO)));
// El JSON de la DMC viene doble-codificado: bytes UTF-8 guardados como latin1.
const arregla = s => s.includes('Ã') ? Buffer.from(s, 'latin1').toString('utf8') : s;

const { estaciones, datosEstacion } = JSON.parse(readFileSync(CACHE, 'utf8'));
for (const e of datosEstacion) e.nombreEstacion = arregla(e.nombreEstacion).trim();
console.log(`Catálogo DMC: ${estaciones} estaciones EMA\n`);

const rm = datosEstacion.filter(e => e.region === 13);
console.log(`Región Metropolitana: ${rm.length} estaciones`);
console.log(rm.map(e => `  ${e.codigoNacional} ${e.nombreEstacion} (${e.altura} m)`).join('\n'));

// Altura real de cada punto, para no confundir desnivel con sesgo del modelo.
const elev = getJSON('https://api.open-meteo.com/v1/elevation?'
  + `latitude=${UBICACIONES.map(u => u.lat).join(',')}`
  + `&longitude=${UBICACIONES.map(u => u.lon).join(',')}`);

console.log('\n' + '─'.repeat(84));
console.log('ubicación        estación más cercana            código   dist   est.  punto  Δalt  sirve');
console.log('─'.repeat(84));

for (const [i, u] of UBICACIONES.entries()) {
  const alt = elev.elevation[i];
  const cerca = datosEstacion
    .map(e => ({ ...e, d: km(u.lat, u.lon, +e.latitud, +e.longitud) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);

  cerca.forEach((e, j) => {
    const dAlt = e.altura - alt;
    const sirve = j > 0 ? ''
      : e.d > CERCA_KM ? 'lejos'
      : Math.abs(dAlt) > ALTURA_OK ? `desnivel ${(dAlt * 0.0065).toFixed(1)}°C`
      : 'sí';
    console.log(
      `${(j === 0 ? u.nombre : '').padEnd(16)}`
      + `${e.nombreEstacion.slice(0, 29).padEnd(30)}`
      + `${String(e.codigoNacional).padStart(7)}`
      + `${e.d.toFixed(1).padStart(6)}km`
      + `${String(e.altura).padStart(6)}m`
      + `${String(alt).padStart(6)}m`
      + `${(dAlt > 0 ? '+' : '') + dAlt.toFixed(0)}m`.padStart(7)
      + `  ${sirve}`
    );
  });
  console.log();
}

console.log('Δalt = estación − punto. El gradiente vertical es ~0,65 °C por 100 m, así que un');
console.log('desnivel grande mete un sesgo propio que no tiene nada que ver con el modelo.');
