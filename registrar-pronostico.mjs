#!/usr/bin/env node
// Anota lo que pronosticamos HOY para los próximos 7 días, junto a lo que dicen los modelos
// crudos, para poder comparar más adelante contra lo que de verdad pasó.
//
//   node registrar-pronostico.mjs
//
// Escribe una línea por comuna y por día objetivo en `marcador/pronosticos.jsonl`. No pide
// credenciales: solo llama a Open-Meteo, así que puede correr en CI sin secretos.
//
// Se guardan tres pronósticos para el mismo día, que son los que queremos enfrentar:
//
//   nuestro   ensamble ponderado y corregido con la estación local — lo que muestra el sitio
//   ecmwf     ECMWF crudo, a secas — lo que muestran la mayoría de los sitios
//   crudo     promedio parejo de los cuatro modelos, sin corregir ni ponderar
//
// No hace falta scrapear a nadie: los sitios conocidos muestran modelos crudos, y esos ya los
// bajamos en la misma llamada. Comparar contra ECMWF crudo mide lo mismo y no depende de que
// otro sitio no cambie su HTML.
//
// Importante: la calibración se ajustó hasta 2026-07-31. Todo lo que se registre desde
// entonces es fuera de muestra, que es la única forma honesta de medirse.

import { readFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { porDia, ahoraEnSantiago } from './sitio/calculo.js';
import { getJSON } from './http.mjs';

const MODELOS = ['ecmwf_ifs025', 'gfs_seamless', 'icon_seamless', 'gem_seamless'];
const SALIDA = 'marcador';
const ARCHIVO = `${SALIDA}/pronosticos.jsonl`;

const indice = JSON.parse(readFileSync('sitio/calibracion/indice.json', 'utf8'));
const ahora = ahoraEnSantiago(), hoy = ahora.slice(0, 10);

// Ya registrado hoy: correr dos veces el mismo día duplicaría filas y le daría el doble de
// peso a esa corrida al promediar.
if (existsSync(ARCHIVO)) {
  const previas = readFileSync(ARCHIVO, 'utf8').trimEnd().split('\n')
    .filter(Boolean).map(l => JSON.parse(l).corrida);
  if (previas.includes(hoy)) {
    console.log(`Ya hay registro de la corrida ${hoy}. Nada que hacer.`);
    process.exit(0);
  }
}

const extremos = (horas, saca) => {
  const v = horas.map(saca).filter(x => x != null);
  return v.length ? { max: +Math.max(...v).toFixed(2), min: +Math.min(...v).toFixed(2) } : null;
};
const media = obj => {
  const v = Object.values(obj).filter(x => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

mkdirSync(SALIDA, { recursive: true });
let filas = 0;

for (const c of indice.comunas) {
  const cal = JSON.parse(readFileSync(`sitio/calibracion/${c.slug}.json`, 'utf8'));
  const { hourly } = getJSON('https://api.open-meteo.com/v1/forecast'
    + `?latitude=${cal.lat}&longitude=${cal.lon}`
    + '&hourly=temperature_2m,precipitation&timezone=America/Santiago&forecast_days=7'
    + `&models=${MODELOS.join(',')}`);

  for (const d of porDia(cal, hourly, MODELOS, ahora)) {
    // El día de hoy ya viene empezado, así que su máxima puede haber ocurrido antes de esta
    // corrida: no es un pronóstico y no entra al marcador.
    if (d.fecha <= hoy) continue;
    const lead = Math.round((Date.parse(d.fecha) - Date.parse(hoy)) / 86400000);

    appendFileSync(ARCHIVO, JSON.stringify({
      corrida: hoy,
      comuna: c.slug,
      estacion: c.estacion,
      objetivo: d.fecha,
      lead,
      nuestro: {
        max: +d.max.toFixed(2), min: +d.min.toFixed(2),
        lluviaProb: +d.lluvia.prob.toFixed(3),
        acuerdo: d.lluvia.acuerdo, de: d.lluvia.total,
      },
      ecmwf: {
        ...extremos(d.horas, h => h.crudas.ecmwf_ifs025),
        mm: +(d.mm.ecmwf_ifs025 ?? 0).toFixed(2),
      },
      crudo: extremos(d.horas, h => media(h.crudas)),
      desacuerdo: +d.desacuerdo.toFixed(2),
    }) + '\n');
    filas++;
  }
  console.log(`  ${c.nombre}`);
}

console.log(`\n${filas} filas nuevas en ${ARCHIVO} (corrida ${hoy})`);
