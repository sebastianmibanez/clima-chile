#!/usr/bin/env node
// Convierte todo lo aprendido del archivo histórico en UN archivo estático.
//
//   DMC_USUARIO=... DMC_TOKEN=... node exportar-calibracion.mjs
//
// Sale `sitio/calibracion.json`: las tablas de corrección de temperatura y de probabilidad de
// lluvia por comuna. El sitio lo sirve como archivo estático y el navegador lo aplica sobre el
// pronóstico del día. Sin base de datos y sin backend.
//
// Se corre a mano cada semana o cada mes desde la máquina local, con el archivo histórico ya
// descargado en datos/. Es la única pieza que necesita las credenciales de la DMC.
//
// A diferencia de los validadores, acá se ajusta con TODOS los datos disponibles: la validación
// cruzada ya respondió si generaliza, así que en producción no se desperdicia historial.

import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { UBICACIONES } from './ubicaciones.mjs';
import { ESTACION, bajarRango, lluviaDiaria } from './dmc.mjs';
import { bajarPronosticos, unir } from './validar-sesgo.mjs';
import { bajarLluviaModelo, calibrar, contingencia, mejorUmbral } from './validar-lluvia.mjs';

const MODELOS = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'gem_seamless'];
const LEADS = [1, 2, 3, 4, 5, 6, 7];
const PERIODO = ['2024-01-01', '2026-07-31'];
const UMBRAL_LLUVIA = 1.0;
const REJILLA_MM = [0.1, 0.2, 0.5, 1, 2, 3, 5, 8, 12, 20, 30];
const MIN_MUESTRAS = 10;
const SALIDA = 'sitio';

const promedio = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

// El sesgo por (mes, hora) queda como un arreglo plano de 12×24. Indexar por posición en vez
// de por clave achica el JSON a la mitad, y el navegador lo lee con una multiplicación.
const idx = (mes, hora) => (mes - 1) * 24 + hora;

function tablaSesgo(pares) {
  const baldes = new Map(), porHora = new Map(), todo = [];
  const agregar = (mapa, clave, e) => {
    if (!mapa.has(clave)) mapa.set(clave, []);
    mapa.get(clave).push(e);
  };
  for (const { t, fc, obs } of pares) {
    const e = fc - obs;
    agregar(baldes, idx(+t.slice(5, 7), +t.slice(11, 13)), e);
    agregar(porHora, +t.slice(11, 13), e);
    todo.push(e);
  }
  const global = todo.length ? promedio(todo) : 0;

  // Misma cadena de respaldo que usa el validador: balde exacto → misma hora → global.
  const tabla = new Array(288);
  for (let i = 0; i < 288; i++) {
    const b = baldes.get(i);
    if (b && b.length >= MIN_MUESTRAS) { tabla[i] = +promedio(b).toFixed(2); continue; }
    const h = porHora.get(i % 24);
    tabla[i] = +(h && h.length >= MIN_MUESTRAS ? promedio(h) : global).toFixed(2);
  }
  return tabla;
}

// ---------- main ----------

const salida = {
  generado: new Date().toISOString().slice(0, 10),
  periodo: PERIODO,
  modelos: MODELOS,
  umbralLluviaMm: UMBRAL_LLUVIA,
  nota: 'Sesgos en °C a restar del pronóstico. Índice = (mes-1)*24 + hora local.',
  fuentes: {
    modelos: 'Open-Meteo (CC BY 4.0)',
    observacion: 'Dirección Meteorológica de Chile — estaciones automáticas EMA',
  },
  comunas: {},
};

for (const u of UBICACIONES) {
  const codigo = ESTACION[u.nombre];
  process.stdout.write(`${u.nombre.padEnd(16)} `);

  const obsHoraria = bajarRango(codigo, PERIODO);
  const obsLluvia = bajarRango(codigo, PERIODO, lluviaDiaria);

  const comuna = {
    lat: u.lat, lon: u.lon, estacion: codigo,
    horasObservadas: Object.keys(obsHoraria).length,
    diasObservados: Object.keys(obsLluvia).length,
    sesgo: {}, pesos: {}, lluvia: { umbralMm: {}, prob: null },
  };

  // --- temperatura: una tabla de sesgo por modelo y horizonte, más el peso del ensamble ---
  const series = {};
  for (const m of MODELOS) {
    try { series[m] = bajarPronosticos(u, m); } catch { /* modelo no disponible */ }
  }
  for (const m of Object.keys(series)) {
    comuna.sesgo[m] = {};
    comuna.pesos[m] = {};
    for (const lead of LEADS) {
      const pares = unir(series[m], obsHoraria, PERIODO, lead);
      if (pares.length < 500) continue;
      const tabla = tablaSesgo(pares);
      comuna.sesgo[m][lead] = tabla;
      // Peso del ensamble = 1/MSE una vez corregido. Se guarda normalizado para que el
      // navegador solo tenga que multiplicar y sumar.
      const mse = promedio(pares.map(({ t, fc, obs }) =>
        (fc - tabla[idx(+t.slice(5, 7), +t.slice(11, 13))] - obs) ** 2));
      comuna.pesos[m][lead] = +(1 / Math.max(mse, 1e-6)).toFixed(4);
    }
  }
  for (const lead of LEADS) {
    const total = Object.values(comuna.pesos).reduce((a, p) => a + (p[lead] ?? 0), 0);
    if (total) for (const p of Object.values(comuna.pesos)) {
      if (p[lead] != null) p[lead] = +(p[lead] / total).toFixed(4);
    }
  }

  // --- lluvia: umbral de mm por modelo y tabla de probabilidad por acuerdo ---
  const pron = {};
  for (const m of MODELOS) {
    try { pron[m] = bajarLluviaModelo(u, m); } catch { /* sin datos */ }
  }
  const ms = Object.keys(pron);
  const dias = Object.keys(obsLluvia).sort().filter(d => ms.every(m => pron[m][d] != null));
  const llovio = d => obsLluvia[d] >= UMBRAL_LLUVIA;

  for (const m of ms) {
    let mejor = { u: UMBRAL_LLUVIA, ets: -Infinity };
    for (const cand of REJILLA_MM) {
      const c = contingencia(dias.map(d => ({ pron: pron[m][d] >= cand, obs: llovio(d) })));
      if (c.ets != null && c.ets > mejor.ets) mejor = { u: cand, ets: c.ets };
    }
    comuna.lluvia.umbralMm[m] = mejor.u;
  }
  const cuentaK = d => ms.filter(m => pron[m][d] >= comuna.lluvia.umbralMm[m]).length;
  const { tabla, base } = calibrar(dias.map(d => ({ k: cuentaK(d), obs: llovio(d) })));
  comuna.lluvia.prob = Object.fromEntries(
    [...tabla.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => [k, +v.toFixed(3)]));
  comuna.lluvia.climatologia = +base.toFixed(3);
  comuna.lluvia.corte = +mejorUmbral(dias.map(d =>
    ({ p: tabla.get(cuentaK(d)) ?? base, obs: llovio(d) }))).toFixed(3);
  comuna.lluvia.diasConLluvia = dias.filter(llovio).length;

  salida.comunas[u.nombre] = comuna;
  console.log(`\n  ${u.nombre.padEnd(15)} ${comuna.horasObservadas} h observadas, `
    + `${comuna.lluvia.diasConLluvia} días de lluvia`);
}

// Un archivo por comuna: el navegador solo necesita la que el usuario está mirando.
// Todo junto son 65 KB comprimidos; por comuna son ~13 KB.
const kb = n => (n / 1024).toFixed(1) + ' KB';
const slug = n => n.toLowerCase().replace(/ /g, '-').normalize('NFD').replace(/[̀-ͯ]/g, '');

mkdirSync(`${SALIDA}/calibracion`, { recursive: true });
const { comunas, ...meta } = salida;

console.log();
for (const [nombre, comuna] of Object.entries(comunas)) {
  const json = JSON.stringify({ ...meta, comuna: nombre, ...comuna });
  writeFileSync(`${SALIDA}/calibracion/${slug(nombre)}.json`, json);
  console.log(`  calibracion/${slug(nombre)}.json`.padEnd(40)
    + `${kb(json.length).padStart(9)}  (${kb(gzipSync(json).length)} gz)`);
}

// Índice liviano para poblar el selector de comuna sin bajar ninguna tabla.
const indice = {
  ...meta,
  comunas: Object.entries(comunas).map(([nombre, c]) => ({
    nombre, slug: slug(nombre), lat: c.lat, lon: c.lon, estacion: c.estacion,
  })),
};
writeFileSync(`${SALIDA}/calibracion/indice.json`, JSON.stringify(indice));
console.log(`  calibracion/indice.json`.padEnd(40)
  + `${kb(JSON.stringify(indice).length).padStart(9)}`);
console.log('\nEso es todo lo que el sitio necesita servir además del HTML.');
