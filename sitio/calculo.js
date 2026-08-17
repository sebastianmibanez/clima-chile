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
export function ensamble(cal, tiempoISO, porModelo, ahora) {
  const lead = horizonte(tiempoISO, ahora);
  let suma = 0, pesos = 0;
  for (const [modelo, valor] of Object.entries(porModelo)) {
    if (valor == null) continue;
    const p = cal.pesos?.[modelo]?.[lead] ?? 0;
    suma += p * valor;
    pesos += p;
  }
  return pesos ? suma / pesos : null;
}

// Probabilidad de lluvia del día. No sale de ningún modelo: sale de cuántos coinciden, y de
// lo que históricamente pasó en ESA comuna cuando coincidían esos. Cada modelo tiene su propio
// umbral de mm, aprendido del historial, porque todos exageran la llovizna en distinta medida.
export function probabilidadLluvia(cal, mmPorModelo) {
  const umbrales = cal.lluvia?.umbralMm ?? {};
  const modelos = Object.keys(umbrales);
  if (!modelos.length) return null;

  const votan = modelos.filter(m => (mmPorModelo[m] ?? 0) >= umbrales[m]);
  const k = votan.length;
  const p = cal.lluvia.prob?.[k] ?? cal.lluvia.climatologia ?? 0;
  return { prob: p, acuerdo: k, total: modelos.length, votan };
}

// Qué gatito corresponde. Es una función pura de los datos, no un estado que haya que
// recordar: entra el pronóstico, sale el dibujo.
export function estadoGato({ temp, prob, hora }) {
  if (prob >= 0.45) return 'lluvia';
  if (hora != null && (hora < 7 || hora >= 20)) return 'noche';
  if (temp != null && temp <= 8) return 'frio';
  if (temp != null && temp >= 29) return 'calor';
  if (prob >= 0.2) return 'nublado';
  return 'sol';
}

export const TEXTO_ESTADO = {
  sol: 'Despejado', nublado: 'Nublado', lluvia: 'Lluvia',
  frio: 'Frío', calor: 'Calor', noche: 'Despejado',
};

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
      dia.horas.push({ t, hora: +t.slice(11, 13), temp, porModelo: tempsCorr, crudas: tempsCrudas });
      dia.temps.push(temp);
    }
  });

  return [...dias.values()].map(d => {
    const lluvia = probabilidadLluvia(cal, d.mm);
    // Desacuerdo: cuánto se separan los modelos en la máxima del día. Es la información
    // que el resto de los sitios esconde detrás de un ícono único.
    const maximas = Object.keys(d.mm).map(m =>
      Math.max(...d.horas.map(h => h.porModelo[m] ?? -Infinity))).filter(Number.isFinite);
    return {
      ...d,
      min: d.temps.length ? Math.min(...d.temps) : null,
      max: d.temps.length ? Math.max(...d.temps) : null,
      lluvia,
      desacuerdo: maximas.length > 1 ? Math.max(...maximas) - Math.min(...maximas) : 0,
    };
  });
}
