#!/usr/bin/env node
// Verifica la lógica de sitio/calculo.js — primero con datos sintéticos donde la respuesta
// correcta se conoce, y después contra el pronóstico real de hoy para ver que las piezas
// encajan de punta a punta.
//
//   node prueba-calculo.mjs

import { readFileSync } from 'node:fs';
import { getJSON } from './http.mjs';
import {
  idx, horizonte, corregir, ensamble, probabilidadLluvia, estadoGato, porDia, ahoraEnSantiago,
} from './sitio/calculo.js';

const MODELOS = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'gem_seamless'];
let fallos = 0;
const chequea = (cond, msg) => { if (!cond) { console.error('  ✗ ' + msg); fallos++; } };

// ---------- sintético ----------

const ahora = '2026-08-17T12:00';   // hora de pared de Santiago, no un Date

chequea(idx(1, 0) === 0 && idx(12, 23) === 287, 'el índice debe cubrir 0..287');
chequea(horizonte('2026-08-18T12:00', ahora) === 1, 'mañana es horizonte 1');
chequea(horizonte('2026-08-24T12:00', ahora) === 7, 'en 7 días es horizonte 7');
chequea(horizonte('2026-09-30T12:00', ahora) === 7, 'más allá de 7 se corta en 7');
chequea(horizonte('2026-08-17T06:00', ahora) === 1, 'lo de hoy usa la tabla de 1 día');

// El horizonte no puede depender de la zona del visitante: los tiempos de Open-Meteo son
// hora de pared de Santiago y hay que compararlos como tales. Antes esto se rompía al
// abrir el sitio desde fuera de Chile.
chequea(ahoraEnSantiago(new Date('2026-08-17T12:00:00Z')) === '2026-08-17T08:00',
  'en agosto Chile es UTC−4, así que 12:00Z son las 08:00 locales');

// Sesgo conocido: el modelo marca +2 °C a las 09:00 de agosto. Corregir debe borrarlo.
const tabla = new Array(288).fill(0);
tabla[idx(8, 9)] = 2;
const cal = {
  sesgo: { m1: { 1: tabla } },
  pesos: { m1: { 1: 0.75 }, m2: { 1: 0.25 } },
  lluvia: {
    umbralMm: { m1: 5, m2: 1 },
    prob: { 0: 0.02, 1: 0.30, 2: 0.85 },
    climatologia: 0.05,
  },
};
chequea(corregir(cal, 'm1', '2026-08-18T09:00', 22, ahora) === 20,
  'la corrección debe restar el sesgo del balde');
chequea(corregir(cal, 'm1', '2026-08-18T10:00', 22, ahora) === 22,
  'una hora sin sesgo no debe moverse');
chequea(corregir(cal, 'desconocido', '2026-08-18T09:00', 22, ahora) === 22,
  'un modelo sin tabla debe pasar sin tocar');

// Ensamble ponderado: 0,75×10 + 0,25×20 = 12,5. El promedio parejo daría 15.
chequea(ensamble(cal, '2026-08-18T09:00', { m1: 10, m2: 20 }, ahora) === 12.5,
  'el ensamble debe ponderar, no promediar parejo');
chequea(ensamble(cal, '2026-08-18T09:00', { m1: 10, m2: null }, ahora) === 10,
  'un modelo faltante no debe arrastrar el resultado');

// Cada modelo vota con su propio umbral: m1 necesita 5 mm, m2 solo 1 mm.
const dosVotos = probabilidadLluvia(cal, { m1: 6, m2: 2 });
chequea(dosVotos.acuerdo === 2 && dosVotos.prob === 0.85, 'con los dos de acuerdo, 85 %');
const unVoto = probabilidadLluvia(cal, { m1: 3, m2: 2 });
chequea(unVoto.acuerdo === 1 && unVoto.prob === 0.30,
  'm1 con 3 mm no alcanza su umbral de 5, así que es un solo voto');
chequea(probabilidadLluvia(cal, { m1: 0, m2: 0 }).prob === 0.02, 'sin votos, 2 %');

// El gatito es función de los datos: la lluvia manda sobre todo lo demás.
chequea(estadoGato({ temp: 25, prob: 0.6, hora: 14 }) === 'lluvia', 'llueve → gato mojado');
chequea(estadoGato({ temp: 25, prob: 0.1, hora: 22 }) === 'noche', 'de noche → gato durmiendo');
chequea(estadoGato({ temp: 3, prob: 0.1, hora: 14 }) === 'frio', 'frío → gato hecho bolita');
chequea(estadoGato({ temp: 32, prob: 0, hora: 14 }) === 'calor', 'calor → gato desparramado');
chequea(estadoGato({ temp: 20, prob: 0.3, hora: 14 }) === 'nublado', 'dudoso → gato nublado');
chequea(estadoGato({ temp: 20, prob: 0.05, hora: 14 }) === 'sol', 'despejado → gato al sol');

// ---------- sin calibración ----------
// Cualquier punto de Chile fuera de las comunas medidas llega acá sin tablas. Antes eso
// devolvía null y dejaba la página en blanco; ahora degrada y lo declara.

const pelado = { comuna: 'Sin calibrar' };

chequea(corregir(pelado, 'm1', '2026-08-18T09:00', 22, ahora) === 22,
  'sin tabla de sesgo la temperatura debe pasar cruda');
chequea(ensamble(pelado, '2026-08-18T09:00', { m1: 10, m2: 20 }, ahora) === 15,
  'sin pesos el ensamble promedia parejo, que es lo mejor disponible');
chequea(ensamble(pelado, '2026-08-18T09:00', { m1: 10, m2: null }, ahora) === 10,
  'sin pesos, un modelo faltante tampoco debe arrastrar el resultado');
chequea(ensamble(pelado, '2026-08-18T09:00', { m1: null }, ahora) === null,
  'sin ningún valor sí corresponde null');

// Umbral único de 1 mm y probabilidad = fracción de modelos que coinciden.
const sinHist = probabilidadLluvia(pelado, { m1: 5, m2: 0, m3: 2, m4: 0 });
chequea(sinHist !== null, 'sin calibración la probabilidad no puede ser null');
chequea(sinHist.acuerdo === 2 && sinHist.total === 4 && sinHist.prob === 0.5,
  'sin historial, la probabilidad es cuántos modelos coinciden sobre el total');
chequea(probabilidadLluvia(pelado, { m1: 0.5, m2: 0.9 }).acuerdo === 0,
  'bajo el umbral genérico de 1 mm nadie vota');

// La página necesita distinguir los dos casos para no vender como corregido lo que no lo está.
chequea(sinHist.calibrada === false, 'un punto sin tablas debe marcarse como no calibrado');
chequea(probabilidadLluvia(cal, { m1: 6, m2: 2 }).calibrada === true,
  'una comuna con umbrales propios sí es calibrada');

console.log(fallos ? `\n${fallos} fallos en las pruebas sintéticas` : 'sintético ok');

// ---------- de punta a punta, con el pronóstico real de hoy ----------

const cal2 = JSON.parse(readFileSync('sitio/calibracion/pudahuel.json', 'utf8'));
const { hourly } = getJSON('https://api.open-meteo.com/v1/forecast'
  + `?latitude=${cal2.lat}&longitude=${cal2.lon}`
  + '&hourly=temperature_2m,precipitation&timezone=America/Santiago&forecast_days=7'
  + `&models=${MODELOS.join(',')}`);

const dias = porDia(cal2, hourly, MODELOS);
chequea(dias.length >= 6, `debería haber ~7 días, hay ${dias.length}`);
chequea(dias.every(d => d.min == null || d.min <= d.max), 'la mínima no puede superar a la máxima');
chequea(dias.every(d => !d.lluvia || (d.lluvia.prob >= 0 && d.lluvia.prob <= 1)),
  'la probabilidad debe caer entre 0 y 1');

console.log(`\n${cal2.comuna} — pronóstico corregido de hoy:`);
for (const d of dias) {
  const l = d.lluvia;
  console.log(`  ${d.fecha}  ${d.min?.toFixed(1).padStart(5)}° a ${d.max?.toFixed(1).padStart(5)}°`
    + `   lluvia ${String(Math.round(l.prob * 100)).padStart(3)}% (${l.acuerdo}/${l.total} modelos)`
    + `   desacuerdo ${d.desacuerdo.toFixed(1)}°`
    + `   ${estadoGato({ temp: d.max, prob: l.prob, hora: 14 })}`);
}

// Lo mismo de punta a punta: el pronóstico real de hoy, pero como si la comuna no estuviera
// calibrada. Ni un solo día puede quedar en null.
const diasCrudos = porDia({ comuna: 'Sin calibrar', lat: cal2.lat, lon: cal2.lon }, hourly, MODELOS);
chequea(diasCrudos.length === dias.length,
  'sin calibración deben salir los mismos días que con ella');
chequea(diasCrudos.every(d => d.max != null && d.min != null && d.lluvia != null),
  'ningún día puede quedar sin temperatura ni sin probabilidad');
chequea(diasCrudos.every(d => d.lluvia.calibrada === false),
  'y todos deben venir marcados como no calibrados');

// El efecto de la corrección debe ser visible pero no absurdo: si moviera 10 °C algo se rompió.
const muestra = dias[1]?.horas[12];
if (muestra) {
  const crudo = ensamble(cal2, muestra.t, muestra.crudas);
  console.log(`\n  ejemplo ${muestra.t}:  crudo ${crudo.toFixed(2)}°  →  corregido ${muestra.temp.toFixed(2)}°`);
  chequea(Math.abs(crudo - muestra.temp) < 6, 'una corrección de más de 6 °C sería sospechosa');
}

console.log(fallos ? `\n${fallos} FALLOS` : '\ntodo ok');
process.exit(fallos ? 1 : 0);
