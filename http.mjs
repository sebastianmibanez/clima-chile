// Transporte único para todos los scripts.
//
// Se usa curl en vez de fetch porque undici corta la conexión a los 10 s y tanto la DMC
// como Open-Meteo pasan de eso con rangos de fechas largos. El timeout de curl es
// configurable; el de undici no, sin traer un dispatcher.
// ponytail: curl por proceso; si algún día hay que paralelizar cientos de requests,
// cambiar a undici con Agent({ connect: { timeout } }).

import { execFileSync } from 'node:child_process';

export function getJSON(url, { timeout = 180, reintentos = 3 } = {}) {
  let ultimo;
  for (let i = 1; i <= reintentos; i++) {
    try {
      const txt = execFileSync('curl', ['-sL', '--fail', '-m', String(timeout), url], {
        encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
      });
      const j = JSON.parse(txt);
      if (j.error) throw new Error(j.reason ?? 'error de la API');
      return j;
    } catch (e) {
      ultimo = e;
      if (i < reintentos) execFileSync('sleep', [String(2 * i)]);
    }
  }
  throw new Error(`${url.slice(0, 90)}… → ${ultimo.message}`);
}
