#!/usr/bin/env node
// Lector del histórico de estaciones automáticas (EMA) de la Dirección Meteorológica de Chile.
//
// Esta es la verdad observada real, la que reemplaza a ERA5-Land como referencia y cierra la
// duda de circularidad (ERA5 es un producto de ECMWF, así que medir ECMWF contra ERA5 lo favorece).
//
//   DMC_USUARIO=tu@correo.cl DMC_TOKEN=xxx node dmc.mjs 330020 2024 7
//
// El token es gratis y se pide en https://climatologia.meteochile.gob.cl (registro con correo).
// El catálogo de estaciones es abierto; los datos exigen usuario + token.
//
// Fuente de datos: Dirección Meteorológica de Chile (DMC). Citar como tal.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { getJSON } from './http.mjs';

const BASE = 'https://climatologia.meteochile.gob.cl/application/servicios/getDatosRecientesEma';
const CACHE = 'datos';

// Estación EMA que le corresponde a cada ubicación, según `estaciones.mjs`.
// Colina usa Lo Pinto y no la estación "Colina (Reg.)" pese a estar más lejos: esa está
// 159 m sobre el pueblo, lo que mete ~1 °C de sesgo puro de altitud.
export const ESTACION = {
  'Quinta Normal': 330020,  // Quinta Normal, Santiago — 0,0 km, Δalt −3 m
  'La Florida':    330122,  // Aguas Andinas, La Florida — 3,5 km, Δalt +32 m
  'Puente Alto':   330122,  // misma estación que La Florida: no son verificables por separado
  'Renca':         330114,  // San Pablo - DASA — 4,7 km, Δalt −4 m
  'Colina':        330118,  // Lo Pinto — 9,1 km, Δalt −84 m
};

function credenciales() {
  const { DMC_USUARIO: usuario, DMC_TOKEN: token } = process.env;
  if (!usuario || !token) {
    console.error('Faltan credenciales. El catálogo de estaciones es abierto, los datos no.\n');
    console.error('  1. Registrarse en https://climatologia.meteochile.gob.cl (gratis)');
    console.error('  2. DMC_USUARIO=tu@correo.cl DMC_TOKEN=xxx node dmc.mjs 330020 2024 7\n');
    process.exit(1);
  }
  return { usuario, token };
}

// Un mes de datos de una estación. La DMC entrega cada 15 min; acá se promedia a la hora
// para poder cruzarlo con el pronóstico, que es horario.
export function bajarMes(codigo, anio, mes) {
  const { usuario, token } = credenciales();
  const nombre = `obs-dmc-${codigo}-${anio}-${String(mes).padStart(2, '0')}`;
  mkdirSync(CACHE, { recursive: true });
  const f = `${CACHE}/${nombre}.json`;
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));

  const url = `${BASE}/${codigo}/${anio}/${String(mes).padStart(2, '0')}`
    + `?usuario=${encodeURIComponent(usuario)}&token=${encodeURIComponent(token)}`;
  const bruto = getJSON(url);
  if (bruto.mensaje) throw new Error(`DMC: ${bruto.mensaje}`);

  // Promedio horario a partir de las lecturas de 15 min.
  const baldes = new Map();
  for (const r of bruto.datos ?? bruto.datosEstacion ?? []) {
    const t = horaISO(r.momento);
    const temp = Number(r.temperatura);
    if (!t || !Number.isFinite(temp)) continue;
    if (!baldes.has(t)) baldes.set(t, []);
    baldes.get(t).push(temp);
  }
  const horario = {};
  for (const [t, xs] of baldes) horario[t] = +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2);

  writeFileSync(f, JSON.stringify(horario));
  return horario;
}

// "2024-07-15 13:45:00" -> "2024-07-15T13:00"  (mismo formato que Open-Meteo con TZ local)
function horaISO(momento) {
  const m = String(momento ?? '').match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:00` : null;
}

// Rango de meses de una estación, aplanado en un solo objeto tiempo -> °C.
export function bajarRango(codigo, [desde, hasta]) {
  const obs = {};
  let a = +desde.slice(0, 4), m = +desde.slice(5, 7);
  const aFin = +hasta.slice(0, 4), mFin = +hasta.slice(5, 7);
  while (a < aFin || (a === aFin && m <= mFin)) {
    try { Object.assign(obs, bajarMes(codigo, a, m)); }
    catch (e) { console.error(`  ${a}-${m}: ${e.message}`); }
    if (++m > 12) { m = 1; a++; }
  }
  return obs;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [codigo, anio, mes] = process.argv.slice(2);
  if (!codigo) {
    console.log('Estaciones configuradas:');
    for (const [n, c] of Object.entries(ESTACION)) console.log(`  ${c}  ${n}`);
    console.log('\nUso: DMC_USUARIO=... DMC_TOKEN=... node dmc.mjs 330020 2024 7');
    process.exit(0);
  }
  const d = bajarMes(+codigo, +anio, +mes);
  const horas = Object.keys(d).sort();
  console.log(`estación ${codigo}, ${anio}-${mes}: ${horas.length} horas`);
  console.log(horas.slice(0, 5).map(t => `  ${t}  ${d[t]}°C`).join('\n'));
}
