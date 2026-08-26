// Lógica de pronóstico corregido. Módulo puro, sin DOM: lo importa la página y también
// prueba-calculo.mjs para verificarlo con node.

// Índice de la tabla de sesgo: (mes-1)*24 + hora local. Igual que en exportar-calibracion.mjs.
export const idx = (mes, hora) => (mes - 1) * 24 + hora;

// Open-Meteo entrega los tiempos como hora de pared de Santiago, sin sufijo de zona
// ("2026-08-17T09:00"). `new Date()` sobre eso lo interpreta en la zona del visitante, así
// que desde fuera de Chile el horizonte saldría corrido y se aplicaría la tabla equivocada.
// Todo se compara entonces en hora de pared de Santiago, sin pasar por la zona del navegador.
const fmtSantiago = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Santiago',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
});
export const ahoraEnSantiago = (d = new Date()) =>
  fmtSantiago.format(d).replace(' ', 'T').slice(0, 13) + ':00';

// Ambos son hora de pared, así que interpretarlos como UTC da la diferencia real entre ellos.
const comoUTC = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), +s.slice(11, 13));

// Días de anticipación de una hora del pronóstico. Las tablas se ajustaron por horizonte
// (1 a 7 días) porque el sesgo crece con la distancia; lo de hoy usa la tabla de 1 día.
export function horizonte(tiempoISO, ahora = ahoraEnSantiago()) {
  const dias = Math.ceil((comoUTC(tiempoISO) - comoUTC(ahora)) / 86400000);
  return Math.min(7, Math.max(1, dias));
}

// Temperatura corregida de un modelo: al valor crudo se le resta el sesgo que ese modelo
// arrastra en esa comuna, ese mes y esa hora.
export function corregir(cal, modelo, tiempoISO, valor, ahora) {
  const tabla = cal.sesgo?.[modelo]?.[horizonte(tiempoISO, ahora)];
  if (!tabla || valor == null) return valor;
  const mes = +tiempoISO.slice(5, 7), hora = +tiempoISO.slice(11, 13);
  return valor - (tabla[idx(mes, hora)] ?? 0);
}

// Ensamble ponderado. Los pesos vienen de 1/MSE medido contra la estación local, ya
// normalizados. Promediar parejo diluye al mejor modelo; por eso van ponderados.
// Sin pesos —cualquier punto de Chile que no sea una de las comunas calibradas— el
// promedio parejo es lo mejor disponible. Devolver null dejaba la página en blanco.
export function ensamble(cal, tiempoISO, porModelo, ahora) {
  const lead = horizonte(tiempoISO, ahora);
  let suma = 0, pesos = 0, crudo = 0, cuantos = 0;
  for (const [modelo, valor] of Object.entries(porModelo)) {
    if (valor == null) continue;
    const p = cal.pesos?.[modelo]?.[lead] ?? 0;
    suma += p * valor;
    pesos += p;
    crudo += valor;
    cuantos++;
  }
  if (pesos) return suma / pesos;
  return cuantos ? crudo / cuantos : null;
}

// Umbral único para los puntos sin calibrar. Es el mismo que usa exportar-calibracion.mjs
// como referencia antes de aprender uno por modelo.
export const UMBRAL_GENERICO_MM = 1.0;

// Probabilidad de lluvia del día. No sale de ningún modelo: sale de cuántos coinciden, y de
// lo que históricamente pasó en ESA comuna cuando coincidían esos. Cada modelo tiene su propio
// umbral de mm, aprendido del historial, porque todos exageran la llovizna en distinta medida.
//
// Sin historial local no hay nada que consultar: se vota con un umbral único y la
// probabilidad es la fracción de modelos que coinciden. Es notoriamente peor, así que
// `calibrada` sale en el resultado para que la página pueda decirlo en vez de disimularlo.
export function probabilidadLluvia(cal, mmPorModelo) {
  const umbrales = cal.lluvia?.umbralMm;
  const modelos = Object.keys(umbrales ?? mmPorModelo);
  if (!modelos.length) return null;

  const votan = modelos.filter(m =>
    (mmPorModelo[m] ?? 0) >= (umbrales?.[m] ?? UMBRAL_GENERICO_MM));
  const k = votan.length;
  const p = umbrales
    ? (cal.lluvia.prob?.[k] ?? cal.lluvia.climatologia ?? 0)
    : k / modelos.length;
  return { prob: p, acuerdo: k, total: modelos.length, votan, calibrada: !!umbrales };
}

// Códigos WMO que devuelve Open-Meteo, agrupados como los estados del mapa de diseño.
// El código dice QUÉ cae; la nubosidad, cuánto cielo hay tapado. Cada uno para lo suyo:
// el WMO aplasta el cielo en tres categorías y la nubosidad no sabe distinguir llovizna
// de lluvia. Medido sobre 1008 horas, el corte por nubosidad reparte 12-28 % por estado
// y el del WMO deja 31 % en "despejado".
function porCodigo(c) {
  if (c == null) return null;
  if (c === 45 || c === 48) return 'neblina';
  if (c >= 51 && c <= 57) return 'llovizna';
  if (c === 65 || c === 82) return 'lluvia-intensa';
  if ((c >= 61 && c <= 63) || (c >= 80 && c <= 81)) return 'lluvia';
  if (c === 66 || c === 67) return 'aguanieve';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'nieve';
  if (c === 95) return 'tormenta';
  if (c >= 96) return 'granizo';
  return null;   // 0..3 es cielo despejado o nublado: lo resuelve la nubosidad
}

// Corte de nubosidad de los cinco estados de cielo, en porcentaje tapado.
const CIELO = [[20, 'despejado'], [50, 'sol-con-nube'], [75, 'parcial-nublado'],
               [90, 'nublado'], [101, 'cubierto']];

// Qué gatito corresponde. Es una función pura de los datos, no un estado que haya que
// recordar: entra el pronóstico, sale el dibujo.
//
// El orden importa y no es alfabético: lo que cae del cielo gana sobre el estado del
// cielo, y los extremos de temperatura ganan sobre todo, porque una helada importa más
// que si está nublado. `viento` queda fuera a propósito: medido sobre 504 horas de tres
// comunas, sopla más de 20 km/h el 0 % del tiempo — Santiago es una cuenca.
export function estadoGato({ temp, nubes, codigo, prob, hora }) {
  if (temp != null && temp <= 0) return 'helada';
  if (temp != null && temp >= 32) return 'calor';

  const cae = porCodigo(codigo);
  if (cae) return cae;

  // Sin código WMO —datos viejos o una fuente que no lo trae— se cae al acuerdo entre
  // modelos, que es lo que la página usaba antes de que existieran estos estados.
  if (codigo == null && prob != null && prob >= 0.45) return 'lluvia';
  if (codigo == null && prob != null && prob >= 0.2) return 'llovizna';

  if (nubes != null) return CIELO.find(([techo]) => nubes < techo)[1];

  return 'despejado';
}

// Los nombres salen del mapa de diseño (sitio/clima/mapa.json), que es de donde también
// salen el ícono y las dos poses de cada estado.
export const TEXTO_ESTADO = {
  'despejado': 'Despejado', 'sol-con-nube': 'Sol con nube', 'parcial-nublado': 'Parcial nublado',
  'nublado': 'Nublado', 'cubierto': 'Cubierto', 'neblina': 'Neblina',
  'llovizna': 'Llovizna', 'lluvia': 'Lluvia', 'lluvia-intensa': 'Lluvia intensa',
  'tormenta': 'Tormenta', 'granizo': 'Granizo', 'nieve': 'Nieve', 'aguanieve': 'Aguanieve',
  'helada': 'Helada', 'calor': 'Calor', 'viento': 'Viento',
};

// Umbral por hora. 0,5 mm/h es el limite meteorologico entre llovizna y lluvia, y hace falta
// que sea tan alto: medido sobre 168 horas de Puente Alto, con 0,1 mm el 81 % de las horas
// marcaban lluvia porque los cuatro modelos lloviznan casi todo el tiempo. Con 0,5 baja a
// 48 % y recien ahi el numero distingue algo. Es el mismo vicio que la calibracion diaria
// corrige aprendiendo un umbral por modelo.
// ponytail: umbral unico; si algun dia hay historial horario contra la estacion, aprender
// uno por modelo como ya se hace con el diario.
export const UMBRAL_HORA_MM = 0.5;

// Humedad y viento no tienen tabla de sesgo: no los medimos contra la estación, así que no
// hay nada que restarles. Van como promedio parejo de los modelos que respondieron, y la
// página los rotula como del ensamble crudo para no venderlos como corregidos.
// Fraccion de modelos que ponen precipitacion en ESTA hora. No es una probabilidad
// calibrada: es cuantos coinciden, sin nada aprendido del historial local.
function acuerdoHorario(horario, modelos, i) {
  let llueve = 0, conDato = 0;
  for (const m of modelos) {
    const mm = horario[`precipitation_${m}`]?.[i];
    if (mm == null) continue;
    conDato++;
    if (mm >= UMBRAL_HORA_MM) llueve++;
  }
  return conDato ? llueve / conDato : null;
}

// Promediar códigos WMO daría un número sin significado —entre llovizna (51) y tormenta
// (95) no hay un "73" que quiera decir algo—, así que se vota.
function masVotado(horario, prefijo, modelos, i) {
  const votos = new Map();
  for (const m of modelos) {
    const v = horario[`${prefijo}_${m}`]?.[i];
    if (v == null) continue;
    votos.set(v, (votos.get(v) ?? 0) + 1);
  }
  if (!votos.size) return null;
  // Empate: gana el código más alto, que en la escala WMO es el tiempo más severo. Ante
  // la duda conviene avisar de más y no de menos.
  return [...votos].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}

function promedioCrudo(horario, prefijo, modelos, i) {
  let suma = 0, cuantos = 0;
  for (const m of modelos) {
    const v = horario[`${prefijo}_${m}`]?.[i];
    if (v == null) continue;
    suma += v; cuantos++;
  }
  return cuantos ? suma / cuantos : null;
}

// Agrupa el pronóstico horario en días, ya corregido y ensamblado.
export function porDia(cal, horario, modelos, ahora = ahoraEnSantiago()) {
  const dias = new Map();
  horario.time.forEach((t, i) => {
    const fecha = t.slice(0, 10);
    if (!dias.has(fecha)) dias.set(fecha, { fecha, horas: [], mm: {}, temps: [] });
    const dia = dias.get(fecha);

    const tempsCrudas = {}, tempsCorr = {};
    for (const m of modelos) {
      const v = horario[`temperature_2m_${m}`]?.[i];
      if (v == null) continue;
      tempsCrudas[m] = v;
      tempsCorr[m] = corregir(cal, m, t, v, ahora);
      dia.mm[m] = (dia.mm[m] ?? 0) + (horario[`precipitation_${m}`]?.[i] ?? 0);
    }
    const temp = ensamble(cal, t, tempsCorr, ahora);
    if (temp != null) {
      dia.horas.push({
        t, hora: +t.slice(11, 13), temp, porModelo: tempsCorr, crudas: tempsCrudas,
        // Ausentes si no se pidieron esas variables: quien no las use no paga nada.
        humedad: promedioCrudo(horario, 'relative_humidity_2m', modelos, i),
        viento: promedioCrudo(horario, 'wind_speed_10m', modelos, i),
        nubes: promedioCrudo(horario, 'cloud_cover', modelos, i),
        // El código no se promedia: es una categoría, no una cantidad. Gana el más votado.
        codigo: masVotado(horario, 'weather_code', modelos, i),
        // Por hora no hay historial contra el que calibrar, solo acuerdo entre modelos.
        // Es peor que la probabilidad diaria y la página lo dice donde se muestra.
        lluviaHora: acuerdoHorario(horario, modelos, i),
      });
      dia.temps.push(temp);
    }
  });

  return [...dias.values()].map(d => {
    const lluvia = probabilidadLluvia(cal, d.mm);
    // Desacuerdo: cuánto se separan los modelos en la máxima del día. Es la información
    // que el resto de los sitios esconde detrás de un ícono único.
    const maximas = Object.keys(d.mm).map(m =>
      Math.max(...d.horas.map(h => h.porModelo[m] ?? -Infinity))).filter(Number.isFinite);
    const humedades = d.horas.map(h => h.humedad).filter(v => v != null);
    return {
      ...d,
      min: d.temps.length ? Math.min(...d.temps) : null,
      max: d.temps.length ? Math.max(...d.temps) : null,
      humedad: humedades.length
        ? humedades.reduce((a, b) => a + b, 0) / humedades.length
        : null,
      lluvia,
      desacuerdo: maximas.length > 1 ? Math.max(...maximas) - Math.min(...maximas) : 0,
    };
  });
}
