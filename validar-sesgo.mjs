#!/usr/bin/env node
// ¿Corregir el sesgo de los modelos mejora el pronóstico en Santiago?
//
// Baja pronósticos archivados (Open-Meteo Previous Runs, desde 2024) para cada ubicación,
// ajusta la corrección de sesgo SOLO con datos de entrenamiento, y la evalúa contra datos
// que nunca vio. Prueba además si el promedio de los modelos corregidos le gana al mejor
// modelo individual.
//
//   node validar-sesgo.mjs          validación completa
//   node validar-sesgo.mjs --test   auto-chequeo con sesgo sintético
//
// La referencia por defecto es ERA5-Land. OJO: ERA5 es un producto de ECMWF, así que el
// desempeño de ECMWF sale inflado. Con token de la DMC, usar `--ref=dmc` (ver dmc.mjs).

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { UBICACIONES } from './ubicaciones.mjs';
import { getJSON } from './http.mjs';

const TZ = 'America/Santiago';
const MODELOS = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'gem_seamless'];
const LEADS = [1, 3, 7];              // días de anticipación que reportamos
const TODOS_LEADS = [1, 2, 3, 4, 5, 6, 7];

// Corte temporal, no aleatorio: entrenar con el pasado, evaluar con el futuro.
const ENTRENA = ['2024-01-01', '2025-12-31'];
const EVALUA = ['2026-01-01', '2026-07-31'];  // ERA5 va ~5 días atrasado

const MIN_MUESTRAS = 10;  // bajo esto el balde no es confiable y se cae al fallback
const CACHE = 'datos';

// ---------- descarga (a caché: son 2,5 años por ubicación y modelo) ----------

function cacheado(nombre, fn) {
  mkdirSync(CACHE, { recursive: true });
  const f = `${CACHE}/${nombre}.json`;
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const d = fn();
  writeFileSync(f, JSON.stringify(d));
  return d;
}

// La API limita el rango por request; se parte por año.
function porAnio(desde, hasta) {
  const tramos = [];
  for (let a = +desde.slice(0, 4); a <= +hasta.slice(0, 4); a++) {
    tramos.push([
      a === +desde.slice(0, 4) ? desde : `${a}-01-01`,
      a === +hasta.slice(0, 4) ? hasta : `${a}-12-31`,
    ]);
  }
  return tramos;
}

function bajarPronosticos(u, modelo) {
  return cacheado(`fc-${u.nombre.replace(/ /g, '_')}-${modelo}`, () => {
    const vars = TODOS_LEADS.map(d => `temperature_2m_previous_day${d}`).join(',');
    const serie = {};  // tiempo ISO -> { lead: °C }
    for (const [d, h] of porAnio(ENTRENA[0], EVALUA[1])) {
      const { hourly } = getJSON(
        `https://previous-runs-api.open-meteo.com/v1/forecast?latitude=${u.lat}&longitude=${u.lon}`
        + `&hourly=${vars}&start_date=${d}&end_date=${h}&timezone=${TZ}&models=${modelo}`);
      hourly.time.forEach((t, i) => {
        serie[t] ??= {};
        for (const lead of TODOS_LEADS) {
          serie[t][lead] = hourly[`temperature_2m_previous_day${lead}`]?.[i] ?? null;
        }
      });
    }
    return serie;
  });
}

function bajarReferencia(u) {
  return cacheado(`obs-era5-${u.nombre.replace(/ /g, '_')}`, () => {
    const obs = {};
    for (const [d, h] of porAnio(ENTRENA[0], EVALUA[1])) {
      const { hourly } = getJSON(
        `https://archive-api.open-meteo.com/v1/archive?latitude=${u.lat}&longitude=${u.lon}`
        + `&hourly=temperature_2m&start_date=${d}&end_date=${h}&timezone=${TZ}&models=era5_land`);
      hourly.time.forEach((t, i) => { obs[t] = hourly.temperature_2m[i]; });
    }
    return obs;
  });
}

// ---------- corrección ----------

// El sesgo no es constante: depende del mes (estación del año) y de la hora (inversión nocturna).
const balde = t => `${t.slice(5, 7)}-${t.slice(11, 13)}`;   // MM-HH
const baldeHora = t => t.slice(11, 13);                      // HH

const promedio = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

// Ajusta el sesgo medio por balde. Devuelve una función que corrige un pronóstico.
export function ajustarCorreccion(pares) {  // pares: [{ t, fc, obs }]
  const por = new Map(), porHora = new Map(), todo = [];
  const agregar = (mapa, clave, err) => {
    if (!mapa.has(clave)) mapa.set(clave, []);
    mapa.get(clave).push(err);
  };
  for (const { t, fc, obs } of pares) {
    const e = fc - obs;
    agregar(por, balde(t), e);
    agregar(porHora, baldeHora(t), e);
    todo.push(e);
  }
  const global = todo.length ? promedio(todo) : 0;
  return (t, fc) => {
    const b = por.get(balde(t));
    if (b && b.length >= MIN_MUESTRAS) return fc - promedio(b);
    const h = porHora.get(baldeHora(t));
    if (h && h.length >= MIN_MUESTRAS) return fc - promedio(h);
    return fc - global;
  };
}

const mae = pares => promedio(pares.map(({ fc, obs }) => Math.abs(fc - obs)));

function unir(serie, obs, [desde, hasta], lead) {
  const pares = [];
  for (const [t, fila] of Object.entries(serie)) {
    if (t < desde || t > `${hasta}T23:59`) continue;
    const fc = fila[lead], o = obs[t];
    if (fc == null || o == null) continue;
    pares.push({ t, fc, obs: o });
  }
  return pares;
}

// ---------- auto-chequeo ----------

function autoChequeo() {
  // Sesgo sintético conocido: +5 °C a medianoche, 0 °C a mediodía. La corrección debe borrarlo.
  const pares = [];
  for (let dia = 1; dia <= 28; dia++) {
    for (const hh of ['00', '12']) {
      const t = `2024-07-${String(dia).padStart(2, '0')}T${hh}:00`;
      const obs = 10, sesgo = hh === '00' ? 5 : 0;
      pares.push({ t, fc: obs + sesgo, obs });
    }
  }
  const corrige = ajustarCorreccion(pares);
  const antes = mae(pares);
  const despues = promedio(pares.map(({ t, fc, obs }) => Math.abs(corrige(t, fc) - obs)));
  console.assert(Math.abs(antes - 2.5) < 0.01, `MAE previo esperado 2.5, dio ${antes}`);
  console.assert(despues < 0.01, `la corrección debía anular el sesgo, quedó ${despues}`);

  // Sin sesgo que corregir, la corrección no debe empeorar nada.
  const limpio = pares.map(({ t, obs }) => ({ t, fc: obs, obs }));
  const c2 = ajustarCorreccion(limpio);
  const d2 = promedio(limpio.map(({ t, fc, obs }) => Math.abs(c2(t, fc) - obs)));
  console.assert(d2 < 0.01, `sobre datos limpios la corrección metió error: ${d2}`);

  console.log(`auto-chequeo ok: MAE ${antes.toFixed(2)} -> ${despues.toFixed(2)}, limpio ${d2.toFixed(2)}`);
}

// ---------- main ----------

function main() {
  console.log(`entrena ${ENTRENA.join(' → ')}  |  evalúa ${EVALUA.join(' → ')}`);
  console.log(`referencia: ERA5-Land\n`);

  for (const u of UBICACIONES) {
    const obs = bajarReferencia(u);
    const series = {};
    for (const m of MODELOS) {
      try { series[m] = bajarPronosticos(u, m); }
      catch (e) { console.log(`  ${m}: no disponible (${e.message})`); }
    }

    console.log(`\n═══ ${u.nombre} ═══`);
    console.log('                    ' + LEADS.map(l => `${l}d`.padStart(15)).join(''));
    console.log('modelo               ' + LEADS.map(() => '  cruda  corr').join('       '));
    console.log('─'.repeat(20 + LEADS.length * 15));

    const corregidos = {};  // lead -> modelo -> Map(t -> °C corregido)
    for (const m of Object.keys(series)) {
      const celdas = [];
      for (const lead of LEADS) {
        const tr = unir(series[m], obs, ENTRENA, lead);
        const te = unir(series[m], obs, EVALUA, lead);
        if (tr.length < 100 || te.length < 100) { celdas.push('       —      '); continue; }
        const corrige = ajustarCorreccion(tr);
        const cruda = mae(te);
        const corr = promedio(te.map(({ t, fc, obs }) => Math.abs(corrige(t, fc) - obs)));
        celdas.push(`  ${cruda.toFixed(2)}  ${corr.toFixed(2)}`.padStart(15));

        (corregidos[lead] ??= {})[m] = new Map(te.map(({ t, fc, obs }) =>
          [t, { fc: corrige(t, fc), obs }]));
      }
      console.log(m.padEnd(20) + celdas.join(''));
    }

    // ¿El promedio de los modelos corregidos le gana al mejor individual?
    const celdas = [];
    for (const lead of LEADS) {
      const porModelo = corregidos[lead] ?? {};
      const ms = Object.keys(porModelo);
      if (ms.length < 2) { celdas.push('       —      '); continue; }
      const tiempos = [...porModelo[ms[0]].keys()].filter(t => ms.every(m => porModelo[m].has(t)));
      const ens = tiempos.map(t => ({
        fc: promedio(ms.map(m => porModelo[m].get(t).fc)),
        obs: porModelo[ms[0]].get(t).obs,
      }));
      const mejorSolo = Math.min(...ms.map(m =>
        promedio([...porModelo[m].values()].map(({ fc, obs }) => Math.abs(fc - obs)))));
      celdas.push(`  ${mae(ens).toFixed(2)}  ${mejorSolo.toFixed(2)}`.padStart(15));
    }
    console.log('─'.repeat(20 + LEADS.length * 15));
    console.log('ENSAMBLE / mejor solo'.padEnd(20) + celdas.join(''));
  }

  console.log('\nMAE en °C. "cruda" = modelo sin tocar, "corr" = con corrección de sesgo.');
  console.log('\nOJO: la referencia es ERA5-Land (reanálisis ~9 km), no observación de estación,');
  console.log('y ERA5 es un producto de ECMWF. El desempeño de ECMWF sale probablemente inflado.');
  console.log('Para cerrar esto hace falta el histórico EMA de la DMC (ver dmc.mjs).');
}

if (process.argv.includes('--test')) autoChequeo();
else main();
