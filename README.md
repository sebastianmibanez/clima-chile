# clima-chile

Sitio del tiempo para Chile. Núcleo: Santiago y sus comunas; después capitales regionales.

Plan y contexto: `../adsense/PLAN-SITIO-CLIMA.md` y `../adsense/ESTRATEGIA.md`.

## Estado

**Fase 0, validando la premisa. Sin sitio, sin dominio, sin código de producto.**

La pregunta que decide el proyecto: *¿podemos pronosticar mejor que Meteored?* La vía propuesta es
corregir el sesgo sistemático de los modelos globales con historial local (MOS) y promediarlos.

## Arquitectura: sin base de datos

```
Máquina local (semanal o mensual)          Hosting estático        Navegador
─────────────────────────────────          ────────────────        ─────────
bajar archivo nuevo (DMC + Open-Meteo)
recalcular tablas de calibración     →     calibracion/*.json  →   aplica las tablas
git push                                   index.html              sobre el pronóstico
                                                                   del día (Open-Meteo)
```

Nada corriendo 24/7, nada que expire, costo cero fuera del dominio.

**Por qué no Postgres:** la ruta de request no consulta nada — el sitio sirve dos JSON estáticos.
El archivo histórico es append-only y lo lee un proceso por lotes una vez al mes; hoy son 15 MB
comprimidos para 124 meses. Eso son archivos, no una base de datos. Además el Postgres gratis de
Render [expira a los 30 días](https://render.com/changelog/free-postgresql-instances-now-expire-after-30-days-previously-90)
y borra los datos, que es lo contrario de lo que necesita un proyecto cuyo valor se acumula.

Si se usa Render, que sea **Static Site** (gratis, por CDN, no se duerme). Los *web services*
gratis se apagan a los 15 min y arrancan en 30–60 s, incompatible con Core Web Vitals.

Postgres tendría sentido recién cuando exista una ruta de consulta real — filtrar el marcador de
aciertos por estación, modelo y fecha arbitrarias. Eso es Fase 2 con tráfico, y para entonces el
proyecto debería pagar su propia infraestructura.

## Scripts

```
node estaciones.mjs                 qué estación EMA de la DMC le toca a cada comuna
node validar-sesgo.mjs              validación completa (cachea en datos/, ~10 min la 1ª vez)
node validar-sesgo.mjs --test       auto-chequeo con sesgo sintético
node dmc.mjs                        estaciones configuradas
DMC_USUARIO=... DMC_TOKEN=... node dmc.mjs 330020 2024 7
```

Sin dependencias. `http.mjs` usa curl como transporte porque undici corta la conexión a los 10 s
y estos servidores tardan más.

## Estaciones EMA por comuna

Catálogo DMC: 148 estaciones, 18 en la Región Metropolitana. El catálogo es **abierto**;
los datos exigen usuario + token (registro gratis en climatologia.meteochile.gob.cl).

| Comuna | Estación | Código | Dist | Δalt |
|---|---|---|---|---|
| Quinta Normal | Quinta Normal, Santiago | 330020 | 0,0 km | −3 m |
| La Florida | Aguas Andinas, La Florida | 330122 | 3,5 km | +32 m |
| Puente Alto | Aguas Andinas, La Florida | 330122 | 7,8 km | −25 m |
| Renca | San Pablo - DASA | 330114 | 4,7 km | −4 m |
| Colina | Lo Pinto | 330118 | 9,1 km | −84 m |

Dos cosas: **Puente Alto y La Florida comparten estación**, así que no son verificables por
separado. Y Colina usa Lo Pinto en vez de la estación "Colina (Reg.)", más cercana (5,3 km) pero
159 m más alta, lo que metía ~1 °C de sesgo puro de altitud.

## Resultado, corrida 2026-08-17 · referencia DMC (observación real)

MAE en °C a 24 h. Entrena 2024–2025, evalúa 2026-01→07, que el ajuste nunca vio.
Pesos del ensamble ajustados solo con entrenamiento.

| Comuna | horas obs | mejor modelo solo | ensamble simple | ensamble ponderado |
|---|---|---|---|---|
| Quinta Normal | 22.626 | **1,31** (ECMWF) | 1,38 | 1,35 |
| La Florida | 15.576 | 1,31 (ICON) | 1,18 | **1,13** |
| Puente Alto | 15.576 | 1,23 (ICON) | 1,26 | **1,18** |
| Renca | 22.162 | **1,31** (ECMWF) | 1,44 | 1,42 |
| Colina | 22.217 | 1,76 (ECMWF) | 1,59 | **1,58** |

### Qué cambió al pasar de ERA5 a observación real

1. **La circularidad era real.** ECMWF crudo en Quinta Normal pasa de 1,40 °C (ERA5) a 1,61 °C
   (estación). ERA5 lo favorecía por ser producto de la misma casa. Y por eso mismo la corrección
   ahora le sirve mucho más: 19 % de mejora contra el 4 % que aparentaba.

2. **El mejor modelo cambia según la comuna.** ECMWF gana en Quinta Normal, Renca y Colina;
   ICON gana en La Florida y Puente Alto. No hay un "mejor modelo" global — hay uno por punto,
   y eso solo se sabe midiendo localmente.

3. **El ensamble simple no es la respuesta.** Gana en 2 de 5 comunas y pierde en 3. Donde ECMWF
   corregido es muy superior al resto (Quinta Normal, Renca), promediar parejo lo diluye.
   Esto confirma la advertencia que ya estaba en `IDEA-CLIMA-CHILE.md`: promediar no es
   automáticamente mejor.

4. **El ponderado por 1/MSE gana siempre al simple**, en las cinco, pero por poco (0,01–0,08 °C).
   Le gana al mejor modelo solo en 3 de 5. La ponderación por MSE ignora que los modelos están
   correlacionados entre sí; ajustar los pesos por mínimos cuadrados debería separar más.

### Lo que sigue sin estar probado

**Que le ganemos a Meteored.** Tenemos un pronóstico calibrado por comuna con 1,13–1,58 °C de error
a 24 h, que es un buen número. Pero no hemos medido el de ellos, así que la frase "acertamos más"
sigue sin respaldo. Eso exige el registrador de competidores, que es la única pieza atada al
calendario.

Lo que **sí** es defendible hoy: calibración por comuna contra estación local (un proveedor global
sirve una celda genérica de 25 km), medición honesta publicada, y degradación por horizonte a la vista.

## Resultado anterior, 2026-08-16 · referencia ERA5-Land

Entrena 2024-01-01 → 2025-12-31. Evalúa 2026-01-01 → 2026-07-31, que el ajuste nunca vio.
MAE en °C a 24 h de anticipación.

| Comuna | ECMWF crudo | mejor crudo | mejor corregido | **ENSAMBLE** |
|---|---|---|---|---|
| Quinta Normal | 1,40 | 1,40 | 1,35 | **1,16** |
| La Florida | 3,65 | 1,96 | 1,49 | **1,21** |
| Puente Alto | 3,69 | 2,00 | 1,50 | **1,25** |
| Renca | 1,40 | 1,40 | 1,33 | **1,26** |
| Colina | 1,82 | 1,82 | 1,44 | **1,35** |

**El ensamble de los cuatro modelos corregidos gana en las cinco comunas**, entre 6 % y 19 % sobre
el mejor modelo individual corregido, y entre 17 % y 38 % sobre el mejor modelo crudo. Se sostiene
a 3 y 7 días (ver `salida-5comunas.txt`).

Eso valida la tesis: **corregir no sirve para superar a ECMWF, sirve para nivelar los modelos y
poder promediarlos.** Sin corregir, un modelo con +3 °C de sesgo envenena el promedio.

### Los tres asteriscos

1. **Parte de la mejora es desnivel de grilla, no pericia.** ECMWF marca 3,65 °C en La Florida y
   1,40 °C en Quinta Normal. Eso no es que pronostique peor en La Florida: es que su celda de
   25 km tiene una altitud media distinta a la del punto. El sesgo casi constante que la corrección
   elimina ahí es geometría, no meteorología. Contra estación real el cuadro va a cambiar.

2. **La corrección no es gratis.** En 19 de 20 casos mejora; en uno (ICON en Renca) empeora,
   1,88 → 2,10. Hace falta un guardarraíl: aplicar la corrección solo si mejora en una rebanada
   de validación, no a ciegas.

3. **Hay piso, y estamos cerca.** Después de corregir, todo converge a 1,33–1,89 °C a 24 h sin
   importar de dónde partió. Eso es aproximadamente el estado del arte. El ensamble a 1,16–1,35 °C
   está cerca del límite alcanzable, así que **no esperar una ventaja gigante en temperatura contra
   Meteored.** La diferenciación tendrá que venir de otra parte: hora de la lluvia, incertidumbre
   honesta, resolución por comuna.

### La objeción que sigue abierta

**ERA5 es un producto de ECMWF.** Misma física, mismo esquema de superficie. Medir ECMWF contra ERA5
lo favorece, y no sabemos cuánto. Contra observación EMA real los números van a moverse — sobre todo
los de ECMWF y los de La Florida y Puente Alto.

`dmc.mjs` ya está listo para eso. Falta el token.

## Pendientes de Fase 0

- [x] ~~Token de la DMC y validación contra observación real~~
- [x] ~~Ponderar el ensamble por desempeño~~ (1/MSE; gana al simple siempre, por poco)
- [ ] **Pesos por mínimos cuadrados** en vez de 1/MSE — debería descartar modelos redundantes
- [ ] **Guardarraíl**: no aplicar corrección donde empeora. ICON en Renca va de 2,13 a 2,19,
      y es consistente entre ERA5 y DMC, así que es real y no ruido
- [ ] Elegir por comuna entre "mejor modelo solo" y "ensamble", según entrenamiento
- [ ] Huecos de datos: la estación 330122 no tiene abr–jul 2025 (8 meses vacíos en total).
      Falta un invierno de entrenamiento en La Florida y Puente Alto
- [ ] Extender a lluvia (acierto/falsa alarma, Brier) — hoy solo temperatura
- [ ] Recolector de competidores (AccuWeather API free; Meteored sin API gratuita)

Solo lo último necesita empezar por calendario: el pronóstico pasado de la competencia no se puede
recuperar hacia atrás. Todo el resto sale del archivo.

## Ideas de producto (Fase 3, no antes)

- **Identidad visual con gatitos.** Look & feel felino en la interfaz diaria: estados del tiempo
  ilustrados con gatos (gato mojado = lluvia, gato estirado al sol = despejado, gato hecho bolita =
  frío). Busca ser memorable y compartible, que es justo la debilidad del proyecto: no tenemos
  plan de adquisición más allá del SEO, y una interfaz que la gente pantallazea sí es distribución.

  Precedente real: CARROT Weather construyó un negocio entero sobre personalidad, no sobre precisión.

  Tres condiciones para que no se dé vuelta en contra:
  1. **No en las páginas de datos.** El marcador de aciertos y la metodología van sobrios. Un
     estudio de verificación firmado por un gato no lo cita nadie, y esa credibilidad es el foso.
  2. **SVG o CSS, no fotos.** El `CLAUDE.md` del proyecto pone Core Web Vitals como prioridad
     absoluta. Ilustración vectorial pesa kilobytes; fotos de gatos matan el LCP.
  3. **Ilustración propia o con licencia clara.** Ni fotos tomadas de internet ni imágenes
     generadas genéricas, que en 2026 se leen como bajo esfuerzo.

## Fuentes

- Modelos y ERA5-Land: [Open-Meteo](https://open-meteo.com) — datos CC BY 4.0. La API gratuita es
  solo para uso no comercial; resolver antes de monetizar.
- Observación y catálogo de estaciones: Dirección Meteorológica de Chile (DMC).
