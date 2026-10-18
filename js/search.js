// Ricerca dei luoghi per qualsiasi parte del nome.
// La ricerca di Open-Meteo trova solo i nomi che iniziano con il testo scritto: "lazzaro" non trova
// San Lazzaro di Savena. Per questo c'è anche l'elenco dei 7.896 comuni italiani (data/comuni.json),
// scaricato alla prima ricerca e poi conservato per l'uso senza rete. I due elenchi si uniscono:
// prima i nomi che corrispondono meglio, a parità i luoghi più abitati.

import { getJSON } from './api.js';
import { distanceKm } from './stations.js';

const INDEX_URL = 'data/comuni.json';

// minuscole, senza accenti, solo lettere e cifre separate da uno spazio: "Forlì" → "forli", "L'Aquila" → "l aquila"
export const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const prepare = (text) => {
  const key = fold(text);
  return { key, words: key ? key.split(' ') : [], flat: key.replace(/ /g, '') };
};

export function buildIndex(data) {
  const regions = (data?.regioni || []).map((r) => r.split('/')[0]);
  return (data?.comuni || []).map(([name, prov, reg, lat, lon, pop = 0, cap = 0]) => ({
    name, prov, region: regions[reg] || '', lat: lat / 1000, lon: lon / 1000, pop: pop * 100, cap: cap === 1,
    ...prepare(name),
  }));
}

let indexPromise = null;
export function loadComuni() {
  indexPromise ??= getJSON(INDEX_URL, { timeout: 20000 }).then(buildIndex).catch((e) => { indexPromise = null; throw e; });
  return indexPromise;
}

// Quanto un nome corrisponde al testo scritto, da 100 (identico) a 0 (per niente).
function score(e, q) {
  if (!q.key || !e.key) return 0;
  if (e.key === q.key) return 100;
  if (e.flat === q.flat) return 95; // "san remo" e Sanremo
  if (e.key.startsWith(q.key)) return 90;
  // ogni parola scritta è l'inizio di una parola del nome: "lazzaro", "mauro pascoli", "reggio emilia"
  let pos = 0;
  const inOrder = q.words.every((w) => {
    while (pos < e.words.length && !e.words[pos].startsWith(w)) pos++;
    return pos++ < e.words.length;
  });
  if (inOrder) return 80;
  const free = [...e.words];
  const anyOrder = q.words.every((w) => {
    const i = free.findIndex((x) => x.startsWith(w));
    if (i < 0) return false;
    free.splice(i, 1);
    return true;
  });
  if (anyOrder) return 75;
  if (q.flat.length >= 3 && e.flat.startsWith(q.flat)) return 70; // "sanlazzaro"
  if (q.key.length >= 3 && e.key.includes(q.key)) return 60; // dentro una parola: "azzaro"
  if (q.flat.length >= 4 && e.flat.includes(q.flat)) return 55;
  return 0;
}
export const matchScore = (name, text) => score(prepare(name), prepare(text));

// A parità di corrispondenza vince il luogo più abitato: dieci volte gli abitanti valgono 4 punti.
const rank = (s, pop, cap) => s + 4 * Math.log10((pop || 0) + 1) + (cap ? 3 : 0);

export function searchIndex(index, text, limit = 8) {
  const q = prepare(text);
  if (q.key.length < 2) return [];
  const hits = [];
  for (const e of index || []) {
    const s = score(e, q);
    if (s) hits.push({ e, s, r: rank(s, e.pop, e.cap) });
  }
  hits.sort((a, b) => b.r - a.r || a.e.key.length - b.e.key.length);
  return hits.slice(0, limit).map(({ e, s, r }) => ({
    name: e.name, admin: `${e.prov}, ${e.region}`, prov: e.prov, region: e.region,
    lat: e.lat, lon: e.lon, elevation: null, cc: 'IT', pop: e.pop, local: true, score: s, rank: r,
  }));
}

// Stesso nome: uguali, o uno contenuto nell'altro parola per parola
// ("Bolzano" e "Bolzano/Bozen", "Reggio Emilia" e "Reggio nell'Emilia").
export function sameName(a, b) {
  const A = prepare(a).words, B = prepare(b).words;
  if (!A.length || !B.length) return false;
  const [small, big] = A.length <= B.length ? [A, B] : [B, A];
  return small.every((w) => big.includes(w));
}
const samePlace = (local, remote) => (remote.cc || 'IT') === 'IT' && sameName(local.name, remote.name) && distanceKm(local, remote) <= 12;

// Unisce i risultati di Open-Meteo (solo l'inizio del nome, ma in tutto il mondo e con le frazioni)
// con quelli dei comuni italiani. Un comune trovato da entrambi tiene le coordinate di Open-Meteo,
// che sono quelle del paese, e prende la sigla della provincia.
export function mergeResults(remote, local, text, limit = 8) {
  const q = prepare(text);
  const out = (remote || []).map((r) => {
    // Open-Meteo confronta anche i nomi in altre lingue ("paris" trova Parigi): almeno un inizio di nome
    const s = Math.max(88, score(prepare(r.name), q));
    return { ...r, score: s, rank: rank(s, r.pop, false) };
  });
  const twins = new Set();
  for (const l of local || []) {
    const twin = out.find((r) => !twins.has(r) && samePlace(l, r));
    if (!twin) { out.push({ ...l }); continue; }
    twins.add(twin);
    twin.admin = `${l.prov}, ${twin.admin || l.region}`;
    twin.rank = Math.max(twin.rank, l.rank);
  }
  return out.sort((a, b) => b.rank - a.rank).slice(0, limit);
}

// Il punto di un comune è dentro il suo territorio ma non per forza in paese: quando lo si sceglie,
// si cerca il centro abitato con lo stesso nome entro 20 km e se ne usano coordinate e quota.
export function pickCentre(local, found) {
  let best = null;
  for (const r of found || []) {
    if ((r.cc || 'IT') !== 'IT' || !sameName(local.name, r.name)) continue;
    const km = distanceKm(local, r);
    if (km > 20) continue;
    const exact = local.name.split('/').some((part) => fold(part) === fold(r.name));
    if (!best || (exact && !best.exact) || (exact === best.exact && km < best.km)) best = { r, km, exact };
  }
  const { local: _l, score: _s, rank: _r, ...place } = local;
  if (!best) return place;
  return { ...place, lat: best.r.lat, lon: best.r.lon, elevation: best.r.elevation ?? null };
}
