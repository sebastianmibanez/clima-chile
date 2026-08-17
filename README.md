# clima-chile

Sitio del tiempo para Chile. Núcleo: Santiago y sus comunas; después capitales regionales.

Plan y contexto: `../adsense/PLAN-SITIO-CLIMA.md` y `../adsense/ESTRATEGIA.md`.

## Estado

**Fase 0, validando la premisa. Sin sitio, sin dominio, sin código de producto.**

La pregunta que decide el proyecto: *¿podemos pronosticar mejor que Meteored?* La vía propuesta es
corregir el sesgo sistemático de los modelos globales usando historial local (MOS). Este repo mide si
eso funciona antes de construir nada.

## `validar-sesgo.mjs`

```
node validar-sesgo.mjs          # validación completa (~15 requests, un par de minutos)
node validar-sesgo.mjs --test   # auto-chequeo con sesgo sintético
```

Baja pronósticos archivados de 4 modelos (Open-Meteo Previous Runs, desde 2024) + ERA5-Land como
referencia, ajusta la corrección de sesgo por mes y hora **solo con 2024–2025**, y la evalúa contra
2026, que nunca vio. Sin dependencias.

## Resultado, corrida 2026-08-16 — Quinta Normal

Entrena 2024-01-01 → 2025-12-31. Evalúa 2026-01-01 → 2026-07-31. n≈5.000 horas por celda.

| Modelo | MAE cruda 24 h | MAE corregida 24 h | Mejora | Sesgo medio |
|---|---|---|---|---|
| ECMWF IFS | 1,40 °C | 1,35 °C | 4 % | ~0,00 °C |
| GFS | 3,30 °C | **1,36 °C** | **59 %** | **+3,23 °C** |
| ICON | 1,87 °C | 1,61 °C | 14 % | +0,43 °C |
| GEM | 1,72 °C | 1,37 °C | 20 % | +0,77 °C |

Degradación por horizonte, como se esperaba: ECMWF pasa de 1,40 °C a 24 h a 2,00 °C a 7 días.

### Lo que dice

1. **La corrección de sesgo es real y grande para GFS, GEM e ICON.** GFS arrastra un sesgo cálido casi
   constante de +3,2 °C que la corrección elimina, dejándolo a la par de ECMWF.
2. **Para ECMWF no hay casi nada que corregir.** Su sesgo medio es cero y la mejora es 4 %.
3. **Por lo tanto la corrección no le gana al mejor modelo crudo.** GFS corregido (1,36) empata con
   ECMWF crudo (1,40). El valor de la corrección no es superar a ECMWF: es **nivelar los cuatro
   modelos para que promediarlos tenga sentido**. Sin corregir, GFS envenena cualquier promedio.

### La objeción que hay que resolver antes de creer esto

**ERA5 es un producto de ECMWF.** Misma física, mismo esquema de superficie. Que los pronósticos de
ECMWF salgan sin sesgo contra ERA5 es en parte circular, y probablemente infla su desempeño aparente.

Contra observación real de estación, ECMWF puede mostrar un sesgo que ERA5 esconde — y si lo muestra,
la conclusión 3 se da vuelta y la corrección sí abre ventaja.

**Ese es el próximo experimento y decide el proyecto:** repetir esta misma tabla usando la estación
EMA de la DMC en Quinta Normal como referencia, en vez de ERA5-Land.

## Pendientes de Fase 0

- [ ] **Repetir la validación contra observación EMA de la DMC** ← decide si el proyecto tiene base
- [ ] Probar si el promedio de los 4 modelos corregidos le gana a ECMWF corregido
- [ ] Extender a 4–5 puntos de Santiago con climas distintos (costa, valle, precordillera)
- [ ] Recolector de competidores (AccuWeather API free; Meteored sin API gratuita, sin resolver)

Solo lo último necesita empezar hoy por calendario: el pronóstico pasado de la competencia no se
puede recuperar hacia atrás. Todo lo demás sale del archivo.
