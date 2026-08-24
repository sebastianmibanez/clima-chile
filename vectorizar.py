#!/usr/bin/env python3
"""Pasa a SVG un dibujo de colores planos: una imagen generada, no una foto.

    python3 vectorizar.py "nuevo vector de gato.png" gata.svg [colores] [epsilon]

Como el dibujo tiene bordes duros y pocos colores, no hace falta potrace: se reduce la
imagen a su paleta, se recorre el contorno de cada color por el borde de los pixeles y se
simplifica la escalera resultante con Douglas-Peucker. Las puas del pelaje son esquinas de
verdad, asi que sobreviven; una foto en cambio saldria como un mapa de manchas.
"""
from PIL import Image
from collections import Counter
import sys, math

ENTRADA = sys.argv[1] if len(sys.argv) > 1 else "nuevo vector de gato.png"
SALIDA = sys.argv[2] if len(sys.argv) > 2 else "gata.svg"
COLORES = int(sys.argv[3]) if len(sys.argv) > 3 else 8
EPSILON = float(sys.argv[4]) if len(sys.argv) > 4 else 1.2
AREA_MINIMA = 30          # bajo esto es basura de compresion, no una pieza del dibujo

im = Image.open(ENTRADA).convert("RGB")
W, H = im.size
px = list(im.getdata())

# ---- paleta ----
# Cuantizar por area no sirve: el ojo y la nariz son chicos y se los come. Como el dibujo
# es plano, la paleta son directamente los colores mas frecuentes, saltandose los que son
# el mismo color con ruido de compresion. El piso de pixeles descarta el antialias.
PISO = 100
cuenta = Counter(((r >> 3) << 3, (g >> 3) << 3, (b >> 3) << 3) for r, g, b in px)
paleta = []
for c, n in cuenta.most_common():
    if n < PISO or len(paleta) >= COLORES:
        break
    if not any(sum((a - b) ** 2 for a, b in zip(c, o)) < 420 for o in paleta):
        paleta.append(c)

def cerca(p):
    return min(range(len(paleta)),
               key=lambda i: sum((a - b) ** 2 for a, b in zip(p, paleta[i])))

cache = {}
idx = bytearray(W * H)
for i, p in enumerate(px):
    j = cache.get(p)
    if j is None:
        j = cache[p] = cerca(p)
    idx[i] = j

# El fondo es el color que toca las cuatro esquinas.
fondo = idx[0]

# ---- contornos: aristas dirigidas con el relleno siempre a la derecha ----
def contornos(marca):
    dentro = lambda x, y: 0 <= x < W and 0 <= y < H and marca[y * W + x]
    aristas = {}
    for y in range(H):
        fila = y * W
        for x in range(W):
            if not marca[fila + x]:
                continue
            if not dentro(x, y - 1): aristas.setdefault((x, y), []).append((x + 1, y))
            if not dentro(x + 1, y): aristas.setdefault((x + 1, y), []).append((x + 1, y + 1))
            if not dentro(x, y + 1): aristas.setdefault((x + 1, y + 1), []).append((x, y + 1))
            if not dentro(x - 1, y): aristas.setdefault((x, y + 1), []).append((x, y))
    lazos = []
    while aristas:
        inicio = next(iter(aristas))
        lazo, actual = [inicio], inicio
        while True:
            salidas = aristas.get(actual)
            if not salidas:
                break
            siguiente = salidas.pop()
            if not salidas:
                del aristas[actual]
            lazo.append(siguiente)
            actual = siguiente
            if actual == inicio:
                break
        if len(lazo) > 3:
            lazos.append(lazo)
    return lazos

def area(p):
    s = 0
    for i in range(len(p)):
        x1, y1 = p[i]; x2, y2 = p[(i + 1) % len(p)]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2

# ---- Douglas-Peucker: la escalera de pixeles vuelve a ser una diagonal ----
def simplificar(p, eps):
    if len(p) < 3:
        return p
    a, b = p[0], p[-1]
    dx, dy = b[0] - a[0], b[1] - a[1]
    largo = math.hypot(dx, dy)
    peor, donde = 0.0, 0
    for i in range(1, len(p) - 1):
        q = p[i]
        d = (abs(dy * q[0] - dx * q[1] + b[0] * a[1] - b[1] * a[0]) / largo) if largo \
            else math.hypot(q[0] - a[0], q[1] - a[1])
        if d > peor:
            peor, donde = d, i
    if peor > eps:
        return simplificar(p[:donde + 1], eps)[:-1] + simplificar(p[donde:], eps)
    return [a, b]

sys.setrecursionlimit(20000)
piezas, caja = [], [W, H, 0, 0]
for i, color in enumerate(paleta):
    if i == fondo:
        continue
    marca = bytearray(1 if v == i else 0 for v in idx)
    lazos = [l for l in contornos(marca) if area(l) >= AREA_MINIMA]
    if not lazos:
        continue
    d = []
    for lazo in lazos:
        s = simplificar(lazo, EPSILON)
        if len(s) < 3:
            continue
        d.append("M" + " ".join("%g %g" % q for q in s) + "Z")
        for x, y in s:
            caja = [min(caja[0], x), min(caja[1], y), max(caja[2], x), max(caja[3], y)]
    piezas.append((color, " ".join(d), sum(area(l) for l in lazos)))

piezas.sort(key=lambda p: -p[2])          # lo grande abajo, lo chico encima
x0, y0, x1, y1 = caja
cuerpo = "\n".join('  <path fill="#%02x%02x%02x" fill-rule="evenodd" d="%s"/>' % (c[0], c[1], c[2], d)
                   for c, d, _ in piezas)
svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="%g %g %g %g" width="%g" height="%g">\n%s\n</svg>\n'
       % (x0, y0, x1 - x0, y1 - y0, x1 - x0, y1 - y0, cuerpo))
open(SALIDA, "w").write(svg)

print("%s: %d piezas, %d colores, %.1f KB" % (SALIDA, len(piezas), len(paleta), len(svg) / 1024))
for c, d, a in piezas:
    print("  #%02x%02x%02x  %7.0f px2  %5.1f KB" % (c[0], c[1], c[2], a, len(d) / 1024))
