#!/usr/bin/env node
// Junta las poses sueltas en UNA lamina SVG, cada una centrada en su casilla y a la misma
// escala, con su numero al lado. Sirve para llevarlas a un editor de vectores de un tiron en
// vez de subir 42 archivos, y de paso deja a la vista lo dispares que son de proporcion.
//
//   node generar-lamina.mjs
//
// Sale `diseno/lamina-poses.svg`.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const SET = 'mas vectores/gatos';
const SALIDA = 'diseno/lamina-poses.svg';
const COLS = 6;
const CASILLA = 240, ALTO = 160;          // 3:2, la proporcion que propongo para el set nuevo
const PAD = 26, ROTULO = 26;

const poses = readdirSync(SET).filter(f => /^pose-\d+\.svg$/.test(f))
  .sort((a, b) => +a.slice(5, -4) - +b.slice(5, -4));

const filas = Math.ceil(poses.length / COLS);
const anchoTotal = COLS * CASILLA;
const altoTotal = filas * (ALTO + ROTULO);

const cuerpos = poses.map((f, i) => {
  const svg = readFileSync(`${SET}/${f}`, 'utf8');
  const [, , w, h] = svg.match(/viewBox="([\d.\s-]+)"/)[1].trim().split(/\s+/).map(Number);
  const [vx, vy] = svg.match(/viewBox="([\d.\s-]+)"/)[1].trim().split(/\s+/).map(Number);

  // Todo lo que va dentro del <svg>, sin la etiqueta raiz.
  const dentro = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
    .replace(/currentColor/g, '#282828');

  // Encajar preservando proporcion, centrado en la casilla util.
  const util = { w: CASILLA - PAD * 2, h: ALTO - PAD };
  const s = Math.min(util.w / w, util.h / h);
  const col = i % COLS, fil = Math.floor(i / COLS);
  const x = col * CASILLA + (CASILLA - w * s) / 2;
  const y = fil * (ALTO + ROTULO) + (ALTO - h * s) / 2;
  const n = f.slice(5, -4);

  return `  <g transform="translate(${x.toFixed(2)},${y.toFixed(2)}) scale(${s.toFixed(4)}) translate(${-vx},${-vy})">
${dentro.trim()}
  </g>
  <text x="${(col * CASILLA + CASILLA / 2).toFixed(0)}" y="${(fil * (ALTO + ROTULO) + ALTO + 16).toFixed(0)}"
    text-anchor="middle" font-family="monospace" font-size="18" fill="#7c6f64">${n}</text>`;
}).join('\n');

writeFileSync(SALIDA, `<svg xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 ${anchoTotal} ${altoTotal}" width="${anchoTotal}" height="${altoTotal}">
  <rect width="100%" height="100%" fill="#f2e5bc"/>
${poses.map((_, i) => {
  const col = i % COLS, fil = Math.floor(i / COLS);
  return `  <rect x="${col * CASILLA}" y="${fil * (ALTO + ROTULO)}" width="${CASILLA}" height="${ALTO}"
    fill="none" stroke="#d5c4a1" stroke-width="1"/>`;
}).join('\n')}
${cuerpos}
</svg>
`);
console.log(`${SALIDA} — ${poses.length} poses en ${COLS}x${filas}, casilla ${CASILLA}x${ALTO} (3:2)`);
