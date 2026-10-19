// Testi in italiano: descrizioni, numeri, frasi di sintesi e il messaggio per Claude.

import { isNum } from './engine.js';
import { shortName, MODEL_BY_ID } from './models.js';

const nf1 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const MINUS = '−';

export const f1 = (x) => (isNum(x) ? nf1.format(x).replace('-', MINUS) : '–');
export const f0 = (x) => (isNum(x) ? String(Math.round(x)).replace('-', MINUS) : '–');
export const deg = (x) => `${f0(x)}°`;
export const pct = (p) => `${Math.round(p * 100)}%`;
export const mm = (x) => (x < 0.05 ? '0' : x < 10 ? nf1.format(x) : String(Math.round(x)));
export const cm = (x) => (x < 0.05 ? '0' : x < 10 ? nf1.format(x) : String(Math.round(x)));

// Quantità di un'ora o di un giorno: in centimetri se è soprattutto neve, altrimenti in millimetri.
export function amount(precipMm, snowCm) {
  const snowWater = (snowCm || 0) / 0.7;
  if ((snowCm || 0) >= 0.05 && snowWater >= 0.5 * (precipMm || 0)) return { text: `${cm(snowCm)} cm`, snow: true };
  return { text: `${mm(precipMm || 0)} mm`, snow: false };
}
export const signed = (x, digits = 1) => {
  if (!isNum(x)) return '–';
  const v = digits ? nf1.format(Math.abs(x)) : String(Math.round(Math.abs(x)));
  if (Math.abs(x) < (digits ? 0.05 : 0.5)) return `±${digits ? '0,0' : '0'}`;
  return (x > 0 ? '+' : MINUS) + v;
};

export const WMO = {
  0: 'Sereno', 1: 'Prevalentemente sereno', 2: 'Parzialmente nuvoloso', 3: 'Coperto',
  45: 'Nebbia', 48: 'Nebbia con brina',
  51: 'Pioviggine debole', 53: 'Pioviggine', 55: 'Pioviggine fitta', 56: 'Pioviggine gelata', 57: 'Pioviggine gelata',
  61: 'Pioggia debole', 63: 'Pioggia', 65: 'Pioggia forte', 66: 'Pioggia gelata', 67: 'Pioggia gelata forte',
  71: 'Neve debole', 73: 'Neve', 75: 'Neve forte', 77: 'Neve granulosa',
  80: 'Possibili rovesci', 81: 'Rovesci', 82: 'Rovesci forti', 85: 'Rovesci di neve', 86: 'Forti rovesci di neve',
  95: 'Temporali', 96: 'Temporali con grandine', 99: 'Temporali con grandine',
};
export const describe = (code) => (code == null ? '–' : WMO[code] || 'Variabile');

// Rosa dei venti: direzione da cui soffia il vento e nome tradizionale.
const ROSE = [
  ['N', 'Tramontana'], ['NE', 'Grecale'], ['E', 'Levante'], ['SE', 'Scirocco'],
  ['S', 'Ostro'], ['SO', 'Libeccio'], ['O', 'Ponente'], ['NO', 'Maestrale'],
];
export const rose = (d) => (isNum(d) ? ROSE[Math.round((((d % 360) + 360) % 360) / 45) % 8] : null);

export function windWord(kmh) {
  if (!isNum(kmh)) return '';
  if (kmh < 6) return 'calmo';
  if (kmh < 20) return 'debole';
  if (kmh < 39) return 'moderato';
  if (kmh < 62) return 'forte';
  return 'di burrasca';
}

export function windText(speed, dir, { names = true } = {}) {
  if (!isNum(speed)) return '–';
  if (speed < 3) return 'calma di vento';
  const r = rose(dir);
  const from = r ? `da ${r[0]}${names ? ` (${r[1]})` : ''} ` : '';
  return `${from}${f0(speed)} km/h`;
}

export function makeFormatters(tz) {
  const opts = (o) => new Intl.DateTimeFormat('it-IT', { timeZone: tz, ...o });
  const hh = opts({ hour: '2-digit', hourCycle: 'h23' });
  const hm = opts({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const wd = opts({ weekday: 'short' });
  const wdLong = opts({ weekday: 'long' });
  const dm = opts({ day: 'numeric' });
  const dmy = opts({ day: 'numeric', month: 'long' });
  const at = (t) => new Date(t * 1000);
  return {
    hour: (t) => hh.format(at(t)),
    hm: (t) => hm.format(at(t)),
    weekday: (t) => wd.format(at(t)).replace('.', ''),
    weekdayLong: (t) => wdLong.format(at(t)),
    dayNum: (t) => dm.format(at(t)),
    dayMonth: (t) => dmy.format(at(t)),
  };
}

export function dayLabel(day, fmt) {
  if (day.dayIndex === 0) return 'Oggi';
  if (day.dayIndex === 1) return 'Domani';
  const w = fmt.weekday(day.t + 12 * 3600);
  return w.charAt(0).toUpperCase() + w.slice(1) + ' ' + fmt.dayNum(day.t + 12 * 3600);
}

// "A", "A e B", "A, B e C"
export const andList = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`);

// Perché un giorno ha meno modelli di quelli scelti: i modelli locali si fermano dopo pochi giorni
// e alcuni coprono solo la loro zona. Senza questa riga "6 modelli su 6" sembrerebbe un errore.
export function modelsNote(d, chosen, withData, fmt) {
  const present = Object.keys(d.per || {});
  const missing = (chosen || []).filter((m) => !d.per?.[m]);
  if (!missing.length) return '';
  const known = new Set(withData || []);
  const outside = missing.filter((m) => !known.has(m));
  const short = missing.filter((m) => known.has(m));
  const w = fmt.weekdayLong(d.t + 43200);
  const when = d.dayIndex === 0 ? 'Oggi' : d.dayIndex === 1 ? 'Domani' : w.charAt(0).toUpperCase() + w.slice(1);
  const verb = (list, one, many) => (list.length > 1 ? many : one);
  const parts = [];
  if (short.length && d.dayIndex === 0) {
    parts.push(`${andList(short.map(shortName))} non ${verb(short, 'ha', 'hanno')} dati per tutta la giornata`);
  } else if (short.length) {
    const groups = new Map();
    for (const m of short) {
      const days = MODEL_BY_ID[m]?.days ?? 0;
      groups.set(days, [...(groups.get(days) || []), shortName(m)]);
    }
    parts.push([...groups.entries()].sort((a, b) => a[0] - b[0]).map(([days, names], i) => (i === 0
      ? `${andList(names)} ${verb(names, 'arriva', 'arrivano')} solo a ${days} giorni`
      : `${andList(names)} a ${days}`)).join(', '));
  }
  if (outside.length) parts.push(`${andList(outside.map(shortName))} non ${verb(outside, 'copre', 'coprono')} questo luogo`);
  return `${when} ${present.length === 1 ? "c'è" : 'ci sono'} ${present.length} dei ${chosen.length} modelli che hai scelto: ${parts.join('; ')}.`;
}

// Il giorno di un'ora, per esteso e in breve: "Domani, martedì 20" e "Domani", "Mercoledì 21" e "Mer 21".
export function dayOf(t, key, days, fmt) {
  const date = `${fmt.weekdayLong(t)} ${fmt.dayNum(t)}`;
  if (key === days?.[0]?.key) return { short: 'Oggi', long: `Oggi, ${date}` };
  if (key === days?.[1]?.key) return { short: 'Domani', long: `Domani, ${date}` };
  const w = fmt.weekday(t);
  return { short: `${w.charAt(0).toUpperCase()}${w.slice(1)} ${fmt.dayNum(t)}`, long: date.charAt(0).toUpperCase() + date.slice(1) };
}

export const CONF_LABEL = { 3: 'Fiducia alta', 2: 'Fiducia media', 1: 'Fiducia bassa' };

export function reasonText(r) {
  if (r.kind === 'agree') return 'modelli concordi';
  if (r.kind === 'rain') return `modelli divisi sulla pioggia (${r.wet} su ${r.of})`;
  if (r.kind === 'temp') return `temperature diverse tra i modelli (±${f1(r.spread)}°)`;
  if (r.kind === 'far') return 'giorno lontano: la previsione può cambiare';
  return '';
}

const precipNoun = (h) => (h.code >= 95 ? 'temporali' : (h.code >= 71 && h.code <= 77) || h.code === 85 || h.code === 86 ? 'neve' : 'pioggia');

// Frase sulle prossime 12 ore.
export function nextHoursText(result, fmt) {
  const now = result.now;
  const hs = result.hours.filter((h) => h && h.t >= now - 1800 && h.t <= now + 12 * 3600);
  if (!hs.length) return '';
  const wet = (h) => h.pop >= 0.5 && h.precip >= 0.1;
  const parts = [];
  if (wet(hs[0])) {
    const end = hs.find((h) => !wet(h) && h.pop < 0.4);
    const noun = precipNoun(hs[0]);
    parts.push(end ? `${cap(noun)} fino alle ${fmt.hour(end.t)} circa` : `${cap(noun)} per tutto il pomeriggio e la sera`);
  } else {
    const first = hs.find(wet);
    if (first) parts.push(`${cap(precipNoun(first))} probabile dalle ${fmt.hour(first.t)} (${pct(first.pop)})`);
    else {
      const maxPop = Math.max(...hs.map((h) => h.pop));
      parts.push(maxPop >= 0.3 ? `Qualche piovasco possibile (fino al ${pct(maxPop)})` : 'Asciutto nelle prossime 12 ore');
    }
  }
  const gusts = hs.filter((h) => isNum(h.gust));
  const gmax = gusts.length ? Math.max(...gusts.map((h) => h.gust)) : 0;
  if (gmax >= 45) parts.push(`raffiche fino a ${f0(gmax)} km/h`);
  if (!wet(hs[0])) {
    if (hs[0].code === 45) {
      const clear = hs.find((h) => h.code !== 45);
      parts.push(clear ? `nebbia fino alle ${fmt.hour(clear.t)} circa` : 'nebbia per tutta la mattina');
    } else {
      const fog = hs.find((h) => h.code === 45);
      if (fog) parts.push(`nebbia verso le ${fmt.hour(fog.t)}`);
    }
  }
  return parts.join(', ') + '.';
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ------------------------------------------------------------------ */
/* Prossime due ore, allerte, aria, mare, montagna                      */
/* ------------------------------------------------------------------ */

const rateWord = (mmh) => (mmh < 2.5 ? 'debole' : mmh < 7.5 ? 'moderata' : 'forte');

export function nowcastText(nc, fmt, noun = 'pioggia') {
  if (!nc) return '';
  if (!nc.any) return 'Niente pioggia nelle prossime due ore.';
  const w = `${noun} ${rateWord(nc.peak)}`;
  if (nc.wetNow) return nc.end ? `${cap(w)} fino alle ${fmt.hm(nc.end)} circa.` : `${cap(w)} per almeno due ore.`;
  return `${cap(w)} dalle ${fmt.hm(nc.start)} circa.`;
}

const RISK_FOR = { idraulico: 'piene dei fiumi', idrogeologico: 'frane e allagamenti', temporali: 'temporali' };
const RISK_KEYS = ['idraulico', 'idrogeologico', 'temporali'];
const LEVEL_NAME = ['nessuna allerta', 'allerta gialla', 'allerta arancione', 'allerta rossa'];

export const alertMax = (levels) => (levels ? Math.max(0, ...levels.filter((v) => v != null)) : 0);
export function alertRisks(levels, level) {
  return RISK_KEYS.filter((_, i) => levels?.[i] === level).map((k) => RISK_FOR[k]);
}
const joinIt = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} e ${a.at(-1)}`);

// "Allerta arancione oggi per temporali", oppure null se non c'è nessuna allerta.
export function alertHeadline(a) {
  if (!a || a.outside) return null;
  const t = alertMax(a.today);
  const m = alertMax(a.tomorrow);
  if (!t && !m) return null;
  const [lv, when, levels] = t >= m || t >= 2 ? [t, 'oggi', a.today] : [m, 'domani', a.tomorrow];
  if (!lv) return null;
  return { level: lv, text: `${cap(LEVEL_NAME[lv])} ${when} per ${joinIt(alertRisks(levels, lv))}` };
}

export function alertDayText(levels) {
  if (!levels) return 'non ancora pubblicata';
  const lv = alertMax(levels);
  if (!lv) return 'nessuna allerta';
  const parts = [];
  for (let l = 3; l >= 1; l--) {
    const r = alertRisks(levels, l);
    if (r.length) parts.push(`${LEVEL_NAME[l]} per ${joinIt(r)}`);
  }
  return parts.join('; ');
}

export const AQI_WORDS = ['buona', 'discreta', 'moderata', 'scadente', 'molto scadente', 'pessima'];

export function airText(air) {
  if (!air || air.aqi == null) return '';
  let s = `${cap(AQI_WORDS[air.level])} (indice ${f0(air.aqi)})`;
  if (air.main) s += `, per ${air.main}`;
  if (air.later) s += `; più tardi ${AQI_WORDS[air.later.level]}`;
  return s;
}

export function pollenText(air) {
  if (!air?.pollen?.length) return '';
  const words = ['', 'bassa', 'media', 'alta'];
  return air.pollen.map((p) => `${p.name} ${words[p.level]}`).join(', ');
}

export function seaText(sea, compact = false) {
  if (!sea) return '';
  const parts = [];
  const h = isNum(sea.todayMax) ? sea.todayMax : sea.waveNow;
  if (isNum(h)) parts.push(`${cap(seaWordIt(h))}, onde fino a ${f1(h)} m`);
  if (isNum(sea.sst)) parts.push(`acqua ${f0(sea.sst)}°`);
  if (!compact && isNum(sea.tomorrowMax) && Math.abs(sea.tomorrowMax - (h ?? 0)) >= 0.3) parts.push(`domani ${seaWordIt(sea.tomorrowMax)} (${f1(sea.tomorrowMax)} m)`);
  return parts.join(', ') + (!compact && sea.km > 8 ? ` (a ${f0(sea.km)} km)` : '');
}

function seaWordIt(h) {
  if (h < 0.05) return 'calmo';
  if (h <= 0.1) return 'quasi calmo';
  if (h <= 0.5) return 'poco mosso';
  if (h <= 1.25) return 'mosso';
  if (h <= 2.5) return 'molto mosso';
  if (h <= 4) return 'agitato';
  if (h <= 6) return 'molto agitato';
  if (h <= 9) return 'grosso';
  return 'molto grosso';
}

// Quote con il punto delle migliaia (2.750 m), uguale su tutti i telefoni.
export const meters = (m) => `${String(Math.round(m / 50) * 50).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} m`;

export function freezingText(day, elevation) {
  const f = day?.freezing;
  if (!f) return '';
  const ground = isNum(elevation) ? elevation : 0;
  if (f.med <= ground + 100) return 'Zero termico al suolo: gelo';
  const range = f.max - f.min >= 400 ? `tra ${meters(f.min)} e ${meters(f.max)}` : `intorno a ${meters(f.med)}`;
  const snow = isNum(day.snowLine) && day.snowLine < 2600 && day.pop >= 0.3
    ? `; se precipita, neve ${day.snowLine <= ground + 150 ? 'fino in basso' : `oltre i ${meters(day.snowLine)}`}`
    : '';
  return `Zero termico ${range}${snow}`;
}

export function uvText(uv) {
  if (!isNum(uv)) return '';
  const w = uv < 3 ? 'basso' : uv < 6 ? 'moderato' : uv < 8 ? 'alto' : uv < 11 ? 'molto alto' : 'estremo';
  return `${cap(w)}, ${f0(uv)}${uv >= 6 ? ': meglio la crema solare' : ''}`;
}

/* ------------------------------------------------------------------ */
/* Messaggio per Claude                                                 */
/* ------------------------------------------------------------------ */

export function buildPrompt({ place, result, skill, weights, evaluation, truthLabel, question, full, extra = {} }) {
  const fmt = makeFormatters(result.tz);
  const L = [];
  const nModels = result.models.length;
  const names = result.models.map(shortName).join(', ');
  const local = result.models.filter((m) => (MODEL_BY_ID[m]?.days ?? 99) < 7);
  const horizon = local.length
    ? ` I modelli locali si fermano prima (${local.map((m) => `${shortName(m)} dopo ${MODEL_BY_ID[m].days} giorni`).join(', ')}): per questo nei giorni lontani il numero dei modelli scende.`
    : '';
  L.push(`Sei un meteorologo esperto. Ti passo la previsione per ${place.name}${place.admin ? ` (${place.admin})` : ''}, ${place.elevation != null ? `${Math.round(place.elevation)} m s.l.m., ` : ''}preparata dalla mia app meteo: è la media pesata di ${nModels} modelli (${names}), con gli errori sistematici di ogni modello corretti confrontando le sue previsioni degli ultimi 35 giorni con i dati reali (${truthLabel || 'analisi ECMWF'}). I modelli che qui hanno sbagliato meno pesano di più.${horizon}${extra.alerts ? ' Le allerte sono quelle ufficiali della Protezione Civile, non una previsione dell\'app.' : ''}`);
  L.push('');
  const q = (question || '').trim();
  if (q) L.push(`La mia domanda: «${q}»`);
  L.push(`Rispondi in italiano, in modo semplice e breve: 1) com'è il tempo nei prossimi giorni; 2) cosa è sicuro e cosa è incerto, e perché; 3) ${q ? 'la risposta alla mia domanda' : 'un consiglio pratico'}. Non inventare dati che non sono qui sotto.`);
  L.push('');

  const nowH = result.hours.find((h) => h && h.t >= result.now - 1800) || null;
  if (nowH) {
    L.push(`ADESSO (${fmt.weekdayLong(nowH.t)} ${fmt.dayMonth(nowH.t)}, ore ${fmt.hm(result.now)}): ${f1(nowH.temp)}°, ${describe(nowH.code).toLowerCase()}, vento ${windText(nowH.wind, nowH.dir)}.`);
  }
  const al = extra.alerts;
  if (al && !al.outside) {
    L.push(`ALLERTE UFFICIALI (Protezione Civile, zona "${al.zone}", bollettino del ${al.date.split('-').reverse().join('/')} ore ${al.time}): oggi ${alertDayText(al.today)}; domani ${alertDayText(al.tomorrow)}.`);
  }
  const nc = extra.nowcast;
  if (nc) {
    L.push(full && nc.any
      ? `PROSSIME 2 ORE (pioggia ogni 15 minuti, mm): ${nc.steps.map((s) => `${fmt.hm(s.t)} ${mm(s.mm)}`).join(', ')}.`
      : `PROSSIME 2 ORE: ${nowcastText(nc, fmt).toLowerCase()}`);
  }

  const step = full ? 3 : 3;
  const span = full ? 48 : 24;
  const hs = result.hours.filter((h) => h && h.t >= result.now - 1800 && h.t <= result.now + span * 3600);
  L.push(`PROSSIME ${span} ORE (ogni ${step} ore: ora, temperatura, prob. precipitazioni, pioggia in mm o neve in cm, vento km/h, nuvole):`);
  const rows = [];
  for (let k = 0; k < hs.length; k += step) {
    const h = hs[k];
    const r = rose(h.dir);
    const q = amount(h.precip, h.snow);
    rows.push(`${fmt.hour(h.t)}h ${f0(h.temp)}° ${pct(h.pop)} ${q.snow ? `neve ${q.text.replace(' ', '')}` : q.text.replace(' ', '')} ${r ? r[0] : ''}${f0(h.wind)} nuv${f0(h.cloud)}%${full ? ` (modelli ${f0(h.lo)}…${f0(h.hi)}°)` : ''}`);
  }
  L.push(rows.join(' | '));
  L.push('');

  L.push('GIORNI (min/max corretti; tra parentesi la media 1991-2020; pioggia: probabilità e mm; vento max; fiducia):');
  for (const d of result.days) {
    const label = d.dayIndex === 0 ? 'oggi' : `${fmt.weekday(d.t + 43200)} ${fmt.dayNum(d.t + 43200)}`;
    const norm = d.normal && isNum(d.normal.tmax) ? ` (media ${f0(d.normal.tmin)}/${f0(d.normal.tmax)})` : '';
    const range = full ? ` [max tra i modelli ${f0(d.tmaxLo)}…${f0(d.tmaxHi)}°]` : '';
    const conf = CONF_LABEL[d.conf.level].replace('Fiducia ', '');
    const why = d.conf.reasons.map(reasonText).join('; ');
    const q = amount(d.precip, d.snow);
    const rain = d.wetCount === 0 && d.pop < 0.15 && (d.snow || 0) < 0.5
      ? `niente pioggia né neve (0 modelli su ${d.nRain})`
      : q.snow
        ? `prob. precipitazioni ${pct(d.pop)}, neve ${q.text} (la prevedono ${d.snowCount} modelli su ${d.nSnow})`
        : `prob. pioggia ${pct(d.pop)}, ${mm(d.precip)} mm${(d.snow || 0) >= 0.5 ? ` e ${cm(d.snow)} cm di neve` : ''} (la prevedono ${d.wetCount} modelli su ${d.nRain})`;
    const frz = full && d.freezing ? `, zero termico ${meters(d.freezing.med)}` : '';
    L.push(`- ${label}: ${f0(d.tmin)}/${f0(d.tmax)}°${norm}${range}, ${describe(d.code).toLowerCase()}, ${rain}, vento max ${f0(d.windMax)}${isNum(d.gustMax) ? `, raffiche ${f0(d.gustMax)}` : ''} km/h${frz}; fiducia ${conf} (${why})`);
  }
  const ext = extra.extended || [];
  if (ext.length) {
    L.push(full
      ? `TENDENZA FINO A 15 GIORNI (ensemble ECMWF di ${ext[0].members} simulazioni: mediana min/max e, tra parentesi, l'intervallo dove cade l'80% delle simulazioni; quota di simulazioni con almeno 1 mm di pioggia):`
      : `TENDENZA FINO A 15 GIORNI (ensemble ECMWF: mediana min/max, quota di simulazioni con pioggia):`);
    L.push(ext.map((d) => `${fmt.weekday(d.t + 43200)} ${fmt.dayNum(d.t + 43200)} ${f0(d.tmin.p50)}/${f0(d.tmax.p50)}°${full ? ` (max ${f0(d.tmax.p10)}…${f0(d.tmax.p90)})` : ''} ${d.snowy && d.snowy >= d.wet / 2 ? 'neve' : 'pioggia'} ${pct(d.pop ?? 0)}`).join(' | '));
  }
  const outdoor = [];
  if (extra.air?.aqi != null) outdoor.push(`aria ${airText(extra.air).toLowerCase()}`);
  if (extra.air?.pollen?.length) outdoor.push(`pollini: ${pollenText(extra.air).toLowerCase()}`);
  if (extra.sea) outdoor.push(`mare: ${seaText(extra.sea).toLowerCase()}`);
  if (result.days[0]?.uv != null) outdoor.push(`UV massimo ${f0(result.days[0].uv)}`);
  if (outdoor.length) L.push(`OGGI ALL'APERTO: ${outdoor.join('; ')}.`);
  L.push('');

  const ranked = Object.keys(weights.t1 || {})
    .filter((m) => skill[m]?.t1)
    .sort((a, b) => weights.t1[b] - weights.t1[a]);
  if (ranked.length) {
    L.push('AFFIDABILITÀ DEI MODELLI QUI (temperatura prevista 1 giorno prima: errore medio dopo la correzione, tendenza originale, peso):');
    L.push(ranked.map((m) => {
      const st = skill[m].t1;
      return `${shortName(m)} ${f1(st.maeCorr)}° (tend. ${signed(st.bias)}°, peso ${pct(weights.t1[m])})`;
    }).join('; '));
    const rainRows = ranked.filter((m) => skill[m]?.rain).map((m) => `${shortName(m)} ${skill[m].rain.hit + skill[m].rain.cn}/${skill[m].rain.nDays}`);
    if (rainRows.length) L.push(`Giorni di pioggia/asciutto indovinati: ${rainRows.join(', ')}.`);
  }
  if (evaluation) {
    L.push(`Prova sugli ultimi ${evaluation.testDays} giorni: errore medio del metodo ${f1(evaluation.maeOurs)}°, media semplice dei modelli ${f1(evaluation.maeMean)}°, miglior modello singolo (${shortName(evaluation.best)}) ${f1(evaluation.maeBest)}°.`);
  }
  const ds = extra.diary;
  if (ds?.n) {
    L.push(`Diario dell'app (previsioni salvate il giorno prima e confrontate con i dati veri, ultimi ${ds.n} giorni): massima sbagliata in media di ${f1(ds.maeMax)}°, minima di ${f1(ds.maeMin)}°${ds.rainN ? `, pioggia sì/no indovinata ${ds.rainOk} volte su ${ds.rainN}` : ''}.`);
  }
  return L.join('\n');
}

/* ------------------------------------------------------------------ */
/* Diario                                                               */
/* ------------------------------------------------------------------ */

export function diarySummaryText(s, sourceLabel) {
  if (!s?.n) return '';
  const rain = s.rainN ? ` La pioggia sì o no è stata giusta ${s.rainOk} ${s.rainOk === 1 ? 'volta' : 'volte'} su ${s.rainN}.` : '';
  return `In ${s.n} ${s.n === 1 ? 'giorno' : 'giorni'} la massima prevista il giorno prima ha sbagliato in media di ${f1(s.maeMax)}°, la minima di ${f1(s.maeMin)}°.${rain} Dati veri: ${sourceLabel}.`;
}

export function claudeUrl(prompt) {
  return `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
}
