#!/usr/bin/env node
// Cruza lo que registramos con lo que midió la estación, y saca el marcador.
//
//   DMC_USUARIO=... DMC_TOKEN=... node marcar-aciertos.mjs
//   DMC_USUARIO=... DMC_TOKEN=... node marcar-aciertos.mjs --json   deja marcador/resumen.json
//   node marcar-aciertos.mjs --test                                 auto-chequeo, sin red
//
// Lee `marcador/pronosticos.jsonl` y compara tres pronósticos del mismo día contra la
// observación: el nuestro (corregido y ponderado), ECMWF crudo, y el promedio parejo de los
// cuatro modelos. La observación llega con retraso, así que los días recientes no puntúan
// todavía y quedan fuera solos.
//
// Se separa por horizonte a propósito: corregir el sesgo debería ayudar más a un día que a
// siete, y si no se ve esa diferencia es señal de que algo anda mal.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const ARCHIVO = 'marcador/pronosticos.jsonl';
const UMBRAL_LLUVIA = 1.0;   // el mismo que usa exportar-calibracion.mjs
const FUENTES = ['nuestro', 'ecmwf', 'crudo'];

// La aritmética, aparte de la red: así se puede comprobar sin esperar a que la DMC publique.
// `observado` es estación -> { temp: {fecha: {max,min}}, mm: {fecha: mm} }.
export function puntuar(filas, observado) {
  const temp = {}, lluvia = {};
  let puntuadas = 0, sinObs = 0;

  for (const f of filas) {
    const obs = observado.get?.(f.estacion) ?? observado[f.estacion];
    const t = obs?.temp?.[f.objetivo];
    if (!t) { sinObs++; continue; }
    puntuadas++;

    for (const fuente of FUENTES) {
      const p = f[fuente];
      if (!p || p.max == null) continue;
      const e = ((temp[f.lead] ??= {})[fuente] ??= { suma: 0, n: 0 });
      // Error absoluto medio sobre las dos puntas del día.
      e.suma += Math.abs(p.max - t.max) + Math.abs(p.min - t.min);
      e.n += 2;
    }

    const mm = obs.mm?.[f.objetivo];
    if (mm == null) continue;
    const llovio = mm >= UMBRAL_LLUVIA ? 1 : 0;
    const l = (lluvia[f.lead] ??= {});
    // Brier: el cuadrado de la distancia entre lo que dijimos y lo que pasó. Menos es mejor.
    // ECMWF crudo no da probabilidad, así que su mm se toma como un sí/no — que es
    // exactamente lo que muestra un sitio que no calibra.
    ((l.nuestro ??= { suma: 0, n: 0 })).suma += (f.nuestro.lluviaProb - llovio) ** 2;
    l.nuestro.n++;
    ((l.ecmwf ??= { suma: 0, n: 0 })).suma += ((f.ecmwf.mm >= UMBRAL_LLUVIA ? 1 : 0) - llovio) ** 2;
    l.ecmwf.n++;
  }

  const media = e => e && e.n ? e.suma / e.n : null;
  return {
    puntuadas, sinObs,
    temperatura: Object.fromEntries(Object.entries(temp).map(([l, x]) => [l, {
      nuestro: media(x.nuestro), ecmwf: media(x.ecmwf), crudo: media(x.crudo),
      n: x.nuestro?.n ?? 0,
    }])),
    lluvia: Object.fromEntries(Object.entries(lluvia).map(([l, x]) => [l, {
      nuestro: media(x.nuestro), ecmwf: media(x.ecmwf), n: x.nuestro?.n ?? 0,
    }])),
  };
}

// ---------- auto-chequeo ----------
if (process.argv.includes('--test')) {
  const filas = [{
    corrida: '2026-08-25', comuna: 'x', estacion: 1, objetivo: '2026-08-26', lead: 1,
    nuestro: { max: 21, min: 10, lluviaProb: 0.8, acuerdo: 3, de: 4 },
    ecmwf: { max: 23, min: 12, mm: 3 },
    crudo: { max: 22, min: 11 },
  }, {
    // Sin observación: tiene que quedar fuera, no contarse como acierto perfecto.
    corrida: '2026-08-25', comuna: 'x', estacion: 1, objetivo: '2026-08-30', lead: 5,
    nuestro: { max: 5, min: 5, lluviaProb: 0.1, acuerdo: 0, de: 4 },
    ecmwf: { max: 5, min: 5, mm: 0 }, crudo: { max: 5, min: 5 },
  }];
  const obs = { 1: { temp: { '2026-08-26': { max: 20, min: 10 } }, mm: { '2026-08-26': 5 } } };
  const r = puntuar(filas, obs);
  let fallos = 0;
  const chequea = (c, m) => { if (!c) { console.error('  ✗ ' + m); fallos++; } };

  chequea(r.puntuadas === 1 && r.sinObs === 1, 'debe puntuar solo el día con observación');
  chequea(!r.temperatura[5], 'un día sin observación no puede aparecer en el marcador');
  // nuestro: |21-20| + |10-10| = 1 sobre 2 valores -> 0,5
  chequea(r.temperatura[1].nuestro === 0.5, `MAE nuestro debería ser 0.5, es ${r.temperatura[1].nuestro}`);
  // ecmwf: |23-20| + |12-10| = 5 sobre 2 -> 2,5
  chequea(r.temperatura[1].ecmwf === 2.5, `MAE ECMWF debería ser 2.5, es ${r.temperatura[1].ecmwf}`);
  chequea(r.temperatura[1].crudo === 1.5, `MAE crudo debería ser 1.5, es ${r.temperatura[1].crudo}`);
  chequea(r.temperatura[1].n === 2, 'cada día aporta dos valores: máxima y mínima');
  // llovieron 5 mm, o sea llovio=1. Nuestro dijo 0,8 -> (0,8-1)^2 = 0,04
  chequea(Math.abs(r.lluvia[1].nuestro - 0.04) < 1e-9, `Brier nuestro debería ser 0.04, es ${r.lluvia[1].nuestro}`);
  // ECMWF puso 3 mm, o sea sí -> (1-1)^2 = 0
  chequea(r.lluvia[1].ecmwf === 0, `Brier ECMWF debería ser 0, es ${r.lluvia[1].ecmwf}`);

  // Un día seco por debajo del umbral no puede contar como que llovió.
  const seco = puntuar(
    [{ ...filas[0], nuestro: { ...filas[0].nuestro, lluviaProb: 0 }, ecmwf: { ...filas[0].ecmwf, mm: 0.4 } }],
    { 1: { temp: { '2026-08-26': { max: 20, min: 10 } }, mm: { '2026-08-26': 0.5 } } });
  chequea(seco.lluvia[1].nuestro === 0 && seco.lluvia[1].ecmwf === 0,
    '0,5 mm está bajo el umbral de 1 mm: es día seco para los dos');

  console.log(fallos ? `\n${fallos} FALLOS` : 'auto-chequeo ok');
  process.exit(fallos ? 1 : 0);
}

// ---------- corrida de verdad ----------
const soloJSON = process.argv.includes('--json');
if (!existsSync(ARCHIVO)) {
  console.error(`No existe ${ARCHIVO}. Corre antes: node registrar-pronostico.mjs`);
  process.exit(1);
}
const filas = readFileSync(ARCHIVO, 'utf8').trimEnd().split('\n').filter(Boolean).map(l => JSON.parse(l));
if (!filas.length) { console.error('El registro está vacío.'); process.exit(1); }

const objetivos = filas.map(f => f.objetivo).sort();
const rango = [objetivos[0], objetivos.at(-1)];
console.log(`${filas.length} pronósticos registrados, objetivos de ${rango[0]} a ${rango[1]}\n`);

const { bajarRango, lluviaDiaria } = await import('./dmc.mjs');

// Una bajada por estación, no una por fila: varias comunas comparten estación.
const observado = {};
for (const est of new Set(filas.map(f => f.estacion))) {
  const horario = bajarRango(est, rango);
  const dias = {};
  for (const [t, v] of Object.entries(horario)) {
    if (v == null) continue;
    (dias[t.slice(0, 10)] ??= []).push(v);
  }
  observado[est] = {
    // Un día con pocas horas medidas no tiene una máxima creíble.
    temp: Object.fromEntries(Object.entries(dias).filter(([, v]) => v.length >= 20)
      .map(([d, v]) => [d, { max: Math.max(...v), min: Math.min(...v) }])),
    mm: bajarRango(est, rango, lluviaDiaria),
  };
}

const r = puntuar(filas, observado);
if (!r.puntuadas) {
  console.log('Todavía no hay ningún objetivo con observación publicada.');
  console.log(`(${r.sinObs} pronósticos esperando: la DMC publica con retraso, y los días`);
  console.log(' que aún no ocurren obviamente no puntúan.)');
  process.exit(0);
}

console.log(`puntuadas ${r.puntuadas} · esperando observación ${r.sinObs}\n`);
console.log('ERROR ABSOLUTO MEDIO en la máxima y la mínima, por horizonte (°C, menos es mejor)\n');
console.log('  lead   nuestro    ECMWF    crudo     ventaja vs ECMWF');
for (const l of Object.keys(r.temperatura).map(Number).sort((a, b) => a - b)) {
  const { nuestro: a, ecmwf: b, crudo: c } = r.temperatura[l];
  const gana = a != null && b != null ? b - a : null;
  console.log(`  ${String(l).padStart(2)} d  ${a?.toFixed(2).padStart(7) ?? '   —'}`
    + `  ${b?.toFixed(2).padStart(7) ?? '   —'}  ${c?.toFixed(2).padStart(7) ?? '   —'}`
    + `     ${gana == null ? '—' : (gana >= 0 ? '+' : '') + gana.toFixed(2) + '°'}`);
}

const conLluvia = Object.keys(r.lluvia).map(Number).sort((a, b) => a - b);
if (conLluvia.length) {
  const n = r.lluvia[conLluvia[0]].n;
  console.log('\nLLUVIA — puntaje de Brier, por horizonte (menos es mejor)\n');
  console.log('  lead   nuestro    ECMWF     casos');
  for (const l of conLluvia) {
    const x = r.lluvia[l];
    console.log(`  ${String(l).padStart(2)} d  ${x.nuestro.toFixed(3).padStart(7)}`
      + `  ${x.ecmwf.toFixed(3).padStart(7)}  ${String(x.n).padStart(8)}`);
  }
  // Llueve el 4,5 % de los días en Santiago: con pocos casos esto es ruido, y conviene que
  // el propio marcador lo diga en vez de dejar que alguien lea de más.
  if (n < 100) console.log(`\n  Con ${n} casos por horizonte esto todavía no significa nada:`
    + '\n  llueve el 4,5 % de los días, así que hacen falta ~12 meses para juntar 100.');
}

if (soloJSON) {
  writeFileSync('marcador/resumen.json',
    JSON.stringify({ generado: new Date().toISOString().slice(0, 10), ...r }, null, 1) + '\n');
  console.log('\nmarcador/resumen.json escrito');
}
