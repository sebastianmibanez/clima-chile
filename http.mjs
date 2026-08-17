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
    let txt;
    try {
      txt = execFileSync('curl', ['-sL', '--fail', '-m', String(timeout), url], {
        encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
      });
    } catch (e) {                       // falla de red: reintentar sirve
      ultimo = e;
      if (i < reintentos) execFileSync('sleep', [String(2 * i)]);
      continue;
    }
    // El servidor contestó. Si lo que mandó no es JSON, reintentar no lo va a arreglar:
    // la DMC responde "Sin Información" en texto plano para los meses que no tiene.
    let j;
    try { j = JSON.parse(txt); }
    catch { throw new Error(txt.trim().slice(0, 60) || 'respuesta vacía'); }
    if (j.error) throw new Error(j.reason ?? 'error de la API');
    return j;
  }
  throw new Error(`${url.slice(0, 90)}… → ${ultimo.message}`);
}
