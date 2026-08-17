#!/usr/bin/env node
// ¿Va a llover mañana? — la pregunta que la gente realmente hace.
//
// Mide, por comuna, qué tan bien acierta cada modelo el "llueve / no llueve" del día, y si
// una probabilidad construida con el ACUERDO entre modelos, calibrada contra observación
// local, le gana a cualquier modelo individual.
//
//   DMC_USUARIO=... DMC_TOKEN=... node validar-lluvia.mjs
//   node validar-lluvia.mjs --test
//
// Por qué el acuerdo y no la probabilidad del modelo: Open-Meteo no archiva
// `precipitation_probability` en corridas pasadas (viene todo nulo), solo los mm. Así que la
// probabilidad se construye acá — que además es el producto que queremos mostrar.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { UBICACIONES } from './ubicaciones.mjs';
import { getJSON } from './http.mjs';
import { ESTACION, bajarRango, lluviaDiaria } from './dmc.mjs';

const TZ = 'America/Santiago';
const MODELOS = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'gem_seamless'];
const LEAD = 1;                  // "mañana": pronóstico emitido 24 h antes
const UMBRAL = 1.0;              // mm en el día para considerar que "llovió"
const PERIODO = ['2024-01-01', '2026-07-31'];
const PLIEGUES = 5;              // validación cruzada: la lluvia es rara y un corte único
                                 // dejaba ~12 eventos de muestra, puro ruido
const REJILLA_MM = [0.1, 0.2, 0.5, 1, 2, 3, 5, 8, 12, 20, 30];
const CACHE = 'datos';

// ---------- descarga ----------

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

// Lluvia diaria pronosticada por un modelo: suma de las 24 horas de cada día local.
function bajarLluviaModelo(u, modelo) {
  mkdirSync(CACHE, { recursive: true });
  const f = `${CACHE}/lluvia-${u.nombre.replace(/ /g, '_')}-${modelo}.json.gz`;
  if (existsSync(f)) return JSON.parse(gunzipSync(readFileSync(f)).toString('utf8'));

  const diario = {};
  for (const [d, h] of porAnio(PERIODO[0], PERIODO[1])) {
    const { hourly } = getJSON(
      `https://previous-runs-api.open-meteo.com/v1/forecast?latitude=${u.lat}&longitude=${u.lon}`
      + `&hourly=precipitation_previous_day${LEAD}&start_date=${d}&end_date=${h}`
      + `&timezone=${TZ}&models=${modelo}`);
    hourly.time.forEach((t, i) => {
      const mm = hourly[`precipitation_previous_day${LEAD}`]?.[i];
      if (mm == null) return;
      const dia = t.slice(0, 10);
      diario[dia] = (diario[dia] ?? 0) + mm;
    });
  }
  writeFileSync(f, gzipSync(JSON.stringify(diario)));
  return diario;
}

// ---------- métricas ----------

// Con eventos raros el "acierto global" engaña: decir "nunca llueve" acierta el 90 % en
// Santiago. Por eso se usan POD, FAR y ETS, que es el estándar en verificación de lluvia.
export function contingencia(pares) {   // pares: [{ pron: bool, obs: bool }]
  let h = 0, f = 0, m = 0, c = 0;
  for (const { pron, obs } of pares) {
    if (pron && obs) h++; else if (pron && !obs) f++;
    else if (!pron && obs) m++; else c++;
  }
  const n = h + f + m + c;
  const azar = n ? (h + m) * (h + f) / n : 0;   // aciertos esperables por puro azar
  return {
    n, h, f, m, c,
    pod: h + m ? h / (h + m) : null,            // de los días que llovió, cuántos acertó
    far: h + f ? f / (h + f) : null,            // de los días que dijo lluvia, cuántos falló
    sesgo: h + m ? (h + f) / (h + m) : null,    // >1 = anuncia lluvia de más
    ets: (h + f + m - azar) ? (h - azar) / (h + f + m - azar) : null,
  };
}

const promedio = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const brier = pares => promedio(pares.map(({ p, obs }) => (p - (obs ? 1 : 0)) ** 2));

// ---------- calibración de la probabilidad ----------

// "3 de 4 modelos dicen lluvia" no es 75 % de probabilidad: es lo que históricamente haya
// pasado cuando 3 de 4 dijeron lluvia. Eso se aprende del entrenamiento y es la diferencia
// entre publicar un número honesto y publicar una fracción.
//
// Se fuerza monotonía (regresión isotónica, algoritmo PAVA): que más modelos de acuerdo dé
// MENOS probabilidad no tiene sentido físico, y sin esto pasaba — 2/4 daba 13 % y 3/4 daba 4 %,
// que es ruido de baldes con pocas muestras. Fusionar los baldes que se contradicen resuelve
// el ruido y el tamaño de muestra de una vez.
export function calibrar(pares) {   // pares: [{ k, obs }] con k = cuántos modelos dijeron lluvia
  const por = new Map();
  for (const { k, obs } of pares) {
    if (!por.has(k)) por.set(k, { n: 0, s: 0 });
    const b = por.get(k);
    b.n++; b.s += obs ? 1 : 0;
  }
  const base = pares.length ? promedio(pares.map(p => p.obs ? 1 : 0)) : 0;

  let bloques = [...por.keys()].sort((a, b) => a - b)
    .map(k => ({ ks: [k], n: por.get(k).n, s: por.get(k).s }));
  for (let i = 0; i < bloques.length - 1;) {
    if (bloques[i].s / bloques[i].n > bloques[i + 1].s / bloques[i + 1].n) {
      const j = bloques[i + 1];
      bloques[i] = { ks: [...bloques[i].ks, ...j.ks], n: bloques[i].n + j.n, s: bloques[i].s + j.s };
      bloques.splice(i + 1, 1);
      if (i > 0) i--;               // la fusión puede romper la monotonía hacia atrás
    } else i++;
  }

  const tabla = new Map();
  for (const b of bloques) for (const k of b.ks) tabla.set(k, b.s / b.n);
  return { prob: k => tabla.get(k) ?? base, tabla, base };
}

// Umbral de decisión, elegido SOLO con entrenamiento. Clavarlo en 50 % está mal cuando el
// evento es raro: con lluvia al 5 % de los días, una probabilidad calibrada rara vez supera
// 50 %, así que el pronóstico nunca anunciaría lluvia y el ETS quedaría en cero.
export function mejorUmbral(pares) {   // pares: [{ p, obs }]
  const candidatos = [...new Set(pares.map(x => x.p))].sort((a, b) => a - b);
  let mejor = { u: 0.5, ets: -Infinity };
  for (const u of candidatos) {
    const c = contingencia(pares.map(({ p, obs }) => ({ pron: p >= u, obs })));
    if (c.ets != null && c.ets > mejor.ets) mejor = { u, ets: c.ets };
  }
  return mejor.u;
}

// ---------- auto-chequeo ----------

function autoChequeo() {
  // Pronosticador perfecto y pronosticador que nunca anuncia lluvia.
  const obs = Array.from({ length: 100 }, (_, i) => i < 10);   // llueve 10 % de los días
  const perfecto = contingencia(obs.map(o => ({ pron: o, obs: o })));
  const nunca = contingencia(obs.map(o => ({ pron: false, obs: o })));
  console.assert(perfecto.pod === 1 && perfecto.far === 0 && perfecto.ets === 1,
    `perfecto debía dar POD 1 / FAR 0 / ETS 1, dio ${JSON.stringify(perfecto)}`);
  console.assert(nunca.pod === 0 && nunca.ets === 0,
    `"nunca llueve" debía dar POD 0 y ETS 0, dio ${JSON.stringify(nunca)}`);

  // La calibración debe devolver la frecuencia observada, no la fracción de modelos.
  const pares = [];
  for (let i = 0; i < 100; i++) pares.push({ k: 3, obs: i < 60 });   // k=3 → llovió el 60 %
  const { prob } = calibrar(pares);
  console.assert(Math.abs(prob(3) - 0.6) < 0.01, `k=3 debía calibrar a 0.60, dio ${prob(3)}`);

  // Monotonía: con k=1 al 40 % y k=2 al 10 %, PAVA debe fusionarlos en 25 %, no dejar que baje.
  const noMono = [];
  for (let i = 0; i < 100; i++) noMono.push({ k: 1, obs: i < 40 });
  for (let i = 0; i < 100; i++) noMono.push({ k: 2, obs: i < 10 });
  const t = calibrar(noMono).tabla;
  console.assert(t.get(1) === t.get(2) && Math.abs(t.get(1) - 0.25) < 0.01,
    `PAVA debía fusionar a 0.25, dio ${t.get(1)} y ${t.get(2)}`);
  const ks = [...t.keys()].sort((a, b) => a - b);
  console.assert(ks.every((k, i) => i === 0 || t.get(k) >= t.get(ks[i - 1])),
    'la tabla calibrada quedó no monótona');

  // El umbral debe salir de los datos, no quedarse en 50 % cuando el evento es raro.
  const raro = [];
  for (let i = 0; i < 1000; i++) raro.push({ p: i < 50 ? 0.3 : 0.01, obs: i < 40 });
  console.assert(mejorUmbral(raro) <= 0.3,
    `con evento raro el umbral debía bajar a 0.3, dio ${mejorUmbral(raro)}`);

  // Brier: un pronóstico de 0.6 constante sobre un 60 % real da 0.24.
  const b = brier(pares.map(p => ({ p: 0.6, obs: p.obs })));
  console.assert(Math.abs(b - 0.24) < 0.01, `Brier esperado 0.24, dio ${b}`);
  console.log('auto-chequeo ok: contingencia, calibración y Brier');
}

// ---------- main ----------


function main() {
  console.log(`"¿llueve mañana?" — pronóstico a ${LEAD} día, umbral ${UMBRAL} mm`);
  console.log(`período ${PERIODO.join(' → ')}, validación cruzada de ${PLIEGUES} pliegues`);
  console.log('referencia: estaciones EMA de la DMC\n');

  for (const u of UBICACIONES) {
    let obsDiaria;
    try { obsDiaria = bajarRango(ESTACION[u.nombre], PERIODO, lluviaDiaria); }
    catch (e) { console.log(`\n═══ ${u.nombre} ═══  sin referencia: ${e.message}`); continue; }

    const pron = {};
    for (const m of MODELOS) {
      try { pron[m] = bajarLluviaModelo(u, m); }
      catch (e) { console.log(`  ${m}: ${e.message}`); }
    }
    const ms = Object.keys(pron);

    // Días con observación y con los cuatro modelos disponibles.
    const dias = Object.keys(obsDiaria).sort()
      .filter(d => ms.every(m => pron[m][d] != null));

    const llovio = d => obsDiaria[d] >= UMBRAL;
    const p = x => x == null ? '   —' : x.toFixed(2).padStart(5);
    const lluviosos = dias.filter(llovio).length;

    // Los pliegues se arman por MES, no por día ni al azar: dos días seguidos comparten el
    // mismo sistema frontal, así que un corte aleatorio filtraría información del
    // entrenamiento a la evaluación. Rotar meses mantiene además las cuatro estaciones
    // repartidas en todos los pliegues.
    const meses = [...new Set(dias.map(d => d.slice(0, 7)))].sort();
    const pliegue = d => meses.indexOf(d.slice(0, 7)) % PLIEGUES;

    console.log(`\n═══ ${u.nombre} ═══  ${dias.length} días, ${lluviosos} con lluvia`
      + `  ·  ${PLIEGUES} pliegues por mes`);
    console.log('modelo             umbral    POD    FAR   sesgo    ETS');
    console.log('─'.repeat(56));

    // Cada pliegue ajusta sus propios umbrales y su propia calibración, y predice solo sobre
    // los días que no vio. Se acumulan las predicciones y se puntúa una vez sobre el total.
    const predModelo = Object.fromEntries(ms.map(m => [m, []]));
    const umbralesVistos = Object.fromEntries(ms.map(m => [m, []]));
    const predEns = [], probEns = [], probClim = [], cortes = [];
    let tablaUltima = null;

    for (let f = 0; f < PLIEGUES; f++) {
      const tr = dias.filter(d => pliegue(d) !== f);
      const te = dias.filter(d => pliegue(d) === f);
      if (!te.length || !tr.length) continue;

      const umbralMm = {};
      for (const m of ms) {
        let mejor = { u: UMBRAL, ets: -Infinity };
        for (const cand of REJILLA_MM) {
          const c = contingencia(tr.map(d => ({ pron: pron[m][d] >= cand, obs: llovio(d) })));
          if (c.ets != null && c.ets > mejor.ets) mejor = { u: cand, ets: c.ets };
        }
        umbralMm[m] = mejor.u;
        umbralesVistos[m].push(mejor.u);
        for (const d of te) predModelo[m].push({ pron: pron[m][d] >= mejor.u, obs: llovio(d) });
      }

      const cuentaK = d => ms.filter(m => pron[m][d] >= umbralMm[m]).length;
      const { prob, tabla, base } = calibrar(tr.map(d => ({ k: cuentaK(d), obs: llovio(d) })));
      const corte = mejorUmbral(tr.map(d => ({ p: prob(cuentaK(d)), obs: llovio(d) })));
      cortes.push(corte);
      tablaUltima = tabla;

      for (const d of te) {
        predEns.push({ pron: prob(cuentaK(d)) >= corte, obs: llovio(d) });
        probEns.push({ p: prob(cuentaK(d)), obs: llovio(d) });
        probClim.push({ p: base, obs: llovio(d) });   // climatología del entrenamiento
      }
    }

    const mediana = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    for (const m of ms) {
      const c = contingencia(predModelo[m]);
      console.log(`${m.padEnd(17)}${(mediana(umbralesVistos[m]) + 'mm').padStart(7)}  `
        + `${p(c.pod)}  ${p(c.far)}  ${p(c.sesgo)}  ${p(c.ets)}`);
    }

    const cEns = contingencia(predEns);
    const bs = brier(probEns), bsClim = brier(probClim);
    const bss = bsClim ? 1 - bs / bsClim : null;
    console.log('─'.repeat(56));
    console.log(`${'CONSENSO calibrado'.padEnd(17)}`
      + `${((mediana(cortes) * 100).toFixed(0) + '%').padStart(7)}  `
      + `${p(cEns.pod)}  ${p(cEns.far)}  ${p(cEns.sesgo)}  ${p(cEns.ets)}`);

    console.log(`\n  probabilidad calibrada (último pliegue):  `
      + [...tablaUltima.entries()].sort((a, b) => a[0] - b[0])
        .map(([k, v]) => `${k}/${ms.length}→${(v * 100).toFixed(0)}%`).join('  '));
    console.log(`  Brier ${bs.toFixed(4)}  vs climatología ${bsClim.toFixed(4)}`
      + `  →  BSS ${bss == null ? '—' : (bss * 100).toFixed(1) + '%'}`
      + `   (sobre ${cEns.h + cEns.m} días de lluvia)`);
  }

  console.log('\nPOD: de los días que llovió, qué fracción anunció. Más alto mejor.');
  console.log('FAR: de los días que anunció lluvia, qué fracción falló. Más bajo mejor.');
  console.log('sesgo: >1 anuncia lluvia de más, <1 de menos. ETS: pericia sobre el azar, 1 es perfecto.');
  console.log('BSS: cuánto mejor que decir siempre "la probabilidad histórica". 0 % = no aporta nada.');
}

if (process.argv.includes('--test')) autoChequeo();
else main();
