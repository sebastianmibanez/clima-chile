#!/usr/bin/env node
// ¿Corregir el sesgo de los modelos mejora el pronóstico en Santiago?
// Baja el archivo histórico de pronósticos (Open-Meteo Previous Runs) + ERA5-Land como
// referencia, ajusta la corrección SOLO con datos de entrenamiento y la evalúa en datos
// que nunca vio. Sin dependencias.
//
//   node validar-sesgo.mjs          corre la validación
//   node validar-sesgo.mjs --test   auto-chequeo con datos sintéticos

const LAT = -33.445, LON = -70.683;   // Quinta Normal, Santiago. EMA de la DMC, 520 m.
const TZ = 'America/Santiago';
const MODELOS = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'gem_seamless'];
const LEADS = [1, 2, 3, 4, 5, 6, 7];  // días de anticipación

// Corte temporal, no aleatorio: entrenar con el pasado, evaluar con el futuro.
const ENTRENA = ['2024-01-01', '2025-12-31'];
const EVALUA = ['2026-01-01', '2026-07-31'];  // ERA5 va ~5 días atrasado

const MIN_MUESTRAS = 10;  // bajo esto, el balde no es confiable y se cae al fallback

// ---------- descarga ----------

async function getJSON(url) {
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`${r.status} ${j.reason ?? ''}`.trim());
  return j;
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

async function bajarPronosticos(modelo, desde, hasta) {
  const vars = LEADS.map(d => `temperature_2m_previous_day${d}`).join(',');
  const serie = new Map();  // tiempo ISO -> { lead: °C }
  for (const [d, h] of porAnio(desde, hasta)) {
    const u = `https://previous-runs-api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}`
      + `&hourly=${vars}&start_date=${d}&end_date=${h}&timezone=${TZ}&models=${modelo}`;
    const { hourly } = await getJSON(u);
    hourly.time.forEach((t, i) => {
      const fila = serie.get(t) ?? {};
      for (const lead of LEADS) fila[lead] = hourly[`temperature_2m_previous_day${lead}`]?.[i] ?? null;
      serie.set(t, fila);
    });
  }
  return serie;
}

async function bajarReferencia(desde, hasta) {
  const obs = new Map();  // tiempo ISO -> °C
  for (const [d, h] of porAnio(desde, hasta)) {
    const u = `https://archive-api.open-meteo.com/v1/archive?latitude=${LAT}&longitude=${LON}`
      + `&hourly=temperature_2m&start_date=${d}&end_date=${h}&timezone=${TZ}&models=era5_land`;
    const { hourly } = await getJSON(u);
    hourly.time.forEach((t, i) => obs.set(t, hourly.temperature_2m[i]));
  }
  return obs;
}

// ---------- corrección ----------

// El sesgo no es constante: depende del mes (estación) y de la hora (inversión nocturna).
const balde = t => `${t.slice(5, 7)}-${t.slice(11, 13)}`;   // MM-HH
const baldeHora = t => t.slice(11, 13);                      // HH

function promedio(xs) { return xs.reduce((a, b) => a + b, 0) / xs.length; }

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
  for (const [t, fila] of serie) {
    if (t < desde || t > `${hasta}T23:59`) continue;
    const fc = fila[lead], o = obs.get(t);
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
  console.log(`auto-chequeo ok: MAE ${antes.toFixed(2)} -> ${despues.toFixed(2)}`);
}

// ---------- main ----------

async function main() {
  console.log(`Quinta Normal (${LAT}, ${LON})`);
  console.log(`entrena ${ENTRENA.join(' → ')} | evalúa ${EVALUA.join(' → ')}\n`);

  const obs = await bajarReferencia(ENTRENA[0], EVALUA[1]);
  console.log(`referencia ERA5-Land: ${obs.size} horas\n`);

  console.log('modelo            lead     n   MAE cruda  MAE corregida   mejora   sesgo medio');
  console.log('─'.repeat(80));

  for (const modelo of MODELOS) {
    let serie;
    try {
      serie = await bajarPronosticos(modelo, ENTRENA[0], EVALUA[1]);
    } catch (e) {
      console.log(`${modelo.padEnd(17)} no disponible (${e.message})`);
      continue;
    }
    for (const lead of LEADS) {
      const tr = unir(serie, obs, ENTRENA, lead);
      const te = unir(serie, obs, EVALUA, lead);
      if (tr.length < 100 || te.length < 100) continue;

      const corrige = ajustarCorreccion(tr);
      const cruda = mae(te);
      const corregida = promedio(te.map(({ t, fc, obs }) => Math.abs(corrige(t, fc) - obs)));
      const sesgo = promedio(te.map(({ fc, obs }) => fc - obs));
      const mejora = (1 - corregida / cruda) * 100;

      console.log(
        `${modelo.padEnd(17)} ${String(lead).padStart(2)}d ${String(te.length).padStart(6)}`
        + `   ${cruda.toFixed(2).padStart(6)}°C   ${corregida.toFixed(2).padStart(8)}°C`
        + `   ${mejora.toFixed(1).padStart(5)}%   ${sesgo > 0 ? '+' : ''}${sesgo.toFixed(2)}°C`
      );
    }
  }

  console.log('\nOJO: la referencia es ERA5-Land (reanálisis ~9 km), no observación de estación.');
  console.log('Antes de creerle a estos números hay que repetirlos contra la EMA de la DMC.');
}

if (process.argv.includes('--test')) autoChequeo();
else main();
