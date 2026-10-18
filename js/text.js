// Testi in italiano: descrizioni, numeri, frasi di sintesi e il messaggio per Claude.

import { isNum } from './engine.js';
import { shortName } from './models.js';

const nf1 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const MINUS = '−';

export const f1 = (x) => (isNum(x) ? nf1.format(x).replace('-', MINUS) : '–');
export const f0 = (x) => (isNum(x) ? String(Math.round(x)).replace('-', MINUS) : '–');
export const deg = (x) => `${f0(x)}°`;
export const pct = (p) => `${Math.round(p * 100)}%`;
export const mm = (x) => (x < 0.05 ? '0' : x < 10 ? nf1.format(x) : String(Math.round(x)));
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
/* Messaggio per Claude                                                 */
/* ------------------------------------------------------------------ */

export function buildPrompt({ place, result, skill, weights, evaluation, truthLabel, question, full }) {
  const fmt = makeFormatters(result.tz);
  const L = [];
  const nModels = result.models.length;
  const names = result.models.map(shortName).join(', ');
  L.push(`Sei un meteorologo esperto. Ti passo la previsione per ${place.name}${place.admin ? ` (${place.admin})` : ''}, ${place.elevation != null ? `${Math.round(place.elevation)} m s.l.m., ` : ''}preparata dalla mia app meteo: è la media pesata di ${nModels} modelli (${names}), con gli errori sistematici di ogni modello corretti confrontando le sue previsioni degli ultimi 35 giorni con i dati reali (${truthLabel || 'analisi ECMWF'}). I modelli che qui hanno sbagliato meno pesano di più.`);
  L.push('');
  const q = (question || '').trim();
  if (q) L.push(`La mia domanda: «${q}»`);
  L.push(`Rispondi in italiano, in modo semplice e breve: 1) com'è il tempo nei prossimi giorni; 2) cosa è sicuro e cosa è incerto, e perché; 3) ${q ? 'la risposta alla mia domanda' : 'un consiglio pratico'}. Non inventare dati che non sono qui sotto.`);
  L.push('');

  const nowH = result.hours.find((h) => h && h.t >= result.now - 1800) || null;
  if (nowH) {
    L.push(`ADESSO (${fmt.weekdayLong(nowH.t)} ${fmt.dayMonth(nowH.t)}, ore ${fmt.hm(result.now)}): ${f1(nowH.temp)}°, ${describe(nowH.code).toLowerCase()}, vento ${windText(nowH.wind, nowH.dir)}.`);
  }

  const step = full ? 3 : 3;
  const span = full ? 48 : 24;
  const hs = result.hours.filter((h) => h && h.t >= result.now - 1800 && h.t <= result.now + span * 3600);
  L.push(`PROSSIME ${span} ORE (ogni ${step} ore: ora, temperatura, prob. pioggia, mm, vento km/h, nuvole):`);
  const rows = [];
  for (let k = 0; k < hs.length; k += step) {
    const h = hs[k];
    const r = rose(h.dir);
    rows.push(`${fmt.hour(h.t)}h ${f0(h.temp)}° ${pct(h.pop)} ${mm(h.precip)}mm ${r ? r[0] : ''}${f0(h.wind)} nuv${f0(h.cloud)}%${full ? ` (modelli ${f0(h.lo)}…${f0(h.hi)}°)` : ''}`);
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
    const rain = d.wetCount === 0 && d.pop < 0.15
      ? `niente pioggia (0 modelli su ${d.nRain})`
      : `prob. pioggia ${pct(d.pop)}, ${mm(d.precip)} mm (la prevedono ${d.wetCount} modelli su ${d.nRain})`;
    L.push(`- ${label}: ${f0(d.tmin)}/${f0(d.tmax)}°${norm}${range}, ${describe(d.code).toLowerCase()}, ${rain}, vento max ${f0(d.windMax)}${isNum(d.gustMax) ? `, raffiche ${f0(d.gustMax)}` : ''} km/h; fiducia ${conf} (${why})`);
  }
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
  return L.join('\n');
}

export function claudeUrl(prompt) {
  return `https://claude.ai/new?q=${encodeURIComponent(prompt)}`;
}
