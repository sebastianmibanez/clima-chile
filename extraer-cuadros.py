#!/usr/bin/env python3
"""Recorta los cuadros de las laminas de Mamushka, les saca el fondo negro y los guarda
como WebP con transparencia.

    python3 extraer-cuadros.py

Las laminas traen el numero del cuadro arriba y un rotulo abajo, ambos en blanco. Como el
gato es calico y tambien tiene blanco, no sirve filtrar por color: se descartan quedandose
con la mancha conectada mas grande de cada celda, que siempre es el gato.
"""
from PIL import Image
from collections import deque
import os

BASE = "/home/seb/clima-chile/"
SALIDA = BASE + "sitio/gatos/"
COLS, FILAS = 5, 4
UMBRAL = 12          # bajo esta luminancia es fondo; las manchas del gato estan muy arriba
ALTO_SALIDA = 220

os.makedirs(SALIDA, exist_ok=True)

def mancha_mayor(mask, an, al):
    """BFS sobre la mascara binaria; devuelve el conjunto de indices de la mayor."""
    visto = bytearray(an * al)
    mejor = []
    for inicio in range(an * al):
        if mask[inicio] and not visto[inicio]:
            comp, cola = [], deque([inicio])
            visto[inicio] = 1
            while cola:
                p = cola.popleft(); comp.append(p)
                x, y = p % an, p // an
                for dx, dy in ((1,0),(-1,0),(0,1),(0,-1)):
                    nx, ny = x+dx, y+dy
                    if 0 <= nx < an and 0 <= ny < al:
                        q = ny*an + nx
                        if mask[q] and not visto[q]:
                            visto[q] = 1; cola.append(q)
            if len(comp) > len(mejor):
                mejor = comp
    return set(mejor)

def limpiar(celda):
    celda = celda.convert("RGBA")
    an, al = celda.size
    px = list(celda.getdata())
    mask = bytearray(1 if max(p[0], p[1], p[2]) >= UMBRAL else 0 for p in px)
    gato = mancha_mayor(mask, an, al)
    salida = []
    for i, (r, g, b, _) in enumerate(px):
        if i not in gato:
            salida.append((0, 0, 0, 0))
        else:
            v = max(r, g, b)
            a = 255 if v >= UMBRAL * 3 else int(255 * max(v - UMBRAL, 0) / (UMBRAL * 2))
            salida.append((r, g, b, a))
    celda.putdata(salida)
    return celda

def procesar(nombre):
    src = Image.open(BASE + "gatitos/" + nombre + ".jpeg")
    W, H = src.size
    cw, ch = W // COLS, H // FILAS
    total, hechos = 0, 0
    for i in range(COLS * FILAS):
        f, c = divmod(i, COLS)
        celda = limpiar(src.crop((c*cw, f*ch, (c+1)*cw, (f+1)*ch)))
        caja = celda.getbbox()
        if not caja:
            continue
        gato = celda.crop(caja)
        gato.thumbnail((10000, ALTO_SALIDA), Image.LANCZOS)
        ruta = SALIDA + "%s-%02d.webp" % (nombre, i + 1)
        gato.save(ruta, "WEBP", quality=84, method=6)
        total += os.path.getsize(ruta); hechos += 1
    print("%s: %d cuadros, %.1f KB (%.1f KB promedio)"
          % (nombre, hechos, total/1024, total/1024/max(hechos, 1)))

for n in ("mamushka1", "mamushka2"):
    procesar(n)
