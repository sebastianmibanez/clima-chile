#!/usr/bin/env node
// Separa la lámina de siluetas en 54 gatos individuales y arma una página para elegirlos.
//
//   node separar-gatos.mjs            genera sitio/gatos.html (catálogo para elegir)
//   node separar-gatos.mjs 12 7 33    emite esos gatos como <symbol> listos para pegar
//
// El SVG viene de trazar el JPG con potrace: un solo <g> con transform y 54 paths que usan
// M absoluto y c/l relativos. Para recortar cada gato hay que recorrer el path acumulando
// las coordenadas relativas y sacarle la caja delimitadora.

import { readFileSync, writeFileSync } from 'node:fs';
import { caja } from './caja.mjs';

const FUENTE = 'vecteezy_cats-silhouettes-set_11816421.svg';
const ESCALA = 0.1, ALTO = 1235;   // del transform: translate(0,1235) scale(0.1,-0.1)

const svg = readFileSync(FUENTE, 'utf8');
const paths = [...svg.matchAll(/<path[^>]*\bd="([^"]*)"/g)].map(m => m[1]);

// Pasa la caja del espacio del archivo al espacio ya transformado (escalado y volteado).
function vistaDe(d, margen = 40) {
  const c = caja(d);
  const x1 = c.minX * ESCALA, x2 = c.maxX * ESCALA;
  const y1 = ALTO - c.maxY * ESCALA, y2 = ALTO - c.minY * ESCALA;   // el eje Y va invertido
  const x = x1 - margen, y = y1 - margen;
  return { x, y, w: (x2 - x1) + margen * 2, h: (y2 - y1) + margen * 2 };
}

const gatos = paths.map((d, i) => ({ i, d, v: vistaDe(d), peso: d.length }));

// ---------- emitir los elegidos como <symbol> ----------

const elegidos = process.argv.slice(2).map(Number).filter(Number.isInteger);
if (elegidos.length) {
  const ESTADOS = ['sol', 'nublado', 'lluvia', 'frio', 'calor', 'noche'];
  console.log('<!-- Siluetas: dava ardhika vía Vecteezy (licencia gratuita, requiere atribución) -->');
  elegidos.forEach((n, k) => {
    const g = gatos[n];
    if (!g) return console.error(`no existe el gato ${n}`);
    const nombre = ESTADOS[k] ?? `estado${k}`;
    console.log(`<symbol id="gato-${nombre}" viewBox="${g.v.x.toFixed(0)} ${g.v.y.toFixed(0)} `
      + `${g.v.w.toFixed(0)} ${g.v.h.toFixed(0)}">`);
    console.log(`  <g transform="translate(0,${ALTO}) scale(${ESCALA},-${ESCALA})" fill="currentColor">`);
    console.log(`    <path d="${g.d.replace(/\s+/g, ' ')}"/>`);
    console.log('  </g>\n</symbol>');
  });
  console.error(`\n${elegidos.length} símbolos, `
    + `${(elegidos.reduce((a, n) => a + (gatos[n]?.peso ?? 0), 0) / 1024).toFixed(1)} KB de paths`);
  process.exit(0);
}

// ---------- catálogo para elegir ----------

const tarjeta = g => `<figure>
  <svg viewBox="${g.v.x.toFixed(0)} ${g.v.y.toFixed(0)} ${g.v.w.toFixed(0)} ${g.v.h.toFixed(0)}">
    <g transform="translate(0,${ALTO}) scale(${ESCALA},-${ESCALA})" fill="currentColor">
      <path d="${g.d.replace(/\s+/g, ' ')}"/></g></svg>
  <svg class="mini" viewBox="${g.v.x.toFixed(0)} ${g.v.y.toFixed(0)} ${g.v.w.toFixed(0)} ${g.v.h.toFixed(0)}">
    <g transform="translate(0,${ALTO}) scale(${ESCALA},-${ESCALA})" fill="currentColor">
      <path d="${g.d.replace(/\s+/g, ' ')}"/></g></svg>
  <figcaption>${g.i} · ${(g.peso / 1024).toFixed(1)} KB</figcaption>
</figure>`;

writeFileSync('sitio/gatos.html', `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Elegir gatos</title>
<style>
:root{--fondo:#f3f0ea;--tarjeta:#fffdf9;--tinta:#221f1b;--suave:#736b62;--borde:#e4ded3}
@media(prefers-color-scheme:dark){:root{--fondo:#16150f;--tarjeta:#221f1a;--tinta:#ece7df;
  --suave:#a49b90;--borde:#332f28}}
*{box-sizing:border-box;margin:0}
body{background:var(--fondo);color:var(--tinta);font:15px/1.5 system-ui,sans-serif;padding:1.5rem}
h1{font-size:1.2rem;margin-bottom:.3rem}
p{color:var(--suave);font-size:.9rem;margin-bottom:1.2rem;max-width:60ch}
code{background:var(--borde);padding:.15rem .4rem;border-radius:.3rem;font-size:.85em}
.rejilla{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:.6rem}
figure{background:var(--tarjeta);border:1px solid var(--borde);border-radius:.7rem;
  padding:.6rem;text-align:center;color:var(--tinta)}
figure svg{width:100%;height:86px;display:block}
figure svg.mini{height:26px;opacity:.75;margin-top:.25rem}
figcaption{font-size:.72rem;color:var(--suave);margin-top:.35rem;font-variant-numeric:tabular-nums}
footer{margin-top:1.5rem;font-size:.8rem;color:var(--suave)}
</style></head><body>
<h1>Elegir gatos · ${gatos.length} siluetas</h1>
<p>El número grande es cómo se verá en el hero; el chico, como se verá en la lista de 7 días.
Anota los números que quieras para <b>sol, nublado, lluvia, frío, calor y noche</b> (en ese orden)
y córrelos con <code>node separar-gatos.mjs 12 7 33 41 5 28</code> para obtener los símbolos.</p>
<div class="rejilla">${gatos.map(tarjeta).join('\n')}</div>
<footer>Siluetas: dava ardhika vía Vecteezy · licencia gratuita, requiere atribución.</footer>
</body></html>`);

const pesoTotal = gatos.reduce((a, g) => a + g.peso, 0) / 1024;
console.log(`sitio/gatos.html — ${gatos.length} gatos, ${pesoTotal.toFixed(1)} KB de paths en total`);
console.log(`el más liviano: ${(Math.min(...gatos.map(g => g.peso)) / 1024).toFixed(2)} KB · `
  + `el más pesado: ${(Math.max(...gatos.map(g => g.peso)) / 1024).toFixed(2)} KB`);
console.log('\nÁbrelo en el navegador y dime los seis números que quieres.');
