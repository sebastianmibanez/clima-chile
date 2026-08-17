# clima-chile

Sitio del tiempo para Chile. Núcleo: Santiago y sus comunas; después capitales regionales.

Plan y contexto: `../adsense/PLAN-SITIO-CLIMA.md` y `../adsense/ESTRATEGIA.md`.

## Estado

**Fase 0, validando la premisa. Sin sitio, sin dominio, sin código de producto.**

La pregunta que decide el proyecto: *¿podemos pronosticar mejor que Meteored?* La vía propuesta es
corregir el sesgo sistemático de los modelos globales con historial local (MOS) y promediarlos.

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

## Resultado, corrida 2026-08-16 · referencia ERA5-Land

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

- [ ] **Token de la DMC** → registrarse en climatologia.meteochile.gob.cl y repetir la tabla
      con `--ref=dmc`. Es lo que cierra la validación.
- [ ] Guardarraíl: no aplicar corrección donde empeora
- [ ] Ponderar el ensamble por desempeño en vez de promedio simple
- [ ] Extender a lluvia (acierto/falsa alarma, Brier) — hoy solo temperatura
- [ ] Recolector de competidores (AccuWeather API free; Meteored sin API gratuita)

Solo lo último necesita empezar por calendario: el pronóstico pasado de la competencia no se puede
recuperar hacia atrás. Todo el resto sale del archivo.

## Fuentes

- Modelos y ERA5-Land: [Open-Meteo](https://open-meteo.com) — datos CC BY 4.0. La API gratuita es
  solo para uso no comercial; resolver antes de monetizar.
- Observación y catálogo de estaciones: Dirección Meteorológica de Chile (DMC).
