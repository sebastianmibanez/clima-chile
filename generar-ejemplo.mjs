#!/usr/bin/env node
// Genera sitio/datos-ejemplo.json: la salida real de la UI, con la forma exacta que consume,
// para poder diseñar contra datos verdaderos en vez de inventados.
//
//   node generar-ejemplo.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { getJSON } from './http.mjs';
import { porDia, estadoGato, TEXTO_ESTADO, ahoraEnSantiago } from './sitio/calculo.js';

const MODELOS = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'gem_seamless'];
const NOMBRE = { ecmwf_ifs025: 'ECMWF', gfs_seamless: 'GFS', icon_seamless: 'ICON', gem_seamless: 'GEM' };

const cal = JSON.parse(readFileSync('sitio/calibracion/puente-alto.json', 'utf8'));
const { hourly } = getJSON('https://api.open-meteo.com/v1/forecast'
  + `?latitude=${cal.lat}&longitude=${cal.lon}`
  + '&hourly=temperature_2m,precipitation&timezone=America/Santiago&forecast_days=7'
  + `&models=${MODELOS.join(',')}`);

const ahora = ahoraEnSantiago();
const hoy = ahora.slice(0, 10);
const dias = porDia(cal, hourly, MODELOS, ahora);
const d0 = dias.find(d => d.fecha === hoy) ?? dias[0];
const horaActual = +ahora.slice(11, 13);
const ahoraMismo = d0.horas.find(h => h.hora === horaActual) ?? d0.horas.at(-1);

const ejemplo = {
  _nota: 'Salida real de la UI para Puente Alto. Los grados ya vienen corregidos contra la '
    + 'estación local y la probabilidad ya viene calibrada. Diseñar contra estos valores.',
  comuna: cal.comuna,
  comunasDisponibles: ['Pudahuel', 'Renca', 'La Florida', 'Puente Alto', 'Colina', 'Quinta Normal'],
  estacionReferencia: cal.estacion,
  horasObservadas: cal.horasObservadas,
  diasConLluviaRegistrados: cal.lluvia.diasConLluvia,

  ahora: {
    hora: horaActual,
    temperatura: +ahoraMismo.temp.toFixed(1),
    estado: estadoGato({ temp: ahoraMismo.temp, prob: d0.lluvia.prob, hora: horaActual }),
    estadoTexto: TEXTO_ESTADO[estadoGato({ temp: ahoraMismo.temp, prob: d0.lluvia.prob, hora: horaActual })],
    minHoy: +d0.min.toFixed(1),
    maxHoy: +d0.max.toFixed(1),
    probabilidadLluvia: +d0.lluvia.prob.toFixed(2),
  },

  acuerdoHoy: {
    modelos: MODELOS.map(m => ({
      id: m, nombre: NOMBRE[m], anunciaLluvia: d0.lluvia.votan.includes(m),
    })),
    cuantosAnuncian: d0.lluvia.acuerdo,
    total: d0.lluvia.total,
    desacuerdoMaximaC: +d0.desacuerdo.toFixed(1),
  },

  semana: dias.map(d => ({
    fecha: d.fecha,
    esHoy: d.fecha === hoy,
    min: +d.min.toFixed(1),
    max: +d.max.toFixed(1),
    probabilidadLluvia: +d.lluvia.prob.toFixed(2),
    cuantosAnuncian: d.lluvia.acuerdo,
    total: d.lluvia.total,
    desacuerdoMaximaC: +d.desacuerdo.toFixed(1),
    estado: estadoGato({ temp: d.max, prob: d.lluvia.prob, hora: 14 }),
  })),

  estadosPosibles: Object.entries(TEXTO_ESTADO).map(([id, texto]) => ({ id, texto })),

  desempenoMedido: {
    _nota: 'Medido con validación cruzada sobre 2,5 años contra la estación local. '
      + 'Son los números que el pie del sitio debe poder respaldar.',
    errorMedioTemperatura24hC: 1.18,
    deLosDiasQueLlovioAnunciamos: 0.85,
    cuandoAnunciamosLluviaAcertamos: 0.59,
  },
};

writeFileSync('sitio/datos-ejemplo.json', JSON.stringify(ejemplo, null, 2));
const kb = (JSON.stringify(ejemplo, null, 2).length / 1024).toFixed(1);
console.log(`sitio/datos-ejemplo.json  ${kb} KB`);
console.log(`\nhoy: ${ejemplo.ahora.temperatura}° ${ejemplo.ahora.estadoTexto}, `
  + `${Math.round(ejemplo.ahora.probabilidadLluvia * 100)}% lluvia, `
  + `${ejemplo.acuerdoHoy.cuantosAnuncian}/${ejemplo.acuerdoHoy.total} modelos`);
console.log('estados en la semana:', [...new Set(ejemplo.semana.map(d => d.estado))].join(', '));
console.log('desacuerdo máximo:', Math.max(...ejemplo.semana.map(d => d.desacuerdoMaximaC)) + '°');
