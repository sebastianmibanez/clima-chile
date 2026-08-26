#!/usr/bin/env node
// Hoja de revision de los estados del tiempo: cada icono junto a las dos poses que el mapa le
// asigna, que es exactamente como se van a ver en el sitio.
//
//   node generar-hoja-clima.mjs
//
// Sale `diseno/hoja-clima.html`. Marca ademas cuales de los 20 estados se pueden calcular con
// los datos que pedimos y cuales no, para que la revision sea sobre lo que de verdad va a
// aparecer.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const BASE = 'vecttores fusionados/gatos';
const mapa = JSON.parse(readFileSync(`${BASE}/mapa-clima.json`, 'utf8'));

// De donde saldria cada estado. Medido sobre 1008 horas de las 6 comunas.
const ORIGEN = {
  'despejado':       ['cloud_cover < 20', '16 %'],
  'sol-con-nube':    ['cloud_cover 20-50', '20 %'],
  'parcial-nublado': ['cloud_cover 50-75', '28 %'],
  'nublado':         ['cloud_cover 75-90', '24 %'],
  'cubierto':        ['cloud_cover > 90', '12 %'],
  'camanchaca':      [null, 'en Santiago se confunde con neblina'],
  'neblina':         ['weather_code 45/48', 'poco'],
  'smog':            [null, 'necesita la Air Quality API'],
  'llovizna':        ['weather_code 51-57', '24 %'],
  'lluvia':          ['weather_code 61-63, 80-81', '2 %'],
  'lluvia-intensa':  ['weather_code 65, 82', 'poco'],
  'tormenta':        ['weather_code 95', 'poco'],
  'granizo':         ['weather_code 96-99', 'poco'],
  'nieve':           ['weather_code 71-77, 85-86', '2 %'],
  'aguanieve':       ['weather_code 66-67', 'poco'],
  'helada':          ['temperatura <= 0', '0 % ahora, si en junio'],
  'calor':           ['temperatura >= 32', '0 % ahora, si en enero'],
  'uv':              [null, 'Open-Meteo solo lo trae para 1 de 4 modelos'],
  'viento':          ['wind_speed', '0 % medido en Santiago'],
  'marejadas':       [null, 'es costero, no aplica a Santiago'],
};

const fila = e => {
  const [como, frec] = ORIGEN[e.id] ?? [null, ''];
  const icono = `../${BASE}/clima/clima-${e.icono}.svg`;
  const poses = e.poses.map(p => `../${BASE}/pose-${p}.svg`);
  const faltan = [icono, ...poses].filter(f => !existsSync(f.replace('../', '')));
  return `<tr class="${como ? '' : 'no'}">
    <td class="ico"><img src="${icono}" alt=""></td>
    <td class="nom"><b>${e.nombre}</b><span>${e.id} · icono ${e.icono}</span></td>
    <td class="poses">
      <figure><img src="${poses[0]}" alt=""><figcaption>${e.poses[0]}</figcaption></figure>
      <figure><img src="${poses[1]}" alt=""><figcaption>${e.poses[1]}</figcaption></figure>
    </td>
    <td class="como">${como ? `<code>${como}</code>` : `<span class="fuera">no se puede</span>`}
      <span class="frec">${frec}</span>${faltan.length ? `<span class="fuera">falta archivo</span>` : ''}</td>
  </tr>`;
};

const computables = mapa.estados.filter(e => ORIGEN[e.id]?.[0]).length;

writeFileSync('diseno/hoja-clima.html', `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Estados del tiempo — íconos y poses</title>
<style>
  :root{--papel:#f2e5bc;--tinta:#282828;--suave:#504945;--tenue:#7c6f64;
    --verde:#427b58;--naranja:#af3a03}
  *{box-sizing:border-box;margin:0}
  body{background:var(--papel);color:var(--tinta);
    font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;padding:28px 20px 60px}
  .env{max-width:920px;margin:0 auto}
  h1{font-size:1.6rem;letter-spacing:-.02em;margin-bottom:6px}
  p{color:var(--suave);margin-bottom:14px;max-width:66ch}
  code{background:rgba(40,40,40,.08);padding:1px 5px;border-radius:4px;font-size:.85em}
  table{border-collapse:collapse;width:100%}
  tr{border-bottom:1px solid rgba(40,40,40,.12)}
  tr.no{opacity:.45}
  td{padding:12px 10px;vertical-align:middle}
  .ico{width:64px}
  .ico img{width:52px;height:52px;display:block}
  .nom b{display:block;font-size:15px}
  .nom span{font-size:11px;color:var(--tenue)}
  .poses{display:flex;gap:10px}
  .poses figure{margin:0;text-align:center}
  .poses img{width:64px;height:44px;object-fit:contain;display:block}
  .poses figcaption{font-size:10px;color:var(--tenue);font-family:monospace}
  .como{text-align:right;white-space:nowrap}
  .como .frec{display:block;font-size:11px;color:var(--tenue);margin-top:3px}
  .fuera{color:var(--naranja);font-size:11px;font-weight:700}
  .aviso{background:#f3d9cc;color:var(--naranja);border-radius:12px;padding:14px 16px;
    font-size:13px;line-height:1.6;margin:18px 0}
</style>
</head>
<body>
<div class="env">
  <h1>Estados del tiempo — íconos y sus poses</h1>
  <p>Los ${mapa.estados.length} del mapa, cada uno con las dos poses que le asignaste. En el
  sitio se alternan por día, así que conviene que las dos funcionen igual de bien.
  <b>${computables} de ${mapa.estados.length}</b> se pueden calcular con datos que ya pedimos o
  que salen en la misma llamada; los apagados no.</p>

  <div class="aviso"><b>Falta la noche.</b> Los 20 son diurnos, y el 44 % de las horas de la
  tira son nocturnas. Con dos lunas —<code>despejado</code> y <code>sol-con-nube</code>— queda
  cubierto lo grueso: los otros catorce se ven igual de noche que de día.</div>

  <table><tbody>${mapa.estados.map(fila).join('')}</tbody></table>
</div>
</body>
</html>
`);
console.log(`diseno/hoja-clima.html — ${mapa.estados.length} estados, ${computables} computables`);
