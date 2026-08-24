// Caja delimitadora de un path de potrace: M absoluto y c/l relativos.
// Recorre el path acumulando posición; los puntos de control de las curvas entran en la
// caja, así que la sobreestima un poco, que es el lado seguro para no cortar una oreja.
export function caja(d) {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?[\d.]+/g) ?? [];
  let x = 0, y = 0, ix = 0, iy = 0, cmd = '';
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const ver = (px, py) => {
    minX = Math.min(minX, px); maxX = Math.max(maxX, px);
    minY = Math.min(minY, py); maxY = Math.max(maxY, py);
  };
  for (let i = 0; i < tokens.length;) {
    if (/[A-Za-z]/.test(tokens[i])) { cmd = tokens[i++]; }
    if (cmd === 'Z' || cmd === 'z') { x = ix; y = iy; continue; }
    const n = { M: 2, m: 2, L: 2, l: 2, C: 6, c: 6, H: 1, h: 1, V: 1, v: 1 }[cmd] ?? 2;
    const args = tokens.slice(i, i + n).map(Number);
    if (args.length < n) break;
    i += n;
    const rel = cmd === cmd.toLowerCase();
    if (cmd === 'H' || cmd === 'h') { x = rel ? x + args[0] : args[0]; ver(x, y); }
    else if (cmd === 'V' || cmd === 'v') { y = rel ? y + args[0] : args[0]; ver(x, y); }
    else for (let k = 0; k + 1 < args.length; k += 2) {
      const px = rel ? x + args[k] : args[k];
      const py = rel ? y + args[k + 1] : args[k + 1];
      ver(px, py);
      if (k + 2 >= args.length) { x = px; y = py; }   // el último par es el punto nuevo
    }
    if (cmd === 'M' || cmd === 'm') { ix = x; iy = y; cmd = rel ? 'l' : 'L'; }
  }
  return { minX, minY, maxX, maxY };
}
