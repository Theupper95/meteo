// Dati intorno alla previsione: pioggia nelle prossime 2 ore, aria, pollini, mare.
// Solo funzioni pure: niente rete, niente DOM.

import { isNum, makeTimeTools } from './engine.js';
import { distanceKm } from './stations.js';

/* ------------------------------------------------------------------ */
/* Prossime 2 ore, ogni 15 minuti                                       */
/* ------------------------------------------------------------------ */

// steps: 8 intervalli di 15 minuti a partire da adesso, con i mm caduti in ognuno.
export function nowcast(bm, now) {
  const m = bm?.minutely;
  if (!m?.time?.length) return null;
  const start = m.time.findIndex((t) => t + 900 > now);
  if (start < 0) return null;
  const steps = [];
  for (let k = start; k < m.time.length && steps.length < 8; k++) {
    steps.push({ t: m.time[k], mm: isNum(m.precip[k]) ? Math.max(0, m.precip[k]) : 0 });
  }
  if (steps.length < 4) return null;
  const wet = (s) => s.mm >= 0.05; // 0,2 mm/h: sotto è solo qualche goccia
  const peak = Math.max(...steps.map((s) => s.mm * 4));
  const firstWet = steps.findIndex(wet);
  const wetNow = wet(steps[0]);
  const endIdx = wetNow ? steps.findIndex((s) => !wet(s)) : -1;
  return {
    steps,
    peak,
    wetNow,
    any: firstWet >= 0,
    start: firstWet >= 0 ? steps[firstWet].t : null,
    end: wetNow && endIdx > 0 ? steps[endIdx].t : null,
    total: steps.reduce((s, x) => s + x.mm, 0),
  };
}

/* ------------------------------------------------------------------ */
/* Qualità dell'aria (indice europeo) e pollini                         */
/* ------------------------------------------------------------------ */

export const aqiLevel = (v) => (!isNum(v) ? null : v <= 20 ? 0 : v <= 40 ? 1 : v <= 60 ? 2 : v <= 80 ? 3 : v <= 100 ? 4 : 5);

const POLLUTANTS = [
  ['european_aqi_pm2_5', 'le polveri sottili'],
  ['european_aqi_pm10', 'le polveri PM10'],
  ['european_aqi_ozone', "l'ozono"],
  ['european_aqi_nitrogen_dioxide', 'il biossido di azoto'],
];

// Soglie indicative in granuli per metro cubo (bassa, media, alta), come nei bollettini italiani.
export const POLLEN = [
  ['grass_pollen', 'Graminacee', [0.6, 10, 30]],
  ['olive_pollen', 'Olivo', [0.6, 5, 25]],
  ['birch_pollen', 'Betulla', [0.6, 16, 50]],
  ['alder_pollen', 'Ontano', [0.6, 16, 50]],
  ['ragweed_pollen', 'Ambrosia', [0.6, 5, 25]],
  ['mugwort_pollen', 'Artemisia', [0.6, 5, 25]],
];
export function airSummary(aq, now, tz) {
  if (!aq) return null;
  const c = aq.current || {};
  const h = aq.hourly || {};
  const tools = makeTimeTools(tz || aq.timezone || 'UTC');
  const today = tools.dayKey(now);
  const idx = (h.time || []).map((t, i) => [t, i]).filter(([t]) => tools.dayKey(t) === today).map(([, i]) => i);
  const later = idx.filter((i) => h.time[i] >= now);
  const aqiNow = isNum(c.european_aqi) ? c.european_aqi : null;
  const aqiMax = later.map((i) => h.european_aqi?.[i]).filter(isNum).reduce((a, b) => Math.max(a, b), -1);
  let main = null;
  if (aqiLevel(aqiNow) >= 2) {
    const worst = POLLUTANTS.filter(([k]) => isNum(c[k])).sort((a, b) => c[b[0]] - c[a[0]])[0];
    if (worst) main = worst[1];
  }
  const pollen = POLLEN.map(([key, name, th]) => {
    const vals = idx.map((i) => h[key]?.[i]).filter(isNum);
    if (!vals.length) return null;
    const max = Math.max(...vals);
    const level = max >= th[2] ? 3 : max >= th[1] ? 2 : max >= th[0] ? 1 : 0;
    return { key, name, max, level };
  }).filter(Boolean);
  if (aqiNow == null && !pollen.length) return null;
  return {
    aqi: aqiNow,
    level: aqiLevel(aqiNow),
    later: aqiMax >= 0 && aqiLevel(aqiMax) > aqiLevel(aqiNow) ? { aqi: aqiMax, level: aqiLevel(aqiMax) } : null,
    main,
    pollen: pollen.filter((p) => p.level > 0).sort((a, b) => b.level - a.level || b.max - a.max),
    pollenKnown: pollen.length > 0,
  };
}

/* ------------------------------------------------------------------ */
/* Mare: onde e temperatura dell'acqua                                  */
/* ------------------------------------------------------------------ */

// La Marine API cerca la cella di mare più vicina: oltre 30 km il luogo non è sulla costa.
export function seaSummary(sea, place, now, tz) {
  if (!sea?.hourly?.time?.length || !isNum(sea.latitude)) return null;
  const km = distanceKm(place, { lat: sea.latitude, lon: sea.longitude });
  if (km > 30) return null;
  const h = sea.hourly;
  const tools = makeTimeTools(tz || sea.timezone || 'UTC');
  const today = tools.dayKey(now);
  const tomorrow = tools.dayKey(now + 86400);
  const dayMax = (key) => {
    const v = h.time.map((t, i) => (tools.dayKey(t) === key && t >= now - 3600 ? h.wave_height?.[i] : null)).filter(isNum);
    return v.length ? Math.max(...v) : null;
  };
  const c = sea.current || {};
  const k = h.time.findIndex((t) => t >= now - 1800);
  const waveNow = isNum(c.wave_height) ? c.wave_height : h.wave_height?.[k];
  const sst = isNum(c.sea_surface_temperature) ? c.sea_surface_temperature : h.sea_surface_temperature?.[k];
  if (!isNum(waveNow) && !isNum(sst)) return null;
  return {
    km,
    waveNow: isNum(waveNow) ? waveNow : null,
    todayMax: dayMax(today),
    tomorrowMax: dayMax(tomorrow),
    dir: k >= 0 ? h.wave_direction?.[k] ?? null : null,
    period: k >= 0 ? h.wave_period?.[k] ?? null : null,
    sst: isNum(sst) ? sst : null,
  };
}
