#!/usr/bin/env node
// Corta la lámina vectorial de Mamushka (20 cuadros numerados) y los pone en una sola tira
// SVG para el hero.
//
//   node armar-tiras-svg.mjs
//
// La animación la hace CSS moviendo background-position con steps(): cortes secos como el
// stop motion, en el compositor del navegador, sin JavaScript ni temporizadores. Al ser
// vector no hay que pensar en retina.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert';
import { caja } from './caja.mjs';

const FUENTE = 'granmamushka3.svg';
const SALIDA = 'sitio/tiras/';
const ESCALA = 0.1, ALTO = 1024;         // del transform: translate(0,10240) scale(0.1,-0.1)
const COLS = 5, FILAS = 4;
const CELDA_AN = 15360 * ESCALA / COLS, CELDA_AL = 10240 * ESCALA / FILAS;
const ROTULO = [90, 105, 70];            // el número del cuadro: esquina sup. izq., y chico
const RELLENO = '#fff';

// Sin argumentos: los 20 cuadros en orden, como vienen en la lámina. Con argumentos, el
// primero es el nombre de la tira y el resto los cuadros:  ...mjs paseo 5 6 7 8 16 17
const [NOMBRE = 'mamushka', ...pedidos] = process.argv.slice(2);
const CICLO = pedidos.length ? pedidos.map(Number)
  : Array.from({ length: COLS * FILAS }, (_, i) => i + 1);
assert.ok(CICLO.every(n => n >= 1 && n <= COLS * FILAS), `cuadros fuera de 1..${COLS * FILAS}`);

const svg = readFileSync(FUENTE, 'utf8');
const paths = [...svg.matchAll(/<path[^>]*\bd="([^"]*)"/g)].map(m => m[1]);

// Cada path cae en la celda donde está su centro. El eje Y del archivo va invertido.
const rotulos = new Array(COLS * FILAS).fill(0);
const cuadros = Array.from({ length: COLS * FILAS }, () => []);
for (const d of paths) {
  const c = caja(d);
  const v = { x1: c.minX * ESCALA, x2: c.maxX * ESCALA,
              y1: ALTO - c.maxY * ESCALA, y2: ALTO - c.minY * ESCALA };
  const cx = (v.x1 + v.x2) / 2, cy = (v.y1 + v.y2) / 2;
  const col = Math.min(COLS - 1, Math.floor(cx / CELDA_AN));
  const fila = Math.min(FILAS - 1, Math.floor(cy / CELDA_AL));
  // El número del cuadro: una pastilla chica arriba a la izquierda de su celda. El gato la
  // roza en varios cuadros, así que no basta la esquina: también tiene que ser chica. El
  // margen de 20 px es porque un par de números se pasan al lado izquierdo de su celda.
  if ((cx + 20) % CELDA_AN - 20 < ROTULO[0] && (cy + 20) % CELDA_AL - 20 < ROTULO[1]
      && v.x2 - v.x1 < ROTULO[2] && v.y2 - v.y1 < ROTULO[2]) { rotulos[fila * COLS + col]++; continue; }
  cuadros[fila * COLS + col].push({ d, v });
}
// A todo cuadro hay que haberle sacado algo de esa esquina: si a alguno no, su número se
// quedó adentro y va a salir animándose en el hero.
assert.ok(rotulos.every(n => n > 0), `sin número descartado en los cuadros `
  + rotulos.flatMap((n, i) => n ? [] : i + 1).join(', '));

const marco = n => {
  const ps = cuadros[n - 1];
  if (!ps?.length) throw new Error(`el cuadro ${n} salió vacío`);
  const x = Math.min(...ps.map(p => p.v.x1)), y = Math.min(...ps.map(p => p.v.y1));
  const w = Math.max(...ps.map(p => p.v.x2)) - x, h = Math.max(...ps.map(p => p.v.y2)) - y;
  return { n, ps, x, y, w, h };
};
const marcos = new Map(cuadros.map((_, i) => [i + 1, marco(i + 1)]));

// La celda la manda la lámina entera, no el ciclo: así todas las tiras salen con la misma
// celda, el CSS usa un solo --an/--al y la gata no cambia de tamaño entre una tira y otra.
const AN = Math.ceil(Math.max(...marcos.values().map(m => m.w)));
const AL = Math.ceil(Math.max(...marcos.values().map(m => m.h)));

const cuerpo = CICLO.map((n, k) => {
  const m = marcos.get(n);
  // abajo y centrada: la gata queda "apoyada" en la misma línea en todos los cuadros
  return `<g transform="translate(${(k * AN + (AN - m.w) / 2 - m.x).toFixed(1)},`
    + `${(AL - m.h - m.y).toFixed(1)})">`
    + `<g transform="translate(0,${ALTO}) scale(${ESCALA},-${ESCALA})">`
    + m.ps.map(p => `<path d="${p.d.replace(/\s+/g, ' ')}"/>`).join('')
    + '</g></g>';
}).join('\n');

const tira = `<svg xmlns="http://www.w3.org/2000/svg" width="${AN * CICLO.length}" height="${AL}"`
  + ` viewBox="0 0 ${AN * CICLO.length} ${AL}" fill="${RELLENO}">\n${cuerpo}\n</svg>\n`;
mkdirSync(SALIDA, { recursive: true });
writeFileSync(SALIDA + NOMBRE + '.svg', tira);

console.log('%s: %d cuadros de %dx%d (proporción %s)  ·  %s KB', NOMBRE,
  CICLO.length, AN, AL, (AN / AL).toFixed(3), (tira.length / 1024).toFixed(1));
