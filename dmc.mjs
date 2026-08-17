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

  // La DMC publica en UTC; el pronóstico lo tenemos en hora de Santiago. Sin convertir,
  // el desfase de 4 h se vería como un sesgo gigante del modelo.
  const enUTC = /utc|gmt/i.test(bruto.timezone ?? 'UTC');

  // Promedio horario a partir de las lecturas de 15 min.
  const registros = bruto.datosEstaciones?.datos ?? [];
  if (!registros.length) throw new Error(`sin registros (${bruto.status ?? 'sin status'})`);

  const baldes = new Map();
  for (const r of registros) {
    const t = horaISO(r.momento, enUTC);
    const temp = numero(r.temperatura);   // viene como "8.0 °C", no como número
    if (!t || temp == null) continue;
    if (!baldes.has(t)) baldes.set(t, []);
    baldes.get(t).push(temp);
  }
  const horario = {};
  for (const [t, xs] of baldes) horario[t] = +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2);

  writeFileSync(f, JSON.stringify(horario));
  return horario;
}

// La DMC entrega los valores con unidad pegada: "8.0 °C", " 0.000 Watt/m2", "0.0 mm".
export function numero(v) {
  const n = parseFloat(String(v ?? '').trim());
  return Number.isFinite(n) ? n : null;
}

// "2024-07-15 13:45:00" -> "2024-07-15T09:00" en hora de Santiago, truncado a la hora.
// Intl hace el cambio de horario de verano solo; Chile alterna UTC−4 y UTC−3.
const aSantiago = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Santiago',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});

function horaISO(momento, enUTC) {
  const m = String(momento ?? '').match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):?(\d{2})?/);
  if (!m) return null;
  if (!enUTC) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:00`;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +(m[5] ?? 0)));
  // 'sv-SE' formatea como "2024-07-15 09" -> se normaliza al formato de Open-Meteo.
  return aSantiago.format(d).replace(' ', 'T').slice(0, 13) + ':00';
}

// El ciclo diario es el chequeo barato de que la zona horaria quedó bien: en Santiago la
// mínima cae cerca de las 7 y la máxima cerca de las 15. Si sale corrido, la conversión falló.
export function cicloDiario(horario) {
  const porHora = new Map();
  for (const [t, v] of Object.entries(horario)) {
    const h = t.slice(11, 13);
    if (!porHora.has(h)) porHora.set(h, []);
    porHora.get(h).push(v);
  }
  return [...porHora.entries()].sort()
    .map(([h, xs]) => [h, xs.reduce((a, b) => a + b, 0) / xs.length]);
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
  console.log(`estación ${codigo}, ${anio}-${mes}: ${horas.length} horas (hora de Santiago)`);
  console.log(horas.slice(0, 3).map(t => `  ${t}  ${d[t]}°C`).join('\n'));

  const ciclo = cicloDiario(d);
  if (!ciclo.length) { console.error('sin datos para el ciclo diario'); process.exit(1); }
  const min = ciclo.reduce((a, b) => b[1] < a[1] ? b : a);
  const max = ciclo.reduce((a, b) => b[1] > a[1] ? b : a);
  console.log('\nciclo diario promedio:');
  console.log(ciclo.map(([h, v]) => `  ${h}h ${v.toFixed(1).padStart(5)}°C`).join('\n'));
  console.log(`\nmínima a las ${min[0]}h, máxima a las ${max[0]}h`);
  const ok = +min[0] >= 5 && +min[0] <= 9 && +max[0] >= 13 && +max[0] <= 18;
  console.log(ok
    ? '→ zona horaria OK (mínima 5-9h, máxima 13-18h como corresponde a Santiago)'
    : '→ OJO: el ciclo está corrido. Revisar la conversión de zona horaria antes de usar estos datos.');
}
