#!/usr/bin/env python3
"""Arma una tira horizontal de cuadros por cada estado del tiempo.

    python3 armar-tiras.py

Una tira por estado significa un solo request, y la animación la hace CSS moviendo
background-position con steps(): cortes secos como el stop motion, corriendo en el
compositor del navegador sin tocar JavaScript ni temporizadores.

Los cuadros salen de las dos láminas de Mamushka. Se eligieron por lo que la pose dice:
las siluetas de Vecteezy no sirven acá porque son 54 gatos distintos, no una secuencia.
"""
from PIL import Image
import os, json

BASE = "/home/seb/clima-chile/"
CUADROS = BASE + "sitio/gatos/"
SALIDA = BASE + "sitio/tiras/"
ALTO = 220                      # 2x del tamaño en pantalla, para pantallas retina

# estado -> cuadros del ciclo. Se repiten a propósito para que el ciclo respire
# en vez de saltar de vuelta al inicio.
CICLOS = {
    "sol":     ["mamushka2-09", "mamushka2-10", "mamushka2-11", "mamushka2-10"],
    "nublado": ["mamushka2-02", "mamushka2-03", "mamushka2-04", "mamushka2-05"],
    "lluvia":  ["mamushka2-13", "mamushka2-14", "mamushka2-15", "mamushka2-14"],
    "frio":    ["mamushka1-07", "mamushka1-11", "mamushka1-12", "mamushka1-11"],
    "calor":   ["mamushka1-01", "mamushka1-02", "mamushka1-03", "mamushka1-02"],
    "noche":   ["mamushka2-18", "mamushka2-19", "mamushka2-20", "mamushka2-19"],
}

os.makedirs(SALIDA, exist_ok=True)

def cargar(nombre):
    im = Image.open(CUADROS + nombre + ".webp").convert("RGBA")
    if im.height != ALTO:
        im.thumbnail((10000, ALTO), Image.LANCZOS)
    return im

# Todas las tiras comparten el mismo tamaño de celda: así el CSS usa un solo
# background-size y las poses no saltan de tamaño entre estados.
todos = {n: cargar(n) for n in {c for cs in CICLOS.values() for c in cs}}
CELDA_AN = max(i.width for i in todos.values())
CELDA_AL = max(i.height for i in todos.values())

meta = {"celda": [CELDA_AN, CELDA_AL], "estados": {}}
for estado, ciclo in CICLOS.items():
    tira = Image.new("RGBA", (CELDA_AN * len(ciclo), CELDA_AL), (0, 0, 0, 0))
    for k, nombre in enumerate(ciclo):
        im = todos[nombre]
        # abajo y centrado: el gato queda "apoyado" en la misma línea en todos los cuadros
        tira.paste(im, (k * CELDA_AN + (CELDA_AN - im.width) // 2, CELDA_AL - im.height), im)
    ruta = SALIDA + estado + ".webp"
    tira.save(ruta, "WEBP", quality=84, method=6)
    meta["estados"][estado] = {"cuadros": len(ciclo), "peso": os.path.getsize(ruta)}
    print("%-8s %d cuadros  %4dx%-4d  %5.1f KB"
          % (estado, len(ciclo), tira.width, tira.height, os.path.getsize(ruta) / 1024))

json.dump(meta, open(SALIDA + "meta.json", "w"), indent=2)
print("\ncelda: %dx%d" % (CELDA_AN, CELDA_AL))
print("total: %.1f KB (solo se baja la del estado actual)"
      % (sum(e["peso"] for e in meta["estados"].values()) / 1024))
