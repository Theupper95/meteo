// Allerte ufficiali: il bollettino di criticità del Dipartimento della Protezione Civile,
// pubblicato ogni giorno (di norma entro le 16) come dati aperti su GitHub (CC BY 4.0).
// Non è una previsione di Isobara: viene mostrato a parte, così com'è.

import { getJSON } from './api.js';
import { decodeArcs, joinArcs } from './topo.js';

const REPO = 'pcm-dpc/DPC-Bollettini-Criticita-Idrogeologica-Idraulica';
const GH = `https://api.github.com/repos/${REPO}`;
const RAW = `https://raw.githubusercontent.com/${REPO}/master/files/`;
export const OFFICIAL_URL = 'https://mappe.protezionecivile.gov.it/it/mappe-rischi/bollettino-di-criticita/';

export const RISKS = [
  ['idraulico', 'Per rischio idraulico', 'Fiumi'],
  ['idrogeologico', 'Per rischio idrogeologico', 'Frane e allagamenti'],
  ['temporali', 'Per rischio temporali', 'Temporali'],
];
export const LEVEL_WORDS = ['Nessuna allerta', 'Allerta gialla', 'Allerta arancione', 'Allerta rossa'];
export const LEVEL_SHORT = ['nessuna', 'gialla', 'arancione', 'rossa'];

export function levelOf(s) {
  const v = String(s || '').toUpperCase();
  if (v.includes('ROSSA')) return 3;
  if (v.includes('ARANCIONE')) return 2;
  if (v.includes('GIALLA')) return 1;
  return 0;
}

export const bulletinDate = (name) => `${name.slice(0, 4)}-${name.slice(4, 6)}-${name.slice(6, 8)}`;
export const bulletinTime = (name) => `${name.slice(9, 11)}:${name.slice(11, 13)}`;
const topoUrl = (name, part) => `${RAW}topojson/${name}_${part}.json`;

// Nome dell'ultimo bollettino (es. 20261018_1443): l'ultimo file TopoJSON pubblicato.
export async function latestBulletin(opts) {
  const list = await getJSON(`${GH}/commits?path=files/topojson&per_page=1`, { timeout: 12000, ...opts });
  const sha = list?.[0]?.sha;
  if (!sha) return null;
  const det = await getJSON(`${GH}/commits/${sha}`, { timeout: 12000, ...opts });
  for (const f of det.files || []) {
    const m = /files\/topojson\/(\d{8}_\d{4})_/.exec(f.filename || '');
    if (m) return m[1];
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* TopoJSON: livelli per zona e zona del luogo                          */
/* ------------------------------------------------------------------ */

const zonesOf = (topo) => Object.values(topo?.objects || {})[0]?.geometries || [];

export function readLevels(topo) {
  const out = {};
  for (const g of zonesOf(topo)) {
    const p = g.properties || {};
    const name = p['Nome zona'];
    if (name) out[name] = RISKS.map(([, key]) => (p[key] == null ? null : levelOf(p[key])));
  }
  return out;
}

const polygonsOf = (g) => (g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : []);

function inRing(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segDist2(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const L = dx * dx + dy * dy;
  const u = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  const qx = ax + u * dx - px, qy = ay + u * dy - py;
  return qx * qx + qy * qy;
}

// La zona di allerta che contiene il punto; se il punto cade appena fuori (sulla costa),
// la zona più vicina entro circa 6 km.
export function findZone(topo, lat, lon) {
  const arcs = decodeArcs(topo);
  const kx = Math.cos((lat * Math.PI) / 180);
  let nearest = null;
  for (const g of zonesOf(topo)) {
    const name = g.properties?.['Nome zona'];
    if (!name) continue;
    for (const poly of polygonsOf(g)) {
      let inside = false;
      for (const ring of poly) {
        const pts = joinArcs(ring, arcs);
        if (inRing(lon, lat, pts)) inside = !inside;
        for (let k = 1; k < pts.length; k++) {
          const d = segDist2(lon * kx, lat, [pts[k - 1][0] * kx, pts[k - 1][1]], [pts[k][0] * kx, pts[k][1]]);
          if (!nearest || d < nearest.d) nearest = { d, name };
        }
      }
      if (inside) return name;
    }
  }
  return nearest && Math.sqrt(nearest.d) < 0.055 ? nearest.name : null;
}

/* ------------------------------------------------------------------ */
/* Testo nazionale del bollettino                                       */
/* ------------------------------------------------------------------ */

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', egrave: 'è', eacute: 'é', agrave: 'à', ograve: 'ò', ugrave: 'ù', igrave: 'ì' };
const decode = (s) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);

// Dal testo HTML del bollettino ai gruppi: livello, rischio e regioni con le zone.
export function parseNational(html) {
  const lines = String(html || '')
    .split(/<br\s*\/?>/i)
    .map((s) => decode(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const groups = [];
  for (const line of lines) {
    const head = /PER RISCHIO ([A-Z]+).*ALLERTA ([A-Z]+)/i.exec(line);
    if (head) {
      groups.push({ risk: head[1].toLowerCase(), level: levelOf(head[2]), regions: [] });
      continue;
    }
    const reg = /^([^:]{2,40}):\s*(.+)$/.exec(line);
    if (reg && groups.length) groups.at(-1).regions.push({ region: reg[1], zones: reg[2] });
  }
  return groups;
}

/* ------------------------------------------------------------------ */
/* Aggiornamento con memoria                                            */
/* ------------------------------------------------------------------ */

let lastTopo = null; // {name, topo}: l'ultima geometria scaricata, per cercare la zona di altri luoghi

const romeDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));

// Restituisce le allerte di oggi e domani per il luogo; scarica solo ciò che manca.
// store: {get, set}. Le richieste a GitHub sono al massimo una ogni 40 minuti.
export async function getAlerts(place, store, { force = false, now = Date.now() } = {}) {
  let latest = store.get('alerts.latest');
  if (force || !latest || now - latest.at > 40 * 60e3) {
    try {
      const name = await latestBulletin();
      if (name) latest = { name, at: now };
      store.set('alerts.latest', latest);
    } catch (e) {
      if (!latest) throw e;
    }
  }
  if (!latest?.name) return null;
  const name = latest.name;
  const date = bulletinDate(name);
  const today = romeDay(now);
  const yesterday = romeDay(now - 86400e3);
  // Il bollettino di ieri pomeriggio vale per oggi con la sua parte "domani".
  const want = date === today ? ['today', 'tomorrow'] : date === yesterday ? ['tomorrow'] : [];

  let data = store.get('alerts.data');
  if (!data || data.name !== name) data = { name, parts: {}, text: {} };
  const missing = want.filter((p) => !data.parts[p]);
  if (missing.length) {
    const index = await getJSON(`${RAW}${name}.json`, { timeout: 15000 }).catch(() => null);
    for (const part of missing) {
      const url = index?.[part]?.topo_json || topoUrl(name, part);
      const topo = await getJSON(url, { timeout: 45000 });
      data.parts[part] = readLevels(topo);
      data.text[part] = index?.[part]?.html_descrition || '';
      lastTopo = { name, topo };
    }
    store.set('alerts.data', data);
  }

  let zone = store.get(`zone.${place.id}`);
  const known = Object.keys(data.parts.today || data.parts.tomorrow || {});
  if (!zone || (zone.name && known.length && !known.includes(zone.name))) {
    let topo = lastTopo?.topo;
    if (!topo) {
      topo = await getJSON(topoUrl(name, want[0] || 'today'), { timeout: 45000 });
      lastTopo = { name, topo };
    }
    const z = findZone(topo, place.lat, place.lon);
    zone = z ? { name: z } : { none: true };
    store.set(`zone.${place.id}`, zone);
  }
  if (!zone.name) return { name, date, outside: true };

  const pick = (part) => data.parts[part]?.[zone.name] || null;
  return {
    name, date, time: bulletinTime(name),
    zone: zone.name,
    today: date === today ? pick('today') : date === yesterday ? pick('tomorrow') : null,
    tomorrow: date === today ? pick('tomorrow') : null,
    stale: !want.length,
    national: {
      today: parseNational(date === today ? data.text.today : date === yesterday ? data.text.tomorrow : ''),
      tomorrow: parseNational(date === today ? data.text.tomorrow : ''),
    },
  };
}

export const maxLevel = (levels) => (levels ? Math.max(0, ...levels.filter((v) => v != null)) : 0);
