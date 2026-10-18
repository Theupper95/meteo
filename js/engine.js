// Il metodo di previsione. Solo funzioni pure: niente rete, niente DOM.
//
// 1. Verifica: per ogni modello confronta le previsioni fatte 1 e 4 giorni prima
//    con il tempo reale degli ultimi ~35 giorni in questo punto.
// 2. Correzione: toglie l'errore sistematico di ogni modello (per fascia oraria).
// 3. Consenso: media pesata dei modelli, con più peso a chi ha sbagliato meno.
// 4. Fiducia: quanto i modelli sono d'accordo e quanto lontano è il giorno.

export const DAY = 86400;
const SIX_H = 21600;

export const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const sum = (a) => a.reduce((s, x) => s + x, 0);
const avg = (a) => (a.length ? sum(a) / a.length : NaN);
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const count = (a) => (a ? a.reduce((n, v) => n + (isNum(v) ? 1 : 0), 0) : 0);

function normalize(ws) {
  const s = sum(ws);
  return s > 0 ? ws.map((w) => w / s) : ws.map(() => 1 / ws.length);
}

/* ------------------------------------------------------------------ */
/* Lettura delle risposte dell'API                                      */
/* ------------------------------------------------------------------ */

// Con più modelli le chiavi hanno il suffisso del modello (temperature_2m_ecmwf_ifs),
// con un solo modello no.
export function pick(block, variable, model, single) {
  if (!block) return null;
  const a = block[single ? variable : `${variable}_${model}`];
  return Array.isArray(a) ? a : null;
}

export function parseForecast(json, models) {
  const h = json.hourly || {};
  const single = models.length === 1;
  const out = {};
  for (const m of models) {
    const temp = pick(h, 'temperature_2m', m, single);
    if (!temp || !temp.some(isNum)) continue;
    out[m] = {
      temp,
      precip: pick(h, 'precipitation', m, single),
      code: pick(h, 'weather_code', m, single),
      cloud: pick(h, 'cloud_cover', m, single),
      wind: pick(h, 'wind_speed_10m', m, single),
      dir: pick(h, 'wind_direction_10m', m, single),
      gust: pick(h, 'wind_gusts_10m', m, single),
      snow: pick(h, 'snowfall', m, single),
      rh: pick(h, 'relative_humidity_2m', m, single),
    };
  }
  return {
    times: h.time || [],
    tz: json.timezone || 'UTC',
    elevation: json.elevation,
    models: out,
  };
}

export function parseBestMatch(json) {
  if (!json) return null;
  const h = json.hourly || {};
  const d = json.daily || {};
  const q = json.minutely_15 || {};
  return {
    times: h.time || [],
    pop: h.precipitation_probability || null,
    apparent: h.apparent_temperature || null,
    temp: h.temperature_2m || null,
    freezing: h.freezing_level_height || null,
    current: json.current || null,
    minutely: q.time?.length ? { time: q.time, precip: q.precipitation || [] } : null,
    daily: {
      time: d.time || [],
      sunrise: d.sunrise || [],
      sunset: d.sunset || [],
      uv: d.uv_index_max || [],
      popMax: d.precipitation_probability_max || [],
    },
  };
}

/* ------------------------------------------------------------------ */
/* Osservazioni delle stazioni meteo (METAR)                            */
/* ------------------------------------------------------------------ */

// Fenomeni con precipitazione nel bollettino METAR (non conta "VC", cioè nei dintorni).
const WET_WX = /(^|\s)[+-]?(RE)?(SH|TS|FZ)?(DZ|RA|SN|SG|PL|GR|GS|UP)/;

// CSV dell'Iowa Environmental Mesonet: station,valid,tmpc,sknt,wxcodes (orari UTC).
export function parseStationCSV(text) {
  const out = [];
  const lines = String(text || '').split('\n');
  const head = (lines[0] || '').split(',');
  const col = (name) => head.indexOf(name);
  const cV = col('valid'), cT = col('tmpc'), cW = col('sknt'), cX = col('wxcodes');
  if (cV < 0) return out;
  for (let k = 1; k < lines.length; k++) {
    const c = lines[k].split(',');
    if (c.length < head.length) continue;
    const t = Date.parse(`${c[cV].replace(' ', 'T')}:00Z`) / 1000;
    if (!isNum(t)) continue;
    const num = (i) => (i >= 0 && c[i] !== 'M' && c[i] !== '' ? Number(c[i]) : null);
    const wx = cX >= 0 && c[cX] !== 'M' ? c[cX] : '';
    const temp = num(cT);
    const kt = num(cW);
    out.push({
      t,
      temp: isNum(temp) && temp > -60 && temp < 60 ? temp : null,
      wind: isNum(kt) && kt >= 0 && kt < 150 ? kt * 1.852 : null,
      wx,
      wet: WET_WX.test(wx),
    });
  }
  return out;
}

// Valori allineati all'ora piena (entro 15 minuti): il METAR delle 12:50 vale per le 13:00.
export function stationHourly(obs) {
  const best = new Map();
  for (const o of obs || []) {
    const h = Math.round(o.t / 3600) * 3600;
    const dt = Math.abs(o.t - h);
    if (dt > 900) continue;
    const cur = best.get(h);
    if (!cur || dt < cur.dt) best.set(h, { dt, temp: o.temp, wind: o.wind });
  }
  const temp = new Map(), wind = new Map();
  for (const [h, v] of best) {
    if (isNum(v.temp)) temp.set(h, v.temp);
    if (isNum(v.wind)) wind.set(h, v.wind);
  }
  return { temp, wind };
}

const ANALYSIS = 'ecmwf_ifs_analysis_long_window';

// prev: risposta della Previous Runs API; arch: risposta dell'archivio.
// station (facoltativa): {temp: Map, wind: Map, label} con i valori orari misurati.
// La verità è la stazione quando ci sono abbastanza misure, altrimenti l'analisi ECMWF.
export function parseVerification(prev, prevModels, arch, archModels, station = null) {
  const h = prev.hourly || {};
  const times = h.time || [];
  const single = prevModels.length === 1;
  const fc = {};
  for (const m of prevModels) {
    const f = {
      t1: pick(h, 'temperature_2m_previous_day1', m, single),
      t4: pick(h, 'temperature_2m_previous_day4', m, single),
      p1: pick(h, 'precipitation_previous_day1', m, single),
      w1: pick(h, 'wind_speed_10m_previous_day1', m, single),
    };
    if (Object.values(f).some((a) => a && a.some(isNum))) fc[m] = f;
  }

  const ah = (arch && arch.hourly) || {};
  const at = ah.time || [];
  const singleA = archModels.length === 1;
  const get = (v, m) => (archModels.includes(m) ? pick(ah, v, m, singleA) : null);
  // L'analisi ECMWF esiste solo ogni 6 ore: teniamo solo quegli istanti.
  const sixHourly = (arr) => (arr ? arr.map((v, i) => (at[i] % SIX_H === 0 ? v : null)) : null);

  const pos = new Map(at.map((t, i) => [t, i]));
  const align = (arr) =>
    times.map((t) => {
      if (!arr) return null;
      const i = pos.get(t);
      return i == null ? null : arr[i];
    });
  const fromStation = (m) => (m ? times.map((t) => (m.has(t) ? m.get(t) : null)) : null);

  // Almeno 10 giorni di misure orarie: allora la stazione è la verità, con 8 fasce orarie.
  let tT = fromStation(station?.temp);
  let tLabel = station?.label || '';
  let tSource = 'station';
  let nSlots = 8;
  if (count(tT) < 240) {
    nSlots = 4;
    tT = align(sixHourly(get('temperature_2m', ANALYSIS)));
    tLabel = 'analisi ECMWF';
    tSource = 'analysis';
    if (count(tT) < 20) {
      tT = align(sixHourly(get('temperature_2m', 'era5')));
      tLabel = 'rianalisi ERA5';
      tSource = 'era5';
    }
  }
  let tW = fromStation(station?.wind);
  if (count(tW) < 240) {
    tW = align(sixHourly(get('wind_speed_10m', ANALYSIS)));
    if (count(tW) < 20) tW = align(sixHourly(get('wind_speed_10m', 'era5')));
  }
  const tP = align(get('precipitation', 'era5'));

  return {
    times,
    fc,
    truth: { t: tT, w: tW, p: tP, tLabel, tSource, nSlots, pLabel: 'rianalisi ERA5' },
  };
}

/* ------------------------------------------------------------------ */
/* Verifica: quanto ha sbagliato ogni modello                          */
/* ------------------------------------------------------------------ */

// Fascia oraria UTC più vicina. Con 4 fasce sono le ore 00, 06, 12, 18 (l'analisi ECMWF);
// con 8 fasce, ogni 3 ore (le misure orarie di una stazione).
const slotOf = (t, nSlots = 4) => Math.round(((((t % DAY) + DAY) % DAY) / 3600) / (24 / nSlots)) % nSlots;

// Errori di temperatura (previsione − realtà) con la fascia oraria, il giorno e il blocco di 6 ore.
export function tempPairs(ver, model, key, keep) {
  const f = ver.fc[model]?.[key];
  if (!f) return [];
  const nSlots = ver.truth.nSlots || 4;
  const out = [];
  for (let i = 0; i < ver.times.length; i++) {
    if (keep && !keep(i)) continue;
    const o = ver.truth.t[i];
    const x = f[i];
    const t = ver.times[i];
    if (isNum(o) && isNum(x)) out.push({ i, e: x - o, slot: slotOf(t, nSlots), d: Math.floor(t / DAY), blk: Math.floor(t / SIX_H) });
  }
  return out;
}

// Errore sistematico per fascia oraria, "ristretto" verso la media quando i dati sono pochi.
// Le misure di ore vicine si somigliano: per decidere quanto fidarsi si contano i blocchi
// di 6 ore (nEff) e, per ogni fascia, i giorni diversi, non le singole ore.
export function tempStats(pairs, nSlots = 4) {
  const n = pairs.length;
  if (n < 8) return null;
  const nEff = new Set(pairs.map((p) => p.blk ?? p.i)).size;
  const meanE = avg(pairs.map((p) => p.e));
  const overall = (meanE * nEff) / (nEff + 12);
  const slotBias = Array.from({ length: nSlots }, (_, s) => {
    const ps = pairs.filter((p) => p.slot === s);
    const nS = new Set(ps.map((p) => p.d ?? p.i)).size;
    const es = ps.length ? avg(ps.map((p) => p.e)) : overall;
    return (nS * es + 8 * overall) / (nS + 8);
  });
  return {
    n,
    nEff,
    bias: meanE,
    slotBias,
    maeRaw: avg(pairs.map((p) => Math.abs(p.e))),
    maeCorr: avg(pairs.map((p) => Math.abs(p.e - slotBias[p.slot]))),
  };
}

export function computeSkill(ver, models) {
  const skill = {};
  const { times, truth } = ver;
  const nSlots = truth.nSlots || 4;
  for (const m of models) {
    const f = ver.fc[m];
    if (!f) continue;
    const s = {};
    for (const key of ['t1', 't4']) {
      const st = tempStats(tempPairs(ver, m, key), nSlots);
      if (st) s[key] = st;
    }

    // Vento: fattore moltiplicativo (molti modelli sovrastimano o sottostimano il vento).
    if (f.w1) {
      const xs = [];
      const os = [];
      const blocks = new Set();
      for (let i = 0; i < times.length; i++) {
        if (isNum(f.w1[i]) && isNum(truth.w[i])) {
          xs.push(f.w1[i]);
          os.push(truth.w[i]);
          blocks.add(Math.floor(times[i] / SIX_H));
        }
      }
      const n = xs.length;
      const nEff = blocks.size;
      if (n >= 8) {
        const raw = sum(xs) > 1 ? sum(os) / sum(xs) : 1;
        const factor = clamp(1 + ((raw - 1) * nEff) / (nEff + 20), 0.7, 1.4);
        s.wind = {
          n,
          nEff,
          factor,
          bias: avg(xs.map((x, k) => x - os[k])),
          maeRaw: avg(xs.map((x, k) => Math.abs(x - os[k]))),
          maeCorr: avg(xs.map((x, k) => Math.abs(factor * x - os[k]))),
        };
      }
    }

    // Pioggia: totali giornalieri (giorno UTC), soglia 1 mm per dire "ha piovuto".
    if (f.p1) {
      const days = new Map();
      for (let i = 0; i < times.length; i++) {
        const d = Math.floor(times[i] / DAY);
        const r = days.get(d) || { f: 0, o: 0, nf: 0, no: 0 };
        if (isNum(f.p1[i])) { r.f += f.p1[i]; r.nf++; }
        if (isNum(truth.p[i])) { r.o += truth.p[i]; r.no++; }
        days.set(d, r);
      }
      const rows = [...days.values()].filter((r) => r.nf >= 20 && r.no >= 24);
      if (rows.length >= 5) {
        let hit = 0, miss = 0, fa = 0, cn = 0, abs = 0;
        for (const r of rows) {
          const fy = r.f >= 1;
          const oy = r.o >= 1;
          if (fy && oy) hit++;
          else if (oy) miss++;
          else if (fy) fa++;
          else cn++;
          abs += Math.abs(r.f - r.o);
        }
        s.rain = { nDays: rows.length, hit, miss, fa, cn, acc: (hit + cn) / rows.length, mae: abs / rows.length };
      }
    }
    if (Object.keys(s).length) skill[m] = s;
  }
  return skill;
}

/* ------------------------------------------------------------------ */
/* Pesi                                                                */
/* ------------------------------------------------------------------ */

// Peso ∝ 1/errore², poi avvicinato ai pesi uguali quando i campioni sono pochi,
// e con un tetto per non affidarsi mai a un solo modello.
export function makeWeights(models, errOf, nOf, { k = 40 } = {}) {
  const M = models.length;
  if (!M) return {};
  const raw = models.map((m) => {
    const e = errOf(m);
    return isNum(e) ? 1 / Math.max(e, 0.1) ** 2 : null;
  });
  const known = raw.filter(isNum);
  const fill = known.length ? avg(known) : 1;
  let w = normalize(raw.map((v) => (isNum(v) ? v : fill)));
  w = normalize(
    w.map((v, i) => {
      const n = nOf(models[i]) || 0;
      const a = n / (n + k);
      return a * v + (1 - a) / M;
    })
  );
  const cap = Math.min(1, Math.max(0.4, 1.5 / M));
  for (let it = 0; it < 12; it++) {
    const over = w.map((v) => v > cap + 1e-9);
    if (!over.some(Boolean)) break;
    const excess = sum(w.map((v) => Math.max(0, v - cap)));
    const free = sum(w.map((v, i) => (over[i] ? 0 : v)));
    w = w.map((v, i) => (over[i] ? cap : v + (free > 0 ? (excess * v) / free : 0)));
  }
  return Object.fromEntries(models.map((m, i) => [m, w[i]]));
}

export function computeWeights(skill, models) {
  const nOf = (st) => st?.nEff ?? st?.n;
  const t1 = makeWeights(models, (m) => skill[m]?.t1?.maeCorr, (m) => nOf(skill[m]?.t1));
  const t4 = makeWeights(models, (m) => skill[m]?.t4?.maeCorr, (m) => nOf(skill[m]?.t4));
  const wind = makeWeights(models, (m) => skill[m]?.wind?.maeCorr, (m) => nOf(skill[m]?.wind));
  const rain = makeWeights(
    models,
    (m) => (skill[m]?.rain ? skill[m].rain.mae + 0.5 : null),
    (m) => skill[m]?.rain?.nDays,
    { k: 30 }
  );
  return { t1, t4, wind, rain };
}

/* ------------------------------------------------------------------ */
/* Valutazione onesta del metodo (fuori campione)                       */
/* ------------------------------------------------------------------ */

// Impara correzioni e pesi sulla prima metà del periodo e li prova sulla seconda.
export function evaluateMethod(ver, models) {
  const idx = [];
  for (let i = 0; i < ver.times.length; i++) if (isNum(ver.truth.t[i])) idx.push(i);
  const days = [...new Set(idx.map((i) => Math.floor(ver.times[i] / DAY)))].sort((a, b) => a - b);
  if (days.length < 12) return null;
  const split = days[Math.floor(days.length / 2)];
  const isTrain = (i) => Math.floor(ver.times[i] / DAY) < split;

  const nSlots = ver.truth.nSlots || 4;
  const train = {};
  for (const m of models) {
    const st = tempStats(tempPairs(ver, m, 't1', isTrain), nSlots);
    if (st) train[m] = st;
  }
  const trained = Object.keys(train);
  if (trained.length < 2) return null;
  const w = makeWeights(trained, (m) => train[m].maeCorr, (m) => train[m].nEff ?? train[m].n);
  const best = trained.slice().sort((a, b) => train[a].maeRaw - train[b].maeRaw)[0];

  const eMean = [], eBest = [], eOurs = [];
  for (const i of idx) {
    if (isTrain(i)) continue;
    const o = ver.truth.t[i];
    const avail = trained.filter((m) => isNum(ver.fc[m].t1?.[i]));
    if (avail.length < 2 || !avail.includes(best)) continue;
    const vals = avail.map((m) => ver.fc[m].t1[i]);
    eMean.push(Math.abs(avg(vals) - o));
    eBest.push(Math.abs(ver.fc[best].t1[i] - o));
    const slot = slotOf(ver.times[i], nSlots);
    const ws = normalize(avail.map((m) => w[m]));
    const ours = sum(avail.map((m, j) => ws[j] * (ver.fc[m].t1[i] - train[m].slotBias[slot])));
    eOurs.push(Math.abs(ours - o));
  }
  if (eOurs.length < 15) return null;
  return {
    n: eOurs.length,
    trainDays: days.filter((d) => d < split).length,
    testDays: days.filter((d) => d >= split).length,
    maeMean: avg(eMean),
    maeBest: avg(eBest),
    best,
    maeOurs: avg(eOurs),
  };
}

/* ------------------------------------------------------------------ */
/* Consenso ora per ora e giorno per giorno                             */
/* ------------------------------------------------------------------ */

// Errore sistematico all'ora UTC data, interpolato tra le fasce (4 o 8 nel giorno).
export function biasAt(st, utcHour) {
  if (!st?.slotBias?.length) return null;
  const n = st.slotBias.length;
  const x = (utcHour / 24) * n;
  const s0 = Math.floor(x) % n;
  const s1 = (s0 + 1) % n;
  const fr = x - Math.floor(x);
  return st.slotBias[s0] * (1 - fr) + st.slotBias[s1] * fr;
}

// Errore sistematico del modello all'ora data; alpha passa dalla verifica a 1 giorno a quella a 4 giorni.
export function tempBias(sk, utcHour, alpha) {
  const b1 = biasAt(sk?.t1, utcHour);
  const b4 = biasAt(sk?.t4, utcHour);
  if (b1 == null && b4 == null) return 0;
  if (b4 == null) return b1;
  if (b1 == null) return b4;
  return b1 * (1 - alpha) + b4 * alpha;
}

const leadAlpha = (leadHours) => clamp((leadHours - 36) / 48, 0, 1);

function tempWeight(weights, m, alpha) {
  const a = weights.t1[m] ?? 0;
  const b = weights.t4[m] ?? a;
  return (1 - alpha) * a + alpha * b;
}

function alignTo(times, srcTimes, arr) {
  if (!arr || !srcTimes) return null;
  const pos = new Map(srcTimes.map((t, i) => [t, i]));
  return times.map((t) => {
    const i = pos.get(t);
    return i == null ? null : arr[i];
  });
}

// Codice meteo WMO ricavato dal consenso (non dal voto di un solo modello).
export function deriveCode({ pop, precip, cloud, fr }) {
  if (pop >= 0.5 && precip >= 0.1) {
    if (fr.thunder >= 0.3) return 95;
    if (fr.snow >= 0.5) return precip >= 2 ? 75 : precip >= 0.5 ? 73 : 71;
    if (fr.shower >= 0.5) return precip >= 4 ? 82 : precip >= 1 ? 81 : 80;
    if (precip < 0.3 && fr.drizzle >= 0.5) return 53;
    return precip >= 4 ? 65 : precip >= 1 ? 63 : 61;
  }
  if (fr.thunder >= 0.4 && pop >= 0.35) return 95;
  if (fr.fog >= 0.4) return 45;
  if (!isNum(cloud)) return null;
  return cloud < 15 ? 0 : cloud < 40 ? 1 : cloud < 75 ? 2 : 3;
}

function weightedFraction(models, ws, test) {
  let s = 0;
  models.forEach((m, j) => {
    if (test(m)) s += ws[j];
  });
  return s;
}

function vectorMeanDir(items) {
  // items: [{w, speed, dir}] → direzione media (da dove soffia), gradi
  let u = 0, v = 0;
  for (const it of items) {
    const r = (it.dir * Math.PI) / 180;
    u += it.w * Math.max(it.speed, 0.5) * Math.sin(r);
    v += it.w * Math.max(it.speed, 0.5) * Math.cos(r);
  }
  if (Math.abs(u) < 1e-9 && Math.abs(v) < 1e-9) return null;
  return ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360;
}

export function makeTimeTools(tz) {
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' });
  return {
    dayKey: (t) => dayFmt.format(new Date(t * 1000)),
    hour: (t) => Number(hourFmt.format(new Date(t * 1000))) % 24,
  };
}

const CUM = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
export function doyOfKey(key) {
  const [, mo, da] = key.split('-').map(Number);
  if (mo === 2 && da === 29) return 58;
  return CUM[mo - 1] + da - 1;
}

export function expectedError(skill, weights, dayLead) {
  const models = Object.keys(weights.t1 || {});
  const mean = (key) => {
    let s = 0, ws = 0;
    for (const m of models) {
      const st = skill[m]?.[key];
      if (st) { s += weights.t1[m] * st.maeCorr; ws += weights.t1[m]; }
    }
    return ws > 0 ? s / ws : null;
  };
  const e1 = mean('t1') ?? 1.3;
  const e4 = Math.max(mean('t4') ?? 2.1, e1);
  let e;
  if (dayLead <= 1) e = e1 * (0.75 + 0.25 * Math.max(0, dayLead));
  else e = e1 + ((e4 - e1) * (dayLead - 1)) / 3;
  return Math.min(e, e4 * 1.6);
}

export function buildForecast({ fc, bm, skill, weights, now, normals }) {
  const times = fc.times;
  const models = Object.keys(fc.models);
  const tools = makeTimeTools(fc.tz);
  const bmPop = bm ? alignTo(times, bm.times, bm.pop) : null;
  const bmApp = bm ? alignTo(times, bm.times, bm.apparent) : null;
  const bmTemp = bm ? alignTo(times, bm.times, bm.temp) : null;
  const bmFrz = bm ? alignTo(times, bm.times, bm.freezing) : null;

  const hours = times.map((t, i) => {
    const lead = (t - now) / 3600;
    const alpha = leadAlpha(lead);
    const utcH = new Date(t * 1000).getUTCHours();
    const act = models.filter((m) => isNum(fc.models[m].temp[i]));
    if (!act.length) return null;

    // Temperatura corretta e pesata
    const wT = normalize(act.map((m) => tempWeight(weights, m, alpha)));
    const corr = act.map((m) => fc.models[m].temp[i] - tempBias(skill[m], utcH, alpha));
    const temp = sum(corr.map((c, j) => c * wT[j]));
    const spread = Math.sqrt(sum(corr.map((c, j) => wT[j] * (c - temp) ** 2)));
    const perModel = Object.fromEntries(act.map((m, j) => [m, corr[j]]));

    // Pioggia: quantità media pesata, probabilità = quota (pesata) di modelli che la prevedono
    const actP = act.filter((m) => isNum(fc.models[m].precip?.[i]));
    let precip = 0, popModels = 0;
    if (actP.length) {
      const wP = normalize(actP.map((m) => weights.rain[m] ?? 0));
      precip = sum(actP.map((m, j) => wP[j] * fc.models[m].precip[i]));
      popModels = weightedFraction(actP, wP, (m) => {
        const p = fc.models[m].precip;
        let mx = 0;
        for (let k = i - 1; k <= i + 1; k++) if (isNum(p[k])) mx = Math.max(mx, p[k]);
        return mx >= 0.1;
      });
    }
    const popEns = bmPop && isNum(bmPop[i]) ? bmPop[i] / 100 : null;
    const pop = popEns == null ? popModels : 0.5 * popModels + 0.5 * popEns;

    // Vento con il fattore di correzione di ogni modello
    const actW = act.filter((m) => isNum(fc.models[m].wind?.[i]));
    let wind = null, gust = null, dir = null;
    if (actW.length) {
      const wW = normalize(actW.map((m) => weights.wind[m] ?? 0));
      const F = (m) => skill[m]?.wind?.factor ?? 1;
      wind = sum(actW.map((m, j) => wW[j] * F(m) * fc.models[m].wind[i]));
      const actG = actW.filter((m) => isNum(fc.models[m].gust?.[i]));
      if (actG.length) {
        const wG = normalize(actG.map((m) => weights.wind[m] ?? 0));
        gust = Math.max(wind, sum(actG.map((m, j) => wG[j] * F(m) * fc.models[m].gust[i])));
      }
      const actD = actW.filter((m) => isNum(fc.models[m].dir?.[i]));
      if (actD.length) {
        const wD = normalize(actD.map((m) => weights.wind[m] ?? 0));
        dir = vectorMeanDir(actD.map((m, j) => ({ w: wD[j], speed: fc.models[m].wind[i], dir: fc.models[m].dir[i] })));
      }
    }

    // Nuvole, umidità e fenomeni: peso misto temperatura/pioggia
    const mixW = (list) => normalize(list.map((m) => ((weights.t1[m] ?? 0) + (weights.rain[m] ?? 0)) / 2));
    const wavg = (key) => {
      const list = act.filter((m) => isNum(fc.models[m][key]?.[i]));
      if (!list.length) return null;
      const ws = mixW(list);
      return sum(list.map((m, j) => ws[j] * fc.models[m][key][i]));
    };
    const cloud = wavg('cloud');
    const rh = wavg('rh');
    const withCode = act.filter((m) => isNum(fc.models[m].code?.[i]));
    const wc = withCode.length ? mixW(withCode) : [];
    const code = (m) => fc.models[m].code[i];
    const frac = (test) => (withCode.length ? weightedFraction(withCode, wc, test) : 0);
    const fr = {
      thunder: frac((m) => code(m) >= 95),
      shower: frac((m) => code(m) >= 80 && code(m) <= 86),
      fog: frac((m) => code(m) === 45 || code(m) === 48),
      drizzle: frac((m) => code(m) >= 51 && code(m) <= 57),
      snow: frac((m) => (code(m) >= 71 && code(m) <= 77) || code(m) === 85 || code(m) === 86 || (fc.models[m].snow?.[i] ?? 0) > 0),
    };
    const wmo = deriveCode({ pop, precip, cloud, fr });

    return {
      i, t, lead, temp, spread, lo: Math.min(...corr), hi: Math.max(...corr), perModel,
      n: act.length, precip, pop, popModels, popEns, wind, gust, dir, cloud, rh,
      // temperatura percepita: quella del modello "best match", spostata sulla nostra temperatura
      apparent: bmApp && isNum(bmApp[i]) ? bmApp[i] + (isNum(bmTemp?.[i]) ? temp - bmTemp[i] : 0) : null,
      frz: bmFrz && isNum(bmFrz[i]) ? bmFrz[i] : null,
      fr, code: wmo, hour: tools.hour(t), day: tools.dayKey(t),
    };
  });

  // Giorni locali
  const byDay = new Map();
  hours.forEach((h, i) => {
    if (!h) return;
    if (!byDay.has(h.day)) byDay.set(h.day, []);
    byDay.get(h.day).push(i);
  });
  const todayKey = tools.dayKey(now);
  const keys = [...byDay.keys()].filter((k) => k >= todayKey).sort().slice(0, 7);
  const bmDaily = new Map();
  if (bm?.daily?.time) {
    bm.daily.time.forEach((t, j) => {
      // il tempo dei dati giornalieri è la mezzanotte locale: usiamo mezzogiorno per sicurezza
      const key = tools.dayKey(t + 12 * 3600);
      bmDaily.set(key, {
        sunrise: bm.daily.sunrise[j], sunset: bm.daily.sunset[j],
        uv: bm.daily.uv[j], popMax: bm.daily.popMax[j],
      });
    });
  }

  const days = keys.map((key, dayIndex) => {
    const idx = byDay.get(key);
    const midI = idx.find((i) => hours[i].hour === 13) ?? idx[Math.floor(idx.length / 2)];
    const alpha = leadAlpha(hours[midI].lead);
    const per = {};
    for (const m of models) {
      const mod = fc.models[m];
      const vals = [], prs = [];
      for (const i of idx) {
        if (isNum(mod.temp[i])) vals.push(mod.temp[i] - tempBias(skill[m], new Date(times[i] * 1000).getUTCHours(), alpha));
        if (isNum(mod.precip?.[i])) prs.push(mod.precip[i]);
      }
      if (vals.length >= Math.min(20, idx.length)) {
        per[m] = {
          tmax: Math.max(...vals),
          tmin: Math.min(...vals),
          precip: prs.length >= Math.min(20, idx.length) ? sum(prs) : null,
        };
      }
    }
    const pm = Object.keys(per);
    if (!pm.length) return null;
    const wT = normalize(pm.map((m) => tempWeight(weights, m, alpha)));
    const tmax = sum(pm.map((m, j) => wT[j] * per[m].tmax));
    const tmin = sum(pm.map((m, j) => wT[j] * per[m].tmin));
    const sd = (key2, mean) => Math.sqrt(sum(pm.map((m, j) => wT[j] * (per[m][key2] - mean) ** 2)));
    const tmaxSpread = sd('tmax', tmax);
    const tminSpread = sd('tmin', tmin);

    const pp = pm.filter((m) => isNum(per[m].precip));
    let precip = 0, popModels = 0, wetCount = 0;
    if (pp.length) {
      const wP = normalize(pp.map((m) => weights.rain[m] ?? 0));
      precip = sum(pp.map((m, j) => wP[j] * per[m].precip));
      popModels = weightedFraction(pp, wP, (m) => per[m].precip >= 0.5);
      wetCount = pp.filter((m) => per[m].precip >= 0.5).length;
    }
    const extra = bmDaily.get(key) || {};
    const popEns = isNum(extra.popMax) ? extra.popMax / 100 : null;
    const pop = popEns == null ? popModels : 0.5 * popModels + 0.5 * popEns;

    const hs = idx.map((i) => hours[i]);
    const dayHours = hs.filter((h) => h.hour >= 8 && h.hour <= 20);
    const winds = hs.filter((h) => isNum(h.wind));
    const windMax = winds.length ? Math.max(...winds.map((h) => h.wind)) : null;
    const gusts = hs.filter((h) => isNum(h.gust));
    const gustMax = gusts.length ? Math.max(...gusts.map((h) => h.gust)) : null;
    const dirDom = vectorMeanDir(dayHours.filter((h) => isNum(h.dir)).map((h) => ({ w: 1, speed: h.wind, dir: h.dir })));
    const clouds = dayHours.filter((h) => isNum(h.cloud)).map((h) => h.cloud);
    const cloudDay = clouds.length ? avg(clouds) : null;

    // Zero termico di giorno e, se sono previste precipitazioni, la quota della neve
    // (di solito 300 m circa sotto lo zero termico).
    const frz = dayHours.filter((h) => isNum(h.frz)).map((h) => h.frz);
    const freezing = frz.length ? { min: Math.min(...frz), max: Math.max(...frz), med: median(frz) } : null;
    const wetFrz = hs.filter((h) => isNum(h.frz) && h.precip >= 0.1 && h.pop >= 0.3).map((h) => h.frz);
    const snowLine = wetFrz.length ? Math.max(0, Math.round((Math.min(...wetFrz) - 300) / 100) * 100) : null;

    // Fenomeno prevalente della giornata
    let code;
    const anyThunder = hs.some((h) => h.code === 95);
    const snowy = hs.filter((h) => h.code >= 71 && h.code <= 77).length >= 3;
    const showery = hs.filter((h) => h.code >= 80 && h.code <= 82).length >= hs.filter((h) => h.code >= 61 && h.code <= 65).length;
    const foggy = hs.filter((h) => h.code === 45 && h.hour >= 5 && h.hour <= 11).length >= 3;
    if (pop >= 0.5 && precip >= 1) {
      if (anyThunder) code = 95;
      else if (snowy) code = precip >= 10 ? 75 : 73;
      else if (showery) code = precip >= 10 ? 82 : 81;
      else code = precip >= 10 ? 65 : precip >= 3 ? 63 : 61;
    } else if (pop >= 0.3 && precip >= 0.5) {
      code = anyThunder ? 95 : 80;
    } else if (foggy) {
      code = 45;
    } else if (isNum(cloudDay)) {
      code = cloudDay < 15 ? 0 : cloudDay < 40 ? 1 : cloudDay < 75 ? 2 : 3;
    } else code = null;

    // Fiducia: accordo sulle temperature, accordo sulla pioggia, distanza nel tempo
    const anyRain = pp.some((m) => per[m].precip >= 0.5);
    const tS = Math.max(tmaxSpread, tminSpread);
    const penTemp = 14 * Math.max(0, tS - 0.6);
    const penRain = anyRain ? 45 * (1 - Math.abs(2 * popModels - 1)) : 0;
    const penFar = 4 * dayIndex;
    const score = clamp(Math.round(100 - penTemp - penRain - penFar), 5, 98);
    const level = score >= 70 ? 3 : score >= 45 ? 2 : 1;
    const reasons = [];
    if (level < 3 || penRain >= 15) {
      if (penRain >= 8) reasons.push({ kind: 'rain', wet: wetCount, of: pp.length });
      if (penTemp >= 6) reasons.push({ kind: 'temp', spread: tS });
      if (dayIndex >= 4) reasons.push({ kind: 'far' });
    }
    if (!reasons.length) reasons.push({ kind: 'agree' });

    let normal = null;
    if (normals) {
      const d = doyOfKey(key);
      normal = { tmax: normals.tmax[d], tmin: normals.tmin[d], wet: normals.wet[d], rain: normals.rain[d] };
    }

    return {
      key, dayIndex, t: hours[idx[0]].t, tmax, tmin, tmaxSpread, tminSpread,
      tmaxLo: Math.min(...pm.map((m) => per[m].tmax)), tmaxHi: Math.max(...pm.map((m) => per[m].tmax)),
      tminLo: Math.min(...pm.map((m) => per[m].tmin)), tminHi: Math.max(...pm.map((m) => per[m].tmin)),
      precip, pop, popModels, popEns, wetCount, nRain: pp.length,
      windMax, gustMax, dirDom, cloud: cloudDay, code,
      conf: { score, level, reasons },
      err: expectedError(skill, weights, dayIndex + 0.5),
      per, nModels: pm.length,
      sunrise: extra.sunrise ?? null, sunset: extra.sunset ?? null, uv: extra.uv ?? null,
      freezing, snowLine,
      normal,
    };
  }).filter(Boolean);

  return { hours, days, models, tz: fc.tz, now };
}

function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return quantile(s, 0.5);
}

// Quantile di un array già ordinato, con interpolazione lineare.
function quantile(sorted, p) {
  if (!sorted.length) return null;
  const x = (sorted.length - 1) * p;
  const lo = Math.floor(x);
  const hi = Math.ceil(x);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (x - lo);
}

/* ------------------------------------------------------------------ */
/* Tendenza fino a 15 giorni: l'ensemble ECMWF (51 simulazioni)         */
/* ------------------------------------------------------------------ */

// Oltre la settimana un solo valore sarebbe una finta precisione: si mostrano gli intervalli
// in cui cadono le simulazioni, corretti con l'errore sistematico del modello ECMWF qui.
export function buildExtended(ens, { tz, skill = {}, after = null } = {}) {
  const d = ens?.daily;
  if (!d?.time?.length) return [];
  const tools = makeTimeTools(tz || ens.timezone || 'UTC');
  const keys = Object.keys(d);
  const series = (base) => keys.filter((k) => k === base || k.startsWith(`${base}_member`)).map((k) => d[k]);
  const TX = series('temperature_2m_max');
  const TN = series('temperature_2m_min');
  const PR = series('precipitation_sum');
  const st = skill.ecmwf_ifs?.t4 || skill.ecmwf_ifs?.t1 || null;
  const bx = st ? biasAt(st, 13) : 0;
  const bn = st ? biasAt(st, 4) : 0;
  const qs = (s) => ({ p10: quantile(s, 0.1), p25: quantile(s, 0.25), p50: quantile(s, 0.5), p75: quantile(s, 0.75), p90: quantile(s, 0.9) });
  const out = [];
  d.time.forEach((t, j) => {
    const key = tools.dayKey(t + 43200);
    if (after && key <= after) return;
    const tx = TX.map((a) => a[j]).filter(isNum).map((v) => v - bx).sort((a, b) => a - b);
    const tn = TN.map((a) => a[j]).filter(isNum).map((v) => v - bn).sort((a, b) => a - b);
    const pr = PR.map((a) => a[j]).filter(isNum).sort((a, b) => a - b);
    if (tx.length < 10 || tn.length < 10) return;
    const wet = pr.filter((v) => v >= 1).length;
    out.push({
      key, t,
      tmax: qs(tx), tmin: qs(tn),
      pop: pr.length ? wet / pr.length : null,
      wet, members: pr.length || tx.length,
      precip: pr.length ? quantile(pr, 0.5) : null,
      corrected: !!st,
    });
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Com'è andata davvero, giorno per giorno (per il diario)              */
/* ------------------------------------------------------------------ */

// Massima, minima e pioggia di ogni giorno locale. Dalla stazione quando c'è
// (pioggia dai fenomeni del METAR), altrimenti dalla rianalisi ERA5 (5 giorni di ritardo).
export function dailyTruth({ obs = null, arch = null, archModels = [], tz }) {
  const tools = makeTimeTools(tz);
  const out = {};
  const hasWx = !!obs?.some((o) => o.wx);
  if (obs?.length) {
    const byDay = new Map();
    for (const o of obs) {
      const k = tools.dayKey(o.t);
      if (!byDay.has(k)) byDay.set(k, { temps: [], hours: new Set(), wet: 0 });
      const r = byDay.get(k);
      if (isNum(o.temp)) { r.temps.push(o.temp); r.hours.add(tools.hour(o.t)); }
      if (o.wet) r.wet++;
    }
    for (const [k, r] of byDay) {
      if (r.hours.size < 18) continue;
      out[k] = { tmax: Math.max(...r.temps), tmin: Math.min(...r.temps), wet: hasWx ? r.wet >= 2 : null, src: 'station' };
    }
  }
  const ah = arch?.hourly;
  if (ah?.time?.length) {
    const single = archModels.length === 1;
    const T = archModels.includes('era5') ? pick(ah, 'temperature_2m', 'era5', single) : null;
    const P = archModels.includes('era5') ? pick(ah, 'precipitation', 'era5', single) : null;
    const byDay = new Map();
    ah.time.forEach((t, i) => {
      const k = tools.dayKey(t);
      if (!byDay.has(k)) byDay.set(k, { temps: [], rain: 0, nRain: 0 });
      const r = byDay.get(k);
      if (isNum(T?.[i])) r.temps.push(T[i]);
      if (isNum(P?.[i])) { r.rain += P[i]; r.nRain++; }
    });
    for (const [k, r] of byDay) {
      const rainKnown = r.nRain >= 23;
      if (out[k]) {
        // stazione senza osservazione dei fenomeni: la pioggia viene da ERA5
        if (out[k].wet == null && rainKnown) out[k].wet = r.rain >= 1;
        continue;
      }
      if (r.temps.length < 23) continue;
      out[k] = { tmax: Math.max(...r.temps), tmin: Math.min(...r.temps), wet: rainKnown ? r.rain >= 1 : null, src: 'era5' };
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Clima di riferimento 1991-2020                                       */
/* ------------------------------------------------------------------ */

export function computeNormals(json) {
  const d = json?.daily;
  if (!d?.time?.length) return null;
  const N = 365;
  const acc = {
    tmax: { s: new Float64Array(N), n: new Uint32Array(N) },
    tmin: { s: new Float64Array(N), n: new Uint32Array(N) },
    rain: { s: new Float64Array(N), n: new Uint32Array(N) },
    wet: { s: new Float64Array(N), n: new Uint32Array(N) },
  };
  const add = (k, doy, v) => {
    if (isNum(v)) { acc[k].s[doy] += v; acc[k].n[doy]++; }
  };
  d.time.forEach((key, i) => {
    const doy = doyOfKey(key);
    add('tmax', doy, d.temperature_2m_max?.[i]);
    add('tmin', doy, d.temperature_2m_min?.[i]);
    const p = d.precipitation_sum?.[i];
    add('rain', doy, p);
    if (isNum(p)) add('wet', doy, p >= 1 ? 1 : 0);
  });
  const out = {};
  for (const k of Object.keys(acc)) {
    out[k] = [];
    for (let doy = 0; doy < N; doy++) {
      let s = 0, n = 0;
      for (let w = -7; w <= 7; w++) {
        const j = (doy + w + N) % N;
        s += acc[k].s[j];
        n += acc[k].n[j];
      }
      out[k].push(n ? Math.round((s / n) * 100) / 100 : null);
    }
  }
  out.period = '1991–2020';
  return out;
}
