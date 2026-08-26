#!/usr/bin/env node
// Hoja de contacto con todas las poses, para elegir cual va con cada estado del tiempo.
//
//   node generar-hoja-poses.mjs
//
// Sale `diseno/hoja-poses.html`. Va en diseno/ y no en sitio/ a proposito: es una herramienta
// de trabajo, no una pagina del sitio, y Vercel solo publica sitio/.
//
// Los SVG se muestran con <img> y no como mascara CSS: traen fill="currentColor", que dentro
// de un <img> se resuelve a negro, que es justo lo que sirve para verlas sobre fondo claro.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const SET = 'mas vectores/gatos';
const EXCLUIDAS = ['pose-24', 'pose-35'];   // las que descartaste

// El mapa que usa el sitio hoy, leido de la fuente para que no se desincronice.
const html = readFileSync('sitio/index.html', 'utf8');
const POSE = Object.fromEntries(
  [...html.match(/const POSE = \{([^}]*)\}/s)[1].matchAll(/(\w+)\s*:\s*'([\w-]+)'/g)]
    .map(m => [m[1], m[2]]));
const enSitio = new Set(readdirSync('sitio/poses').filter(f => f.endsWith('.svg')).map(f => f.slice(0, -4)));

const poses = readdirSync(SET).filter(f => /^pose-\d+\.svg$/.test(f)).map(f => f.slice(0, -4))
  .sort((a, b) => +a.slice(5) - +b.slice(5));

// Estado -> que poses lo representan hoy (puede haber repetidas).
const usadaPor = {};
for (const [estado, p] of Object.entries(POSE)) (usadaPor[p] ??= []).push(estado);

// Los estados que la lógica podría distinguir con los datos que ya pedimos. El porcentaje es
// cuántas horas caerían ahí, medido sobre 504 horas de tres comunas en agosto.
const ESTADOS = [
  ['sol',          'despejado de día',                    '~10 %'],
  ['nublado',      'nublado, sin lluvia',                 '~2 %'],
  ['llovizna',     '1 o 2 de 4 modelos mojan la hora',    '32 %'],
  ['lluvia',       '3 o 4 de 4 modelos mojan la hora',    '5 %'],
  ['humedo',       'humedad sobre 90 %, sin lluvia',      '12 %'],
  ['noche',        'despejado de noche',                  '~44 %'],
  ['noche-nublado','nublado de noche',                    'poco'],
  ['noche-lluvia', 'lluvia de noche',                     '2 %'],
  ['frio',         'ocho grados o menos, de día',         'poco'],
  ['frio-noche',   'ocho grados o menos, de noche',       '19 %'],
  ['helada',       'dos grados o menos',                  '0 % ahora, sí en junio'],
  ['calor',        'veintinueve grados o más',            '0 % ahora, sí en enero'],
];

const tarjeta = p => {
  const n = p.slice(5);
  const estados = usadaPor[p] ?? [];
  const fuera = EXCLUIDAS.includes(p);
  return `<figure class="p ${fuera ? 'fuera' : ''}">
    <img src="../${SET}/${p}.svg" alt="pose ${n}" loading="lazy">
    <figcaption><b>${n}</b>${
      fuera ? '<span class="mal">descartada</span>'
      : estados.length ? `<span class="ok">${estados.join(' · ')}</span>`
      : enSitio.has(p) ? '<span class="rot">solo rotación</span>'
      : '<span class="sin">sin uso</span>'}</figcaption>
  </figure>`;
};

writeFileSync('diseno/hoja-poses.html', `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Hoja de contacto — poses de la gatita</title>
<style>
  :root{--papel:#f2e5bc;--tinta:#282828;--suave:#504945;--tenue:#7c6f64;
    --verde:#427b58;--naranja:#af3a03;--gris:#a89984}
  *{box-sizing:border-box;margin:0}
  body{background:var(--papel);color:var(--tinta);
    font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;padding:28px 20px 60px}
  .env{max-width:1000px;margin:0 auto}
  h1{font-size:1.6rem;letter-spacing:-.02em;margin-bottom:6px}
  h2{font-size:1rem;margin:28px 0 10px}
  p{color:var(--suave);margin-bottom:10px;max-width:64ch}
  code{background:rgba(40,40,40,.08);padding:1px 5px;border-radius:4px;font-size:.9em}
  table{border-collapse:collapse;font-size:14px;margin-bottom:8px}
  th,td{text-align:left;padding:6px 14px 6px 0;border-bottom:1px solid rgba(40,40,40,.12)}
  th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--tenue)}
  td.hoy{color:var(--verde);font-weight:700}
  td.falta{color:var(--naranja);font-weight:700}
  .rej{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:14px}
  .p{background:#fff;border:1px solid rgba(40,40,40,.14);border-radius:14px;padding:10px;
    display:flex;flex-direction:column;align-items:center;gap:6px}
  .p.fuera{opacity:.4}
  .p img{width:100%;height:86px;object-fit:contain}
  figcaption{display:flex;flex-direction:column;align-items:center;gap:3px;
    font-size:12px;text-align:center}
  figcaption b{font-size:15px}
  figcaption span{font-size:10px;text-transform:uppercase;letter-spacing:.05em;
    padding:2px 7px;border-radius:999px;line-height:1.5}
  .ok{background:#d8e8d0;color:var(--verde)}
  .rot{background:rgba(40,40,40,.09);color:var(--tenue)}
  .sin{background:transparent;color:var(--gris);border:1px dashed var(--gris)}
  .mal{background:#f3d9cc;color:var(--naranja)}
</style>
</head>
<body>
<div class="env">
  <h1>Poses de la gatita — hoja de contacto</h1>
  <p>Las ${poses.length} del set, numeradas. Dime qué número va con cada estado y escribo la
  lógica con tus asignaciones puestas. Una pose puede repetirse en dos estados si te calza.</p>

  <h2>Los estados que la lógica puede distinguir</h2>
  <p>El porcentaje es cuántas horas caerían en cada uno, medido sobre 504 horas de tres
  comunas en agosto. Los de <code>0 % ahora</code> no aparecen en invierno pero sí en verano.</p>
  <table>
    <thead><tr><th>Estado</th><th>Cuándo</th><th>Frecuencia</th><th>Pose hoy</th></tr></thead>
    <tbody>${ESTADOS.map(([e, cuando, frec]) => `<tr>
      <td><code>${e}</code></td><td>${cuando}</td><td>${frec}</td>
      <td class="${POSE[e] ? 'hoy' : 'falta'}">${POSE[e] ? POSE[e].slice(5) : 'falta'}</td>
    </tr>`).join('')}</tbody>
  </table>

  <h2>El set completo</h2>
  <div class="rej">${poses.map(tarjeta).join('')}</div>
</div>
</body>
</html>
`);
console.log(`diseno/hoja-poses.html — ${poses.length} poses`);
