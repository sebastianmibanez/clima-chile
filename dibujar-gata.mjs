#!/usr/bin/env node
// Dibuja a Mamushka con piezas: óvalo de cuerpo, cabeza de dos círculos en pera, y el
// pelaje como púas — triangulitos como orejas chicas — pegados al borde de cada pieza.
//
//   node dibujar-gata.mjs > gata.svg
//
// Nada de calcar: todo es paramétrico. Cambiar una pose es cambiar ángulos, y el largo o
// la cantidad de púas se toca en un número, no redibujando.

const GRIS = '#8b96a4', CLARO = '#e9eef3', LEJOS = '#aeb8c4';
const OSCURO = '#2b3138', ROSA = '#c9a8ab', HOCICO = '#c98d94';

// Ruido repetible: las púas necesitan variar de largo o parecen un peine.
const azar = (s => () => (s = s * 1664525 + 1013904223 >>> 0) / 4294967296)(7);
const n = v => Math.round(v * 10) / 10;

// Púas a lo largo de un arco de elipse. El triángulo apoya su base en el borde y apunta
// hacia afuera por la normal, que es lo que hace que se lean como mechones y no como pinches.
function puas({ cx, cy, rx, ry, desde, hasta, largo, ancho, fill, variacion = .45 }) {
  const arco = (Math.abs(hasta - desde) * (rx + ry)) / 2;
  const cuantas = Math.max(2, Math.round(arco / (ancho * .72)));
  const salida = [];
  for (let i = 0; i < cuantas; i++) {
    const t = desde + (hasta - desde) * (i / (cuantas - 1));
    const px = cx + rx * Math.cos(t), py = cy + ry * Math.sin(t);
    let ex = Math.cos(t) / rx, ey = Math.sin(t) / ry;          // normal de la elipse
    const m = Math.hypot(ex, ey); ex /= m; ey /= m;
    const tx = -ey, ty = ex;                                    // tangente
    const L = largo * (1 - variacion / 2 + azar() * variacion);
    const a = ancho / 2;
    salida.push(`<path d="M${n(px + tx * a)} ${n(py + ty * a)}`
      + `L${n(px + ex * L)} ${n(py + ey * L)}`
      + `L${n(px - tx * a)} ${n(py - ty * a)}Z" fill="${fill}"/>`);
  }
  return salida.join('');
}

// Lo mismo pero a lo largo de una curva: la cola no es una elipse. `lado` dice hacia qué
// costado salen las púas, así se peina por los dos.
function puasCurva({ p, lado, largo, ancho, fill, variacion = .45 }) {
  const en = t => {
    const u = 1 - t;
    return [u * u * u * p[0] + 3 * u * u * t * p[2] + 3 * u * t * t * p[4] + t * t * t * p[6],
            u * u * u * p[1] + 3 * u * u * t * p[3] + 3 * u * t * t * p[5] + t * t * t * p[7]];
  };
  let largoTotal = 0, previo = en(0);
  for (let i = 1; i <= 20; i++) {
    const q = en(i / 20);
    largoTotal += Math.hypot(q[0] - previo[0], q[1] - previo[1]);
    previo = q;
  }
  const cuantas = Math.max(2, Math.round(largoTotal / (ancho * .72)));
  const salida = [];
  for (let i = 0; i < cuantas; i++) {
    const t = i / (cuantas - 1);
    const [px, py] = en(t), [qx, qy] = en(Math.min(1, t + .01));
    let tx = qx - px, ty = qy - py;
    const m = Math.hypot(tx, ty) || 1; tx /= m; ty /= m;
    const ex = -ty * lado, ey = tx * lado;
    const L = largo * (1 - variacion / 2 + azar() * variacion), a = ancho / 2;
    salida.push(`<path d="M${n(px + tx * a)} ${n(py + ty * a)}`
      + `L${n(px + ex * L)} ${n(py + ey * L)}`
      + `L${n(px - tx * a)} ${n(py - ty * a)}Z" fill="${fill}"/>`);
  }
  return salida.join('');
}

const G = Math.PI / 180;
const COLA = [48, 108, 26, 98, 12, 72, 18, 40];
const gata = `
  <ellipse cx="118" cy="188" rx="62" ry="6" fill="rgba(20,30,45,.18)"/>

  <!-- patas del lado lejano -->
  <g class="muslo" style="transform-origin:68px 124px;animation-delay:calc(var(--c)/-2)">
    <path d="M68 122 L 76 146" stroke="${LEJOS}" stroke-width="17" stroke-linecap="round" fill="none"/>
    <g class="pantorrilla" style="transform-origin:76px 146px;animation-delay:calc(var(--c)/-2)">
      <path d="M76 146 L 66 176" stroke="${LEJOS}" stroke-width="12" stroke-linecap="round" fill="none"/>
      <ellipse cx="65" cy="179" rx="8" ry="5" fill="${LEJOS}"/>
    </g>
  </g>
  <g class="muslo" style="transform-origin:148px 126px">
    <path d="M148 124 L 150 148" stroke="${LEJOS}" stroke-width="15" stroke-linecap="round" fill="none"/>
    <g class="pantorrilla" style="transform-origin:150px 148px">
      <path d="M150 148 L 149 176" stroke="${LEJOS}" stroke-width="11" stroke-linecap="round" fill="none"/>
      <ellipse cx="150" cy="179" rx="7.5" ry="5" fill="${LEJOS}"/>
    </g>
  </g>

  <!-- cola: mota de pelo con púas alrededor -->
  <g class="cola" style="transform-origin:48px 108px">
    ${puasCurva({ p: COLA, lado: 1, largo: 15, ancho: 9, fill: GRIS })}
    ${puasCurva({ p: COLA, lado: -1, largo: 15, ancho: 9, fill: GRIS })}
    <path d="M48 108 C 26 98 12 72 18 40" stroke="${GRIS}" stroke-width="22" stroke-linecap="round" fill="none"/>
  </g>

  <g class="tronco">
    <!-- el potito: donde le cuelga la mota -->
    ${puas({ cx: 72, cy: 116, rx: 44, ry: 42, desde: 100 * G, hasta: 230 * G, largo: 15, ancho: 11, fill: GRIS })}
    <!-- lomo -->
    ${puas({ cx: 118, cy: 118, rx: 62, ry: 40, desde: 185 * G, hasta: 355 * G, largo: 11, ancho: 10, fill: GRIS })}
    <circle cx="72" cy="116" r="44" fill="${GRIS}"/>
    <ellipse cx="118" cy="118" rx="62" ry="40" fill="${GRIS}"/>
    <!-- panza y pecho, con las púas colgando hacia abajo -->
    ${puas({ cx: 116, cy: 132, rx: 56, ry: 27, desde: 15 * G, hasta: 168 * G, largo: 13, ancho: 10, fill: CLARO })}
    <ellipse cx="116" cy="132" rx="56" ry="27" fill="${CLARO}"/>
    <circle cx="156" cy="118" r="30" fill="${CLARO}"/>

    <!-- patas del lado cercano -->
    <g class="muslo" style="transform-origin:86px 124px">
      <path d="M86 122 L 94 146" stroke="${CLARO}" stroke-width="19" stroke-linecap="round" fill="none"/>
      <g class="pantorrilla" style="transform-origin:94px 146px">
        <path d="M94 146 L 83 176" stroke="${CLARO}" stroke-width="13" stroke-linecap="round" fill="none"/>
        <ellipse cx="82" cy="179" rx="8.5" ry="5.5" fill="${CLARO}"/>
      </g>
    </g>
    <g class="muslo" style="transform-origin:166px 126px;animation-delay:calc(var(--c)/-2)">
      <path d="M166 124 L 168 148" stroke="${CLARO}" stroke-width="17" stroke-linecap="round" fill="none"/>
      <g class="pantorrilla" style="transform-origin:168px 148px;animation-delay:calc(var(--c)/-2)">
        <path d="M168 148 L 167 176" stroke="${CLARO}" stroke-width="12" stroke-linecap="round" fill="none"/>
        <ellipse cx="168" cy="179" rx="8" ry="5.5" fill="${CLARO}"/>
      </g>
    </g>

    <g class="craneo" style="transform-origin:186px 98px">
      <!-- gorguera: las púas de abajo del cuello -->
      ${puas({ cx: 180, cy: 96, rx: 25, ry: 22, desde: 25 * G, hasta: 205 * G, largo: 16, ancho: 9, fill: CLARO })}
      <!-- orejas -->
      <path d="M176 52 L 172 22 L 196 40 Z" fill="${GRIS}"/>
      <path d="M180 48 L 178 30 L 193 42 Z" fill="${ROSA}"/>
      <path d="M208 38 L 225 20 L 225 48 Z" fill="${GRIS}"/>
      <path d="M211 40 L 222 28 L 222 45 Z" fill="${ROSA}"/>
      <!-- cara en pera: círculo chico arriba, grande abajo, y púas en los cachetes -->
      ${puas({ cx: 202, cy: 84, rx: 27, ry: 25, desde: 70 * G, hasta: 265 * G, largo: 13, ancho: 8, fill: CLARO })}
      ${puas({ cx: 200, cy: 58, rx: 20, ry: 19, desde: 175 * G, hasta: 255 * G, largo: 10, ancho: 7, fill: CLARO })}
      <circle cx="180" cy="96" r="25" fill="${CLARO}"/>
      <circle cx="200" cy="58" r="20" fill="${CLARO}"/>
      <circle cx="202" cy="84" r="27" fill="${CLARO}"/>
      <!-- gorro gris -->
      <path d="M184 42 C 202 34 220 44 224 64 C 208 58 190 54 184 42 Z" fill="${GRIS}"/>
      <ellipse cx="212" cy="84" rx="12" ry="9" fill="${CLARO}"/>
      <ellipse cx="194" cy="70" rx="3.6" ry="4.6" fill="${OSCURO}"/>
      <ellipse cx="213" cy="72" rx="3.6" ry="4.6" fill="${OSCURO}"/>
      <circle cx="195.2" cy="68.6" r="1.1" fill="#fff"/>
      <circle cx="214.2" cy="70.6" r="1.1" fill="#fff"/>
      <path d="M209 83 l6 0 l-3 4.5 Z" fill="${HOCICO}"/>
    </g>
  </g>`;

process.stdout.write(gata.trimEnd() + '\n');
