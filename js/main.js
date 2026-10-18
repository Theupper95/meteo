// Isobara: interfaccia.

import { MODELS, MODEL_BY_ID, DEFAULT_MODELS, shortName } from './models.js';
import {
  parseForecast, parseBestMatch, parseVerification, computeSkill, computeWeights,
  evaluateMethod, buildForecast, computeNormals, buildExtended, parseStationCSV, stationHourly,
  dailyTruth, makeTimeTools, isNum,
} from './engine.js';
import {
  fetchForecast, fetchBestMatch, fetchPreviousRuns, fetchTruth, fetchNormals, fetchEnsemble,
  fetchAir, fetchMarine, fetchElevation, fetchStationObs, verificationWindow, searchPlaces, reverseName, getJSON,
} from './api.js';
import {
  f0, f1, deg, pct, mm, signed, describe, rose, windText, makeFormatters,
  CONF_LABEL, reasonText, nextHoursText, buildPrompt, claudeUrl,
  nowcastText, alertHeadline, alertDayText, alertMax, airText, seaText, freezingText, uvText, diarySummaryText,
} from './text.js';
import { weatherIcon, UI } from './icons.js';
import { hourStrip, stripHours, tempColor } from './chart.js';
import { createSky, skyState, toHex } from './sky.js';
import { nowcast, airSummary, seaSummary } from './extras.js';
import { getAlerts, OFFICIAL_URL, RISKS, LEVEL_WORDS } from './alerts.js';
import { pickStation } from './stations.js';

const VERSION = '3.0.0';
const VER_VERSION = 3;
const FC_FRESH = 20 * 60e3;
const VER_FRESH = 12 * 3600e3;
const NORM_FRESH = 60 * 86400e3;
const ENS_FRESH = 6 * 3600e3;
const APK_URL = 'https://github.com/Theupper95/meteo/releases/latest/download/isobara.apk';
const RELEASES_API = 'https://api.github.com/repos/Theupper95/meteo/releases/latest';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// Dentro l'app Android il sito gira in una WebView che offre condivisione, appunti e barre di sistema.
const native = window.IsobaraNative || null;
const inApp = /IsobaraApp/.test(navigator.userAgent);

const QUICK = [
  { name: 'Roma', admin: 'Lazio', lat: 41.8919, lon: 12.5113 },
  { name: 'Milano', admin: 'Lombardia', lat: 45.4643, lon: 9.1895 },
  { name: 'Napoli', admin: 'Campania', lat: 40.8522, lon: 14.2681 },
  { name: 'Torino', admin: 'Piemonte', lat: 45.0705, lon: 7.6868 },
  { name: 'Bologna', admin: 'Emilia-Romagna', lat: 44.4938, lon: 11.3387 },
  { name: 'Firenze', admin: 'Toscana', lat: 43.7793, lon: 11.2463 },
  { name: 'Bari', admin: 'Puglia', lat: 41.1177, lon: 16.8512 },
  { name: 'Palermo', admin: 'Sicilia', lat: 38.1157, lon: 13.3615 },
  { name: 'Venezia', admin: 'Veneto', lat: 45.4371, lon: 12.3326 },
  { name: 'Genova', admin: 'Liguria', lat: 44.4048, lon: 8.9444 },
  { name: 'Cagliari', admin: 'Sardegna', lat: 39.2305, lon: 9.1191 },
];

/* ------------------------------------------------------------------ */
/* Memoria del telefono                                                 */
/* ------------------------------------------------------------------ */

const store = {
  get(k, def = null) {
    try { const v = localStorage.getItem(`isobara.${k}`); return v ? JSON.parse(v) : def; } catch { return def; }
  },
  set(k, v) {
    try { localStorage.setItem(`isobara.${k}`, JSON.stringify(v)); return true; } catch { return false; }
  },
  del(k) { try { localStorage.removeItem(`isobara.${k}`); } catch { /* niente */ } },
};

// Tiene i dati degli ultimi 6 luoghi aperti; se la memoria è piena tiene solo l'ultimo.
function saveRecent(prefix, id, value) {
  const listKey = `${prefix}Keys`;
  let keys = store.get(listKey, []).filter((k) => k !== id);
  keys.unshift(id);
  for (const old of keys.slice(6)) store.del(`${prefix}.${old}`);
  keys = keys.slice(0, 6);
  store.set(listKey, keys);
  if (!store.set(`${prefix}.${id}`, value)) {
    for (const old of keys.slice(1)) store.del(`${prefix}.${old}`);
    store.set(listKey, [id]);
    store.set(`${prefix}.${id}`, value);
  }
}

const placeId = (p) => `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
const modelsKey = (ms) => [...ms].sort().join(',');
const savePlaces = () => store.set('places', state.places);

/* ------------------------------------------------------------------ */
/* Stato                                                                */
/* ------------------------------------------------------------------ */

const state = {
  places: store.get('places', []),
  currentId: store.get('current', null),
  models: (store.get('models', DEFAULT_MODELS) || []).filter((m) => MODEL_BY_ID[m]),
  loading: false,
  verLoading: false,
  error: null,
  verError: null,
  cache: { fc: null, ver: null, norm: null, ens: null },
  alerts: null,
  view: null,
  preview: null,
  openDay: null,
  revealed: null,
  question: '',
  results: [],
  searching: false,
  searchError: null,
  gpsMessage: null,
  update: null,
};
if (state.models.length < 2) state.models = [...DEFAULT_MODELS];
const currentPlace = () => state.places.find((p) => p.id === state.currentId) || null;

/* ------------------------------------------------------------------ */
/* Cielo                                                                */
/* ------------------------------------------------------------------ */

const sky = createSky($('#sky'));
sky.set({
  colors: [[3, 5, 11], [6, 9, 20], [10, 15, 30]], textDark: false,
  sun: { el: -30, az: 0, glow: 0 }, stars: 0, clouds: 0, rain: 0, snow: 0, fog: 0, night: true,
}, { instant: true });

function kindOf(code) {
  if (code == null) return null;
  if (code >= 95) return 'thunder';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if (code === 45 || code === 48) return 'fog';
  return null;
}

function updateSky() {
  const place = currentPlace() || QUICK[0];
  const v = state.view;
  let h = null;
  let time = Date.now();
  if (v) {
    const hs = stripHours(v.result);
    if (state.preview != null && hs[state.preview]) { h = hs[state.preview]; time = h.t * 1000; }
    else h = nowValues(v.result);
  }
  const st = skyState({
    lat: place.lat, lon: place.lon, time,
    cloud: h?.cloud ?? 18, precip: h?.precip ?? 0, pop: h?.pop ?? 0, kind: kindOf(h?.code),
  });
  sky.set(st);
  const root = document.documentElement;
  root.classList.toggle('ink', st.textDark);
  root.style.setProperty('--sky-mid', toHex(st.colors[1]));
  $('#themeColor').setAttribute('content', toHex(st.colors[0]));
  try { native?.setBars?.(toHex(st.colors[0]), !!st.textDark); } catch { /* app vecchia */ }
}

/* ------------------------------------------------------------------ */
/* Dati                                                                 */
/* ------------------------------------------------------------------ */

let loadToken = 0;
let fcPromise = null;

function compute() {
  const c = state.cache;
  const place = currentPlace();
  if (!c.fc || !place) { state.view = null; return; }
  const fc = parseForecast(c.fc.fc, c.fc.models);
  const bm = parseBestMatch(c.fc.bm);
  const models = Object.keys(fc.models);
  if (!models.length) { state.view = null; state.error = { message: 'Nessun modello ha dati per questo luogo' }; return; }
  const skill = c.ver?.skill || {};
  const weights = computeWeights(skill, models);
  const now = Date.now() / 1000;
  const result = buildForecast({ fc, bm, skill, weights, now, normals: c.norm?.normals || null });
  const extended = buildExtended(c.ens?.data, { tz: result.tz, skill, after: result.days.at(-1)?.key }).slice(0, 8);
  state.view = {
    fc, bm, skill, weights, result, extended,
    fetchedAt: c.fc.at,
    nowcast: nowcast(bm, now),
    air: airSummary(c.fc.aq, now, result.tz),
    sea: seaSummary(c.fc.sea, place, now, result.tz),
  };
}

// Il fuso orario del luogo arriva con la previsione; per i luoghi nuovi la si aspetta.
async function placeTz(place) {
  if (place.tz) return place.tz;
  try { await fcPromise; } catch { /* niente */ }
  return place.tz || state.cache.fc?.fc?.timezone || 'Europe/Rome';
}

async function loadVerification(place, models, token) {
  state.verLoading = true;
  render();
  try {
    const win = verificationWindow();
    if (place.elevation == null) {
      const e = await fetchElevation(place).catch(() => null);
      if (e != null) { place.elevation = e; savePlaces(); }
    }
    // Se c'è una stazione meteo vicina e alla stessa quota, la verifica si fa lì.
    const st = pickStation(place);
    const at = st ? { lat: st.lat, lon: st.lon } : place;
    const [prev, truth, csv] = await Promise.all([
      fetchPreviousRuns(at, models, win),
      fetchTruth(at, win),
      st ? fetchStationObs(st.id, win).catch(() => null) : null,
    ]);
    const obs = csv ? parseStationCSV(csv) : null;
    const station = obs?.length ? { ...stationHourly(obs), label: `stazione meteo di ${st.name}` } : null;
    const ver = parseVerification(prev.data, prev.models, truth.data, truth.models, station);
    const verModels = Object.keys(ver.fc);
    const usedStation = ver.truth.tSource === 'station';
    const tz = await placeTz(place);
    const daily = dailyTruth({ obs: usedStation ? obs : null, arch: truth.data, archModels: truth.models, tz, before: makeTimeTools(tz).dayKey(Date.now() / 1000) });
    const value = {
      v: VER_VERSION, at: Date.now(), key: modelsKey(models), window: win,
      skill: computeSkill(ver, verModels), evaluation: evaluateMethod(ver, verModels),
      truthLabel: ver.truth.tLabel, truthSource: ver.truth.tSource,
      station: usedStation ? { id: st.id, name: st.name, km: st.km, elev: st.elev } : null,
      verModels,
    };
    if (token !== loadToken) return;
    store.set(`ver.${place.id}`, value);
    state.cache.ver = value;
    state.verError = null;
    diaryAddTruth(place, daily, value);
  } catch (e) {
    if (token !== loadToken) return;
    state.verError = e;
  } finally {
    if (token === loadToken) {
      state.verLoading = false;
      compute();
      render();
    }
  }
}

async function loadNormals(place, token) {
  try {
    const normals = computeNormals(await fetchNormals(place));
    if (!normals || token !== loadToken) return;
    const value = { at: Date.now(), normals };
    store.set(`norm.${place.id}`, value);
    state.cache.norm = value;
    compute();
    render();
  } catch { /* il clima di riferimento è facoltativo */ }
}

async function loadEnsemble(place, token) {
  try {
    const data = await fetchEnsemble(place);
    if (token !== loadToken) return;
    const value = { at: Date.now(), data };
    saveRecent('ens', place.id, value);
    state.cache.ens = value;
    compute();
    render();
  } catch { /* la tendenza a 15 giorni è facoltativa */ }
}

// Aria, pollini e mare arrivano dopo la previsione e non la rallentano.
async function loadExtras(place, token) {
  const [aq, sea] = await Promise.all([
    fetchAir(place).catch(() => null),
    place.coast === false ? null : fetchMarine(place).catch(() => null),
  ]);
  if (token !== loadToken || !state.cache.fc) return;
  if (aq) state.cache.fc.aq = aq;
  if (sea) {
    const coastal = !!seaSummary(sea, place, Date.now() / 1000, sea.timezone);
    if (place.coast !== coastal) { place.coast = coastal; savePlaces(); }
    state.cache.fc.sea = coastal ? sea : null;
  }
  saveRecent('fc', place.id, state.cache.fc);
  compute();
  render();
}

const inItaly = (p) => p.lat > 35.2 && p.lat < 47.2 && p.lon > 6.5 && p.lon < 18.7;

async function loadAlerts(place, token, { force = false } = {}) {
  if (!inItaly(place)) { state.alerts = null; return; }
  try {
    const cached = await getAlerts(place, store, { network: false });
    if (token !== loadToken) return;
    if (cached) { state.alerts = cached; render(); }
    const fresh = await getAlerts(place, store, { force });
    if (token !== loadToken) return;
    state.alerts = fresh;
    render();
  } catch { /* le allerte sono facoltative: resta l'ultimo bollettino salvato */ }
}

async function load({ force = false } = {}) {
  const place = currentPlace();
  if (!place) { state.view = null; render(); updateSky(); return; }
  const token = ++loadToken;
  const key = modelsKey(state.models);
  state.cache = {
    fc: store.get(`fc.${place.id}`), ver: store.get(`ver.${place.id}`),
    norm: store.get(`norm.${place.id}`), ens: store.get(`ens.${place.id}`),
  };
  if (state.cache.fc && state.cache.fc.key !== key) state.cache.fc = null;
  if (state.cache.ver && state.cache.ver.v !== VER_VERSION) state.cache.ver = null;
  state.alerts = null;
  state.error = null;
  state.preview = null;
  compute();

  const fcStale = force || !state.cache.fc || Date.now() - state.cache.fc.at > FC_FRESH;
  const verStale = !state.cache.ver || state.cache.ver.key !== key || Date.now() - state.cache.ver.at > VER_FRESH;
  const normStale = !state.cache.norm || Date.now() - state.cache.norm.at > NORM_FRESH;
  const ensStale = force || !state.cache.ens || Date.now() - state.cache.ens.at > ENS_FRESH;

  if (fcStale) {
    fcPromise = Promise.all([fetchForecast(place, state.models), fetchBestMatch(place).catch(() => null)]);
    fcPromise.catch(() => {});
  }
  if (verStale) loadVerification(place, state.models, token);
  loadAlerts(place, token, { force });
  if (ensStale) loadEnsemble(place, token);
  if (fcStale) {
    state.loading = true;
    render();
    updateSky();
    try {
      const [f, b] = await fcPromise;
      if (token !== loadToken) return;
      const old = state.cache.fc;
      const value = { at: Date.now(), key, models: f.models, fc: f.data, bm: b, aq: old?.aq || null, sea: old?.sea || null };
      saveRecent('fc', place.id, value);
      state.cache.fc = value;
      let changed = false;
      if (place.elevation == null && isNum(f.data.elevation)) { place.elevation = f.data.elevation; changed = true; }
      if (f.data.timezone && place.tz !== f.data.timezone) { place.tz = f.data.timezone; changed = true; }
      if (changed) savePlaces();
      compute();
      if (state.view) diarySave(place, state.view);
      loadExtras(place, token);
    } catch (e) {
      if (token !== loadToken) return;
      state.error = e;
    } finally {
      if (token === loadToken) state.loading = false;
    }
  }
  if (token !== loadToken) return;
  render();
  updateSky();
  if (normStale) loadNormals(place, token);
}

/* ------------------------------------------------------------------ */
/* Diario delle previsioni                                              */
/* ------------------------------------------------------------------ */

const r1 = (x) => (isNum(x) ? Math.round(x * 10) / 10 : null);

// Ogni giorno si salva la previsione di domani (l'ultima vista in giornata) e, se l'app
// non era stata aperta il giorno prima, quella di oggi presa entro le 10 del mattino.
function diarySave(place, v) {
  const tools = makeTimeTools(v.result.tz);
  const at = v.fetchedAt / 1000;
  const fetchedKey = tools.dayKey(at);
  const hour = tools.hour(at);
  const diary = store.get(`diary.${place.id}`, {});
  for (const d of v.result.days.slice(0, 2)) {
    const lead = d.key === fetchedKey ? 0 : 1;
    const prev = diary[d.key];
    const take = lead === 1 || (hour < 10 && (!prev || prev.lead === 0));
    if (!take) continue;
    diary[d.key] = {
      tmax: r1(d.tmax), tmin: r1(d.tmin), pop: Math.round(d.pop * 100) / 100, precip: r1(d.precip),
      code: d.code, at: v.fetchedAt, lead, obs: prev?.obs || null,
    };
  }
  const keys = Object.keys(diary).sort().reverse();
  for (const k of keys.slice(60)) delete diary[k];
  store.set(`diary.${place.id}`, diary);
}

function diaryAddTruth(place, daily, ver) {
  const diary = store.get(`diary.${place.id}`, null);
  if (!diary) return;
  let changed = false;
  for (const [k, e] of Object.entries(diary)) {
    const t = daily[k];
    if (!t) continue;
    const label = t.src === 'station' && ver.station ? `stazione di ${ver.station.name}` : 'rianalisi ERA5';
    e.obs = { tmax: t.tmax, tmin: t.tmin, wet: t.wet, src: label };
    changed = true;
  }
  if (changed) store.set(`diary.${place.id}`, diary);
}

function diaryRows(place, todayKey) {
  const diary = store.get(`diary.${place.id}`, {});
  return Object.entries(diary)
    .filter(([k]) => k < todayKey)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, e]) => ({ key, ...e }));
}

function diaryStats(rows) {
  const done = rows.filter((r) => r.obs && isNum(r.obs.tmax) && isNum(r.tmax));
  if (!done.length) return { n: 0 };
  const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const rain = done.filter((r) => r.obs.wet != null);
  return {
    n: done.length,
    maeMax: avg(done.map((r) => Math.abs(r.tmax - r.obs.tmax))),
    maeMin: avg(done.map((r) => Math.abs(r.tmin - r.obs.tmin))),
    rainN: rain.length,
    rainOk: rain.filter((r) => (r.pop >= 0.5) === r.obs.wet).length,
    sources: [...new Set(done.map((r) => r.obs.src))],
  };
}

/* ------------------------------------------------------------------ */
/* Aggiornamenti dell'app Android                                       */
/* ------------------------------------------------------------------ */

const newer = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

async function checkUpdate() {
  if (!inApp) return;
  const last = store.get('updateCheck');
  if (last && Date.now() - last.at < 12 * 3600e3) {
    if (last.version && newer(last.version, VERSION)) { state.update = last; render(); }
    return;
  }
  try {
    const rel = await getJSON(RELEASES_API, { timeout: 10000 });
    const version = String(rel.tag_name || '').replace(/^v/, '');
    const value = { at: Date.now(), version };
    store.set('updateCheck', value);
    if (version && newer(version, VERSION)) { state.update = value; render(); }
  } catch { /* nessun controllo senza rete */ }
}

/* ------------------------------------------------------------------ */
/* Luoghi                                                               */
/* ------------------------------------------------------------------ */

function selectPlace(p) {
  const id = placeId(p);
  let place = state.places.find((x) => x.id === id);
  if (!place) {
    place = { id, name: p.name, admin: p.admin || '', lat: p.lat, lon: p.lon, elevation: p.elevation ?? null, gps: !!p.gps };
    state.places.unshift(place);
    state.places = state.places.slice(0, 12);
    savePlaces();
  }
  state.currentId = id;
  store.set('current', id);
  state.results = [];
  state.revealed = null;
  closeSheet();
  window.scrollTo({ top: 0 });
  load();
}

function removePlace(id) {
  state.places = state.places.filter((p) => p.id !== id);
  savePlaces();
  for (const k of ['fc', 'ver', 'norm', 'ens', 'diary', 'zone']) store.del(`${k}.${id}`);
  if (state.currentId === id) {
    state.currentId = state.places[0]?.id || null;
    store.set('current', state.currentId);
    load();
  }
  renderSheet('places');
}

let searchTimer = null;
let searchCtl = null;
function onSearchInput(text) {
  clearTimeout(searchTimer);
  const q = text.trim();
  if (q.length < 2) { state.results = []; state.searchError = null; renderResults(); return; }
  searchTimer = setTimeout(async () => {
    searchCtl?.abort();
    searchCtl = new AbortController();
    state.searching = true;
    renderResults();
    try {
      state.results = await searchPlaces(q, { signal: searchCtl.signal });
      state.searchError = state.results.length ? null : 'Nessun luogo con questo nome.';
    } catch (e) {
      if (searchCtl.signal.aborted) return;
      state.searchError = 'Ricerca non riuscita: controlla la connessione.';
    }
    state.searching = false;
    renderResults();
  }, 320);
}

function useGps() {
  if (!('geolocation' in navigator)) {
    state.gpsMessage = 'Il telefono non dà la posizione a questa app: cerca il luogo per nome.';
    render(); renderSheet('places');
    return;
  }
  state.gpsMessage = 'Cerco la tua posizione…';
  render(); renderSheet('places');
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = Math.round(pos.coords.latitude * 1000) / 1000;
      const lon = Math.round(pos.coords.longitude * 1000) / 1000;
      const named = await reverseName(lat, lon);
      state.gpsMessage = null;
      selectPlace({ name: named?.name || 'La mia posizione', admin: named?.admin || '', lat, lon, gps: true });
    },
    (err) => {
      state.gpsMessage = err.code === 1
        ? (inApp
          ? 'Hai negato il permesso della posizione. Puoi darlo da Impostazioni, App, Isobara, Autorizzazioni, oppure cerca il luogo per nome.'
          : 'Hai negato il permesso della posizione. Puoi riattivarlo dalle impostazioni del sito in Chrome, o cercare il luogo per nome.')
        : 'Posizione non disponibile adesso: cerca il luogo per nome.';
      render(); renderSheet('places');
    },
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60e3 }
  );
}

function toggleModel(id, on) {
  const set = new Set(state.models);
  if (on) set.add(id); else set.delete(id);
  if (set.size < 2) return;
  state.models = MODELS.map((m) => m.id).filter((m) => set.has(m));
  store.set('models', state.models);
  load({ force: true });
}

/* ------------------------------------------------------------------ */
/* Pagina                                                               */
/* ------------------------------------------------------------------ */

function errorText(e) {
  if (!e) return '';
  if (e.reason === 'network') return 'Sei senza connessione';
  if (e.reason === 'timeout') return 'Il server dei dati non risponde';
  if (e.status === 429) return 'Troppe richieste in poco tempo, riprova tra un minuto';
  return e.message || 'Errore sconosciuto';
}

function nowValues(result) {
  const hs = result.hours;
  const k = hs.findIndex((h) => h && h.t > result.now);
  const a = hs[k - 1], b = hs[k];
  if (!a) return b;
  if (!b) return a;
  const fr = (result.now - a.t) / 3600;
  return { ...(fr < 0.5 ? a : b), temp: a.temp + (b.temp - a.temp) * fr };
}

function render() {
  const place = currentPlace();
  const v = state.view;
  $('#placeName').textContent = place ? place.name : 'Isobara';
  const refresh = $('#refreshBtn');
  refresh.hidden = !place;
  refresh.classList.toggle('spin', state.loading);
  refresh.disabled = state.loading;
  $('#radarBtn').hidden = !place;
  $('#askBtn').hidden = !(place && v);

  const notice = $('#notice');
  let msg = '';
  if (!navigator.onLine && v) msg = `Sei offline: dati delle ${makeFormatters(v.result.tz).hm(v.fetchedAt / 1000)}.`;
  else if (state.error && v) msg = `${errorText(state.error)}: vedi i dati delle ${makeFormatters(v.result.tz).hm(v.fetchedAt / 1000)}.`;
  notice.hidden = !msg;
  notice.textContent = msg;

  const main = $('#main');
  if (!place) { main.innerHTML = updateHTML() + welcomeHTML(); return; }
  if (!v) {
    main.innerHTML = state.loading || !state.error
      ? `<section class="hero"><p class="temp">–<span class="deg">°</span></p><p class="cond">Scarico ${state.models.length} modelli per ${esc(place.name)}</p><div class="loading-line" role="status" aria-label="Caricamento"></div></section>`
      : `<section class="hero"><p class="cond">Non riesco a scaricare la previsione</p><p class="hilo">${esc(errorText(state.error))}.</p><div class="actions"><button type="button" class="pill glass" data-action="retry">Riprova</button></div></section>`;
    return;
  }
  const scroller = $('.scroller');
  const left = scroller?.scrollLeft || 0;
  const first = state.revealed !== place.id;
  state.revealed = place.id;
  main.innerHTML = updateHTML() + alertBannerHTML() + heroHTML(v, first) + stripHTML(v) + soonHTML(v)
    + weekHTML(v) + outdoorHTML(v, place) + alertsHTML() + trustHTML(v, place) + diaryHTML(v, place) + creditsHTML(v);
  const sc = $('.scroller');
  if (sc) sc.scrollLeft = left;
}

function updateHTML() {
  if (!state.update) return '';
  return `<a class="banner" href="${APK_URL}" target="_blank" rel="noopener">${UI.download}<span><b>Isobara ${esc(state.update.version)} è pronta</b> Tocca per scaricarla, poi aprila per installarla sopra questa.</span></a>`;
}

function welcomeHTML() {
  return `<section class="welcome">
    <h1 class="reveal">Isobara</h1>
    <p class="lead reveal d1">Sette modelli meteo, corretti con gli errori che hanno fatto nell'ultimo mese nel luogo che scegli.</p>
    <div class="actions reveal d2">
      <button type="button" class="pill solid" data-action="gps">${UI.pin}Usa la mia posizione</button>
      <button type="button" class="pill glass" data-open="places">Cerca un luogo</button>
    </div>
    ${state.gpsMessage ? `<p class="quiet">${esc(state.gpsMessage)}</p>` : ''}
    <div class="cities reveal d2" aria-label="Città">${QUICK.map((c, i) => `<button type="button" data-pick="${i}">${esc(c.name)}</button>`).join('')}</div>
  </section>`;
}

function alertBannerHTML() {
  const head = alertHeadline(state.alerts);
  if (!head) return '';
  return `<button type="button" class="banner alert lv${head.level}" data-open="alerts">
    <i class="a-dot lv${head.level}" aria-hidden="true"></i>
    <span><b>${esc(head.text)}</b> Bollettino della Protezione Civile</span>
  </button>`;
}

function dayWord(h, result, fmt) {
  const today = result.days[0]?.key;
  const tomorrow = result.days[1]?.key;
  const when = h.day === today ? 'Oggi' : h.day === tomorrow ? 'Domani' : cap(fmt.weekdayLong(h.t));
  return `${when} alle ${fmt.hour(h.t)}`;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const precipNoun = (code) => ((code >= 71 && code <= 77) || code === 85 || code === 86 ? 'neve' : 'pioggia');

function heroHTML(v, first) {
  const { result } = v;
  const fmt = makeFormatters(result.tz);
  const today = result.days[0];
  const hs = stripHours(result);
  const preview = state.preview != null ? hs[state.preview] : null;
  const h = preview || nowValues(result);
  const r = first && !reduceMotion.matches ? ' reveal' : '';
  const when = preview
    ? `<p class="when">${esc(dayWord(preview, result, fmt))}<button type="button" class="back" data-action="now">Torna ad adesso</button></p>`
    : '<p class="when"></p>';
  const sub = preview
    ? `<p class="hilo">I modelli dicono tra ${deg(preview.lo)} e ${deg(preview.hi)}${preview.pop >= 0.2 ? `, pioggia ${pct(preview.pop)}` : ''}</p>`
    : today ? `<p class="hilo">Massima <b>${deg(today.tmax)}</b>, minima <b>${deg(today.tmin)}</b></p>` : '';
  // Per le prossime due ore conta il dato ogni 15 minuti, se annuncia pioggia.
  const nc = v.nowcast;
  const lineText = nc?.any ? `${nowcastText(nc, fmt, precipNoun(h.code))}` : nextHoursText(result, fmt);
  const line = preview
    ? `<p class="line">Vento ${esc(windText(preview.wind, preview.dir))}${isNum(preview.gust) && preview.gust > preview.wind + 8 ? `, raffiche ${f0(preview.gust)}` : ''}.</p>`
    : `<p class="line">${esc(lineText)}</p>`;
  return `<section class="hero">
    ${when}
    <p class="temp${r}" aria-label="${f1(h.temp)} gradi">${f0(h.temp)}<span class="deg">°</span></p>
    <p class="cond${r && ' reveal d1'}">${describe(h.code)}</p>
    ${sub.replace('class="hilo"', `class="hilo${r && ' reveal d1'}"`)}
    ${line.replace('class="line"', `class="line${r && ' reveal d2'}"`)}
  </section>`;
}

function stripHTML(v) {
  const s = hourStrip(v.result, v.bm, currentPlace(), { selected: state.preview });
  if (!s) return '';
  return `<section class="strip" aria-label="Prossime 48 ore">
    <div class="scroller">${s.html}</div>
    <p class="strip-note">Tocca un'ora per vedere il suo cielo. La fascia chiara mostra quanto i modelli sono incerti.</p>
  </section>`;
}

// Prossime due ore, ogni 15 minuti, con il radar.
function soonHTML(v) {
  const nc = v.nowcast;
  const fmt = makeFormatters(v.result.tz);
  const head = `<div class="block-head"><h2>Prossime due ore</h2><button type="button" class="pill glass small" data-open="radar">${UI.radar}Radar</button></div>`;
  if (!nc) return `<section class="block soon">${head}<p class="soft">Qui non arrivano i dati ogni 15 minuti: guarda il radar per la pioggia di adesso.</p></section>`;
  const top = Math.max(4, nc.peak);
  const bars = nc.steps.map((s) => {
    const r = s.mm * 4;
    const hgt = r < 0.2 ? 0 : Math.max(10, Math.sqrt(r / top) * 100);
    return `<span class="nc-col"><i style="height:${hgt.toFixed(0)}%"${hgt ? '' : ' class="dry"'}></i></span>`;
  }).join('');
  const label = nc.steps.map((s) => `${fmt.hm(s.t)} ${mm(s.mm)} mm`).join(', ');
  return `<section class="block soon">
    ${head}
    <div class="nc" role="img" aria-label="Pioggia ogni 15 minuti: ${esc(label)}">${bars}</div>
    <div class="nc-axis" aria-hidden="true"><span>adesso</span><span>${fmt.hm(nc.steps[0].t + 3600)}</span><span>${fmt.hm(nc.steps[0].t + 7200)}</span></div>
    <p class="soft">${esc(nowcastText(nc, fmt))}</p>
  </section>`;
}

function weekHTML(v) {
  const { result, extended } = v;
  const fmt = makeFormatters(result.tz);
  const ds = result.days;
  const ext = extended || [];
  const lo = Math.min(...ds.map((d) => d.tmin), ...ext.map((d) => d.tmin.p10));
  const hi = Math.max(...ds.map((d) => d.tmax), ...ext.map((d) => d.tmax.p90));
  const pos = (t) => ((t - lo) / Math.max(1, hi - lo)) * 100;
  const grad = (a, b) => `linear-gradient(90deg,${tempColor(a)},${tempColor(b)})`;
  const rows = ds.map((d) => {
    const name = d.dayIndex === 0 ? 'Oggi' : cap(fmt.weekday(d.t + 43200));
    const open = state.openDay === d.key;
    const a = pos(d.tmin), b = Math.max(pos(d.tmax), a + 3);
    return `<li class="day${open ? ' open' : ''}">
      <button type="button" class="day-btn" data-day="${d.key}" aria-expanded="${open}">
        <span class="d-name">${name}</span>
        <span class="d-icon">${weatherIcon(d.code, true, 28, describe(d.code))}</span>
        <span class="d-pop">${d.pop >= 0.2 ? pct(d.pop) : ''}</span>
        <span class="d-min">${deg(d.tmin)}</span>
        <span class="bar" aria-hidden="true"><i style="left:${a.toFixed(1)}%;width:${(b - a).toFixed(1)}%;background:${grad(d.tmin, d.tmax)}"></i></span>
        <span class="d-max">${deg(d.tmax)}</span>
      </button>
      <div class="d-more"><div><div class="d-text">${dayText(d, v, fmt)}</div></div></div>
    </li>`;
  }).join('');
  let more = '';
  if (ext.length) {
    const extRows = ext.map((d) => {
      const open = state.openDay === d.key;
      const name = `${cap(fmt.weekday(d.t + 43200))} ${fmt.dayNum(d.t + 43200)}`;
      const wa = pos(d.tmin.p10), wb = Math.max(pos(d.tmax.p90), wa + 3);
      const a = pos(d.tmin.p50), b = Math.max(pos(d.tmax.p50), a + 3);
      return `<li class="day ext${open ? ' open' : ''}">
        <button type="button" class="day-btn" data-day="${d.key}" aria-expanded="${open}">
          <span class="d-name">${name}</span>
          <span class="d-icon"></span>
          <span class="d-pop">${(d.pop ?? 0) >= 0.2 ? pct(d.pop) : ''}</span>
          <span class="d-min">${deg(d.tmin.p50)}</span>
          <span class="bar range" aria-hidden="true"><i class="wide" style="left:${wa.toFixed(1)}%;width:${(wb - wa).toFixed(1)}%"></i><i style="left:${a.toFixed(1)}%;width:${(b - a).toFixed(1)}%;background:${grad(d.tmin.p50, d.tmax.p50)}"></i></span>
          <span class="d-max">${deg(d.tmax.p50)}</span>
        </button>
        <div class="d-more"><div><div class="d-text">${extText(d)}</div></div></div>
      </li>`;
    }).join('');
    more = `<h3 class="sub">Tendenza fino a 15 giorni</h3>
      <p class="soft">${ext[0].members} simulazioni del Centro europeo. La barra piena è il valore più probabile, quella chiara dove cadono 8 simulazioni su 10.</p>
      <ul class="days">${extRows}</ul>`;
  }
  return `<section class="block"><h2>Sette giorni</h2><ul class="days">${rows}</ul>${more}</section>`;
}

function extText(d) {
  const out = [];
  out.push(`Minima tra ${deg(d.tmin.p10)} e ${deg(d.tmin.p90)}, massima tra ${deg(d.tmax.p10)} e ${deg(d.tmax.p90)}: qui cadono 8 simulazioni su 10.`);
  out.push(d.wet
    ? `Pioggia in ${d.wet} simulazioni su ${d.members}${isNum(d.precip) && d.precip >= 0.5 ? `, a metà di loro più di ${mm(d.precip)} mm` : ''}.`
    : 'Nessuna simulazione prevede pioggia.');
  if (d.corrected) out.push('Temperature corrette con l\'errore tipico del modello europeo in questo luogo.');
  return out.map((p) => `<p>${esc(p)}</p>`).join('');
}

function dayText(d, v, fmt) {
  const out = [];
  const why = d.conf.reasons.map(reasonText).join(', ');
  out.push(`${describe(d.code)}. ${CONF_LABEL[d.conf.level]}: ${why}.`);
  if (d.nRain) {
    out.push(d.wetCount === 0 && d.pop < 0.15
      ? 'Nessun modello prevede pioggia.'
      : `Pioggia ${pct(d.pop)}, circa ${mm(d.precip)} mm: la prevedono ${d.wetCount} modelli su ${d.nRain}.`);
  }
  const r = rose(d.dirDom);
  if (isNum(d.windMax)) out.push(`Vento fino a ${f0(d.windMax)} km/h${r ? ` da ${r[0]} (${r[1]})` : ''}${isNum(d.gustMax) ? `, raffiche ${f0(d.gustMax)}` : ''}.`);
  if (d.normal && isNum(d.normal.tmax)) {
    const diff = d.tmax - d.normal.tmax;
    out.push(Math.abs(diff) < 1
      ? `Massima nella media del periodo (${deg(d.normal.tmax)}).`
      : `Massima ${signed(diff, 0)}° rispetto alla media del periodo (${deg(d.normal.tmax)}).`);
  }
  const frz = freezingText(d, currentPlace()?.elevation);
  if (frz) out.push(`${frz}.`);
  if (d.sunrise && d.sunset) out.push(`Alba ${fmt.hm(d.sunrise)}, tramonto ${fmt.hm(d.sunset)}.`);
  const ms = Object.keys(d.per).sort((a, b) => (v.weights.t1[b] ?? 0) - (v.weights.t1[a] ?? 0));
  const models = ms.map((m) => `${shortName(m)} ${f0(d.per[m].tmin)}°/${f0(d.per[m].tmax)}°`).join(', ');
  return out.map((p) => `<p>${esc(p)}</p>`).join('') + `<p class="models">${esc(models)}</p>`;
}

// Aria, pollini, sole, mare e montagna: solo le righe che hanno qualcosa da dire.
function outdoorHTML(v, place) {
  const rows = [];
  const today = v.result.days[0];
  if (v.air?.aqi != null) rows.push(['Aria', esc(airText(v.air))]);
  if (v.air?.pollen?.length) {
    const words = ['', 'bassa', 'media', 'alta'];
    rows.push(['Pollini', v.air.pollen.map((p) => `<span class="pol">${esc(p.name)}<i class="dots l${p.level}" role="img" aria-label="concentrazione ${words[p.level]}"><b></b><b></b><b></b></i></span>`).join('')]);
  }
  if (isNum(today?.uv) && today.uv >= 1) rows.push(['Raggi UV', esc(uvText(today.uv))]);
  if (v.sea) rows.push(['Mare', esc(seaText(v.sea))]);
  const frz = freezingText(today, place.elevation);
  if (frz) rows.push(['Montagna', esc(frz)]);
  if (!rows.length) return '';
  return `<section class="block"><h2>Oggi all'aperto</h2>
    <dl class="facts">${rows.map(([k, val]) => `<div><dt>${esc(k)}</dt><dd>${val}</dd></div>`).join('')}</dl>
  </section>`;
}

function alertsHTML() {
  const a = state.alerts;
  if (!a || a.outside) return '';
  const row = (label, levels) => {
    const lv = alertMax(levels);
    return `<div><dt><i class="a-dot lv${levels ? lv : 'x'}" aria-hidden="true"></i>${label}</dt><dd>${esc(cap(alertDayText(levels)))}</dd></div>`;
  };
  return `<section class="block official">
    <div class="block-head"><h2>Allerte ufficiali</h2><button type="button" class="pill glass small" data-open="alerts">${UI.shield}Dettagli</button></div>
    <dl class="facts">${row('Oggi', a.today)}${row('Domani', a.tomorrow)}</dl>
    <p class="soft">Protezione Civile, zona ${esc(a.zone)}${a.stale ? ': il bollettino di oggi non è ancora uscito' : ''}. Non è una previsione di Isobara.</p>
  </section>`;
}

function stationLabel(ver) {
  const s = ver?.station;
  if (!s) return null;
  return `stazione meteo di ${s.name} (a ${f0(s.km)} km)`;
}

function trustHTML(v, place) {
  const ver = state.cache.ver;
  const ev = ver?.evaluation;
  const where = stationLabel(ver) ? `alla ${stationLabel(ver)}` : 'qui';
  let body;
  if (ev) {
    body = `<p class="big">${f1(ev.maeOurs)}°</p>
      <p>È l'errore medio di questa previsione sul giorno dopo, misurato ${where} negli ultimi ${ev.testDays} giorni. La media semplice dei modelli sbaglia di ${f1(ev.maeMean)}°.</p>`;
  } else if (ver) {
    body = `<p class="big">±${f1(v.result.days[1]?.err ?? 1.2)}°</p><p>È l'errore tipico per domani, calcolato dagli ultimi ${ver.verModels?.length || ''} modelli verificati ${where}.</p>`;
  } else if (state.verLoading) {
    body = '<p>Sto controllando quanto hanno sbagliato i modelli qui nell\'ultimo mese.</p>';
  } else {
    body = `<p>Lo storico dei modelli non è arrivato${state.verError ? ` (${esc(errorText(state.verError).toLowerCase())})` : ''}: per ora pesano tutti uguale e senza correzioni.</p>
      <button type="button" class="textlink" data-action="retry-ver">Riprova</button>`;
  }
  return `<section class="block trust">
    <h2>Affidabilità a ${esc(place.name)}</h2>
    ${body}
    ${ver ? '<button type="button" class="textlink" data-open="trust">Come funziona</button>' : ''}
  </section>`;
}

function diaryHTML(v, place) {
  const tools = makeTimeTools(v.result.tz);
  const todayKey = tools.dayKey(v.result.now);
  const rows = diaryRows(place, todayKey);
  const fmt = makeFormatters(v.result.tz);
  const stats = diaryStats(rows);
  const src = stats.sources?.join(' e ') || (state.cache.ver?.station ? `stazione di ${state.cache.ver.station.name}` : 'rianalisi ERA5');
  let body;
  if (!rows.length) {
    body = '<p class="soft">Da oggi Isobara salva ogni giorno la previsione per domani. Domani sera trovi qui il confronto con quello che è successo davvero.</p>';
  } else {
    const label = (key) => {
      const t = Date.parse(`${key}T12:00:00Z`) / 1000;
      const yest = tools.dayKey(v.result.now - 86400);
      return key === yest ? 'Ieri' : `${cap(fmt.weekday(t))} ${fmt.dayNum(t)}`;
    };
    const cell = (pred, obs) => `<td><b>${obs == null ? '–' : deg(obs)}</b><small>prev. ${deg(pred)}</small></td>`;
    const rainCell = (r) => {
      const said = r.pop >= 0.5;
      if (!r.obs || r.obs.wet == null) return `<td><b>–</b><small>prev. ${said ? 'sì' : 'no'}</small></td>`;
      const ok = said === r.obs.wet;
      return `<td><b class="${ok ? 'ok' : 'ko'}">${ok ? UI.check : UI.miss}${r.obs.wet ? 'sì' : 'no'}</b><small>prev. ${said ? 'sì' : 'no'}</small></td>`;
    };
    const trs = rows.slice(0, 7).map((r) => `<tr><th scope="row">${label(r.key)}</th>${cell(r.tmax, r.obs?.tmax)}${cell(r.tmin, r.obs?.tmin)}${rainCell(r)}</tr>`).join('');
    body = `${stats.n ? `<p class="soft">${esc(diarySummaryText(stats, src))}</p>` : `<p class="soft">Il confronto arriva quando ci sono i dati misurati (${esc(src)}).</p>`}
      <table class="diary-t">
        <thead><tr><th scope="col">Giorno</th><th scope="col">Massima</th><th scope="col">Minima</th><th scope="col">Pioggia</th></tr></thead>
        <tbody>${trs}</tbody>
      </table>
      <p class="fine">In grande il dato vero, sotto la previsione fatta il giorno prima.</p>`;
  }
  return `<section class="block diary"><h2>Diario delle previsioni</h2>${body}</section>`;
}

function creditsHTML(v) {
  const fmt = makeFormatters(v.result.tz);
  return `<footer class="credits">
    <p>Aggiornato alle ${fmt.hm(v.fetchedAt / 1000)} con ${v.result.models.length} modelli. Isobara ${VERSION}.</p>
    <p>Previsioni di <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a> (CC BY 4.0) con i modelli di ECMWF, DWD, ItaliaMeteo, Météo-France, NOAA e Met Office; aria e pollini di Copernicus CAMS. Stazioni meteo dall'Iowa Environmental Mesonet. Allerte del Dipartimento della Protezione Civile (CC BY 4.0). Radar di RainViewer.</p>
  </footer>`;
}

/* ------------------------------------------------------------------ */
/* Pannelli                                                             */
/* ------------------------------------------------------------------ */

let openName = null;

function sheetFrame(name, title, body) {
  return `<div class="sheet-in">
    <div class="grip" aria-hidden="true"></div>
    <div class="sheet-head"><h2 id="t-${name}">${title}</h2><button type="button" class="round" data-action="close" aria-label="Chiudi">${UI.close}</button></div>
    ${body}
  </div>`;
}

function renderSheet(name) {
  const d = $(`#sheet-${name}`);
  if (!d) return;
  if (name === 'places') d.innerHTML = placesSheet();
  if (name === 'claude') d.innerHTML = claudeSheet();
  if (name === 'trust') d.innerHTML = trustSheet();
  if (name === 'alerts') d.innerHTML = alertsSheet();
  if (name === 'radar') d.innerHTML = radarSheet();
  if (name === 'places') {
    const input = $('#searchInput');
    input?.addEventListener('input', (e) => onSearchInput(e.target.value));
  }
}

function openSheet(name) {
  if (openName && openName !== name) closeSheet({ silent: true });
  const d = $(`#sheet-${name}`);
  renderSheet(name);
  if (!d.open) {
    d.showModal();
    requestAnimationFrame(() => requestAnimationFrame(() => d.classList.add('open')));
    history.pushState({ sheet: name }, '');
  }
  openName = name;
  if (name === 'radar') startRadar();
}

function closeSheet({ fromPop = false, silent = false } = {}) {
  if (!openName) return;
  const d = $(`#sheet-${openName}`);
  if (openName === 'radar') stopRadar();
  openName = null;
  d.classList.remove('open');
  setTimeout(() => { if (!d.classList.contains('open')) d.close(); }, reduceMotion.matches ? 0 : 330);
  if (!fromPop && !silent && history.state?.sheet) history.back();
}

function placesSheet() {
  const saved = state.places.map((p) => `<li class="list-row${p.id === state.currentId ? ' current' : ''}">
      <button type="button" class="list-btn" data-place="${esc(p.id)}"><b>${esc(p.name)}</b><span>${esc(p.admin || `${p.lat}, ${p.lon}`)}</span></button>
      <button type="button" class="round" data-remove="${esc(p.id)}" aria-label="Rimuovi ${esc(p.name)}">${UI.close}</button>
    </li>`).join('');
  const toggles = MODELS.map((m) => `<label class="toggle"><input type="checkbox" id="model-${m.id}" data-model="${m.id}"${state.models.includes(m.id) ? ' checked' : ''}><span><b>${esc(m.name)}${m.kind === 'AI' ? ', intelligenza artificiale' : ''}</b><span>${esc(m.org)}, ${esc(m.res)}, ${m.days} giorni. ${esc(m.note)}</span></span></label>`).join('');
  return sheetFrame('places', 'Luoghi', `
    <label class="sr" for="searchInput">Cerca un luogo</label>
    <input class="field" id="searchInput" type="search" placeholder="Cerca una città o un paese" autocomplete="off" enterkeyhint="search">
    <div class="row"><button type="button" class="pill glass" data-action="gps">${UI.pin}Usa la mia posizione</button></div>
    ${state.gpsMessage ? `<p>${esc(state.gpsMessage)}</p>` : ''}
    <ul class="list" id="results">${resultsHTML()}</ul>
    ${saved ? `<h3>I tuoi luoghi</h3><ul class="list">${saved}</ul>` : ''}
    <h3>Città</h3>
    <div class="chips">${QUICK.map((c, i) => `<button type="button" class="chip" data-pick="${i}">${esc(c.name)}</button>`).join('')}</div>
    <details class="more"><summary>Modelli usati</summary>
      <p>Ne servono almeno due. I modelli locali coprono solo alcune zone e pochi giorni: fuori dalla loro area vengono ignorati.</p>
      ${toggles}
    </details>
    <details class="more"><summary>Dati e privacy</summary>
      <p>Previsioni di Open-Meteo.com (CC BY 4.0). Clima 1991–2020 e verifica della pioggia dalla rianalisi ERA5 di Copernicus. Misure delle stazioni dai bollettini METAR, tramite l'Iowa Environmental Mesonet. Allerte dal bollettino di criticità della Protezione Civile. Radar di RainViewer, mappe © OpenStreetMap e CARTO. Nomi dei luoghi dal GPS: OpenStreetMap.</p>
      <p>I tuoi luoghi e il diario restano su questo telefono. Claude riceve la previsione solo quando premi il pulsante. Isobara ${VERSION}${inApp ? ', app Android' : ''}.</p>
      ${inApp ? `<a class="pill glass wide" href="${APK_URL}" target="_blank" rel="noopener">${UI.download}Scarica l'ultima versione</a>` : ''}
    </details>`);
}

function resultsHTML() {
  if (state.searching) return '<li><p>Cerco…</p></li>';
  if (state.searchError) return `<li><p>${esc(state.searchError)}</p></li>`;
  return state.results.map((r, i) => `<li><button type="button" class="list-btn" data-result="${i}"><b>${esc(r.name)}</b><span>${esc(r.admin)}${isNum(r.elevation) ? `, ${Math.round(r.elevation)} m` : ''}</span></button></li>`).join('');
}
function renderResults() { const ul = $('#results'); if (ul) ul.innerHTML = resultsHTML(); }

const SUGGESTIONS = [
  'Domani mi serve l\'ombrello?',
  'Qual è il giorno migliore per una gita?',
  'Come mi vesto oggi?',
  'Perché i modelli non sono d\'accordo?',
];

function prompts() {
  const v = state.view;
  const place = currentPlace();
  if (!v || !place) return null;
  const todayKey = makeTimeTools(v.result.tz).dayKey(v.result.now);
  const args = {
    place, result: v.result, skill: v.skill, weights: v.weights,
    evaluation: state.cache.ver?.evaluation || null, truthLabel: state.cache.ver?.truthLabel || null,
    question: state.question,
    extra: {
      alerts: state.alerts && !state.alerts.outside ? state.alerts : null,
      nowcast: v.nowcast, air: v.air, sea: v.sea, extended: v.extended,
      diary: diaryStats(diaryRows(place, todayKey)),
    },
  };
  const full = buildPrompt({ ...args, full: true });
  // Il link ha un limite di lunghezza: si usa la versione breve e, se serve, si tolgono le ultime righe.
  let text = full;
  if (claudeUrl(text).length > 6000) text = buildPrompt({ ...args, full: false });
  while (claudeUrl(text).length > 6000 && text.includes('\n')) text = text.slice(0, text.lastIndexOf('\n'));
  return { full, link: claudeUrl(text) };
}

const canShare = () => !!native?.share || typeof navigator.share === 'function';

function claudeSheet() {
  const p = prompts();
  if (!p) return sheetFrame('claude', 'Chiedi a Claude', '<p>Prima scegli un luogo.</p>');
  const share = canShare();
  return sheetFrame('claude', 'Chiedi a Claude', `
    <p>Claude riceve la previsione, quanto sono d'accordo i modelli e quanto ha sbagliato ognuno qui, e ti spiega cosa aspettarti.</p>
    <label class="sr" for="question">La tua domanda</label>
    <textarea class="field" id="question" placeholder="Scrivi una domanda, per esempio: sabato posso andare al mare?">${esc(state.question)}</textarea>
    <div class="chips">${SUGGESTIONS.map((s, i) => `<button type="button" class="chip" data-suggest="${i}">${esc(s)}</button>`).join('')}</div>
    <a class="pill solid wide" id="askLink" href="${esc(p.link)}" target="_blank" rel="noopener" style="margin-top:14px">${UI.arrowOut}Apri in Claude</a>
    <div class="row">
      ${share ? `<button type="button" class="pill glass" data-action="share">${UI.share}Condividi</button>` : ''}
      <button type="button" class="pill glass" data-action="copy">${UI.copy}Copia</button>
    </div>
    <p id="claudeNote">Si apre l'app Claude con il messaggio già scritto.${share ? ' Con Condividi puoi sceglierla dal menu di Android.' : ''}</p>
    <details class="more"><summary>Il messaggio per Claude</summary><pre class="prompt" id="promptPreview">${esc(p.full)}</pre></details>`);
}

function refreshPrompt() {
  const p = prompts();
  if (!p) return;
  const a = $('#askLink'); if (a) a.href = p.link;
  const pre = $('#promptPreview'); if (pre) pre.textContent = p.full;
}

async function sharePrompt() {
  const p = prompts();
  if (!p) return;
  const title = `Meteo per ${currentPlace().name}`;
  if (native?.share) { native.share(title, p.full); return; }
  try { await navigator.share({ title, text: p.full }); } catch { /* annullato */ }
}

async function copyPrompt() {
  const p = prompts();
  if (!p) return;
  const note = $('#claudeNote');
  const done = () => { if (note) note.textContent = 'Testo copiato: incollalo in una nuova chat di Claude.'; };
  if (native?.copy) { native.copy(p.full); done(); return; }
  try {
    await navigator.clipboard.writeText(p.full);
    done();
  } catch {
    const pre = $('#promptPreview');
    pre?.closest('details')?.setAttribute('open', '');
    if (pre) {
      const range = document.createRange();
      range.selectNodeContents(pre);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    if (note) note.textContent = 'Copia automatica non consentita: il testo è selezionato qui sotto.';
  }
}

function trustSheet() {
  const ver = state.cache.ver;
  const v = state.view;
  const place = currentPlace();
  if (!ver || !v || !place) return sheetFrame('trust', 'Come funziona', '<p>Lo storico dei modelli non è ancora arrivato.</p>');
  const fmtD = (s) => new Date(`${s}T12:00:00Z`).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
  const w = v.weights.t1;
  const ranked = Object.keys(w).sort((a, b) => (w[b] ?? 0) - (w[a] ?? 0));
  const maxE = Math.max(1, ...ranked.flatMap((m) => [ver.skill[m]?.t1?.maeRaw, ver.skill[m]?.t4?.maeRaw].filter(isNum)));
  const ev = ver.evaluation;
  const st = ver.station;
  const bar = (s, cls, label) => (s ? `<div class="m-bar ${cls}"><i><em style="width:${((s.maeRaw / maxE) * 100).toFixed(1)}%"></em></i><span>${label} ${f1(s.maeRaw)}°</span></div>` : '');
  const items = ranked.map((m) => {
    const s = ver.skill[m];
    const info = MODEL_BY_ID[m];
    const notes = [];
    if (s?.t1) notes.push(Math.abs(s.t1.bias) < 0.3 ? 'Nessun errore fisso.' : `Di solito ${f1(Math.abs(s.t1.bias))}° troppo ${s.t1.bias > 0 ? 'caldo' : 'freddo'}: l'app lo corregge.`);
    if (s?.wind && Math.abs(s.wind.factor - 1) >= 0.08) notes.push(`Vento ${s.wind.factor < 1 ? 'sovrastimato' : 'sottostimato'}, corretto.`);
    if (s?.rain) notes.push(`Pioggia sì o no indovinata ${s.rain.hit + s.rain.cn} giorni su ${s.rain.nDays}.`);
    return `<li>
      <div class="m-head"><b>${esc(info?.name || m)}</b><span>peso ${pct(w[m] ?? 0)}</span></div>
      ${s?.t1 || s?.t4 ? `${bar(s.t1, 'd1', 'a 1 giorno')}${bar(s.t4, 'd4', 'a 4 giorni')}` : '<p class="m-note">Nessuna previsione passata: pesa come la media.</p>'}
      ${notes.length ? `<p class="m-note">${esc(notes.join(' '))}</p>` : ''}
    </li>`;
  }).join('');
  const truth = st
    ? `Il tempo reale è la stazione meteo di ${esc(st.name)} (codice ${esc(st.id)}), a ${f0(st.km)} km da ${esc(place.name)} e a ${f0(st.elev)} m di quota: le misure di ogni ora dei bollettini METAR. Per questo la verifica delle temperature si fa nel punto della stazione. Per il vento si usa l'analisi del Centro europeo (un anemometro in campo aperto misura più vento di quello che c'è in città), per la pioggia la rianalisi ERA5.`
    : `Qui vicino non c'è una stazione meteo con misure orarie alla stessa quota, quindi il tempo reale è l'analisi del Centro europeo (${esc(ver.truthLabel)}), che unisce milioni di osservazioni ogni 6 ore: per questo i modelli ECMWF partono un po' avvantaggiati. Per la pioggia si usa la rianalisi ERA5.`;
  return sheetFrame('trust', 'Come funziona', `
    <p>Dal ${fmtD(ver.window.start)} al ${fmtD(ver.window.end)} ho confrontato le previsioni fatte 1 e 4 giorni prima da ogni modello con il tempo reale${st ? ` misurato alla stazione di ${esc(st.name)}` : ` a ${esc(place.name)}`}.</p>
    ${ev ? `<div class="score">
      <div class="ours"><span>Previsione dell'app</span><b>${f1(ev.maeOurs)}°</b></div>
      <div><span>Miglior modello da solo, ${esc(shortName(ev.best))}</span><b>${f1(ev.maeBest)}°</b></div>
      <div><span>Media semplice dei modelli</span><b>${f1(ev.maeMean)}°</b></div>
    </div>
    <p>Errore medio sulla temperatura del giorno dopo, negli ultimi ${ev.testDays} giorni, con correzioni imparate sui ${ev.trainDays} precedenti.</p>` : ''}
    <h3>I modelli, qui</h3>
    <ul class="models-list">${items}</ul>
    <h3>Il metodo</h3>
    <ol class="steps">
      <li><b>Più modelli.</b> Ogni servizio meteo simula l'atmosfera a modo suo: dove sono d'accordo la previsione è solida, dove divergono c'è incertezza vera.</li>
      <li><b>Verifica.</b> L'app recupera cosa avevano previsto 1 e 4 giorni prima e lo confronta con quello che è successo davvero.</li>
      <li><b>Correzione.</b> Se un modello qui è sempre troppo caldo di notte, l'app gli toglie l'errore, ora per ora.</li>
      <li><b>Consenso.</b> La previsione è la media dei modelli corretti, con più peso a chi ha sbagliato meno, senza mai affidarsi a uno solo.</li>
      <li><b>Fiducia.</b> Scende quando i modelli si dividono sulla pioggia o sulle temperature, o quando il giorno è lontano.</li>
    </ol>
    <p>${truth}</p>`);
}

function alertsSheet() {
  const a = state.alerts;
  if (!a || a.outside) return sheetFrame('alerts', 'Allerte ufficiali', '<p>Il bollettino della Protezione Civile non è disponibile per questo luogo.</p>');
  const day = a.date.split('-').reverse().join('/');
  const cell = (levels, i) => {
    if (!levels) return '<td><span class="lvl">non ancora uscita</span></td>';
    const lv = levels[i] ?? 0;
    return `<td><span class="lvl"><i class="a-dot lv${lv}" aria-hidden="true"></i>${['Nessuna', 'Gialla', 'Arancione', 'Rossa'][lv]}</span></td>`;
  };
  const national = (groups) => (groups?.length
    ? groups.map((g) => `<p><i class="a-dot lv${g.level}" aria-hidden="true"></i><b>${esc(LEVEL_WORDS[g.level])} per ${esc(g.risk)}</b>: ${esc(g.regions.map((r) => `${r.region} (${r.zones})`).join('; '))}.</p>`).join('')
    : '<p>Nessuna allerta in Italia.</p>');
  return sheetFrame('alerts', 'Allerte ufficiali', `
    <p>Zona di allerta <b>${esc(a.zone)}</b>, dal bollettino di criticità della Protezione Civile del ${day} alle ${esc(a.time)}.</p>
    <table class="alert-t">
      <thead><tr><th scope="col">Rischio</th><th scope="col">Oggi</th><th scope="col">Domani</th></tr></thead>
      <tbody>${RISKS.map(([, , plain], i) => `<tr><th scope="row">${esc(plain)}</th>${cell(a.today, i)}${cell(a.tomorrow, i)}</tr>`).join('')}</tbody>
    </table>
    <p>Le allerte le decidono la Protezione Civile e le Regioni: Isobara le riporta così come sono, separate dalla sua previsione. Per sapere cosa fare vale il sito di allerta della tua Regione.</p>
    <a class="pill glass wide" href="${OFFICIAL_URL}" target="_blank" rel="noopener">${UI.arrowOut}Apri il bollettino ufficiale</a>
    <details class="more"><summary>In tutta Italia, oggi</summary>${national(a.national?.today)}</details>
    ${a.tomorrow ? `<details class="more"><summary>In tutta Italia, domani</summary>${national(a.national?.tomorrow)}</details>` : ''}`);
}

/* ------------------------------------------------------------------ */
/* Radar                                                                */
/* ------------------------------------------------------------------ */

let radar = null;
let radarToken = 0;

function radarSheet() {
  const v = state.view;
  const fmt = v ? makeFormatters(v.result.tz) : null;
  const nc = v?.nowcast;
  return sheetFrame('radar', 'Radar', `
    <div class="radar-map" id="radarMap"><p class="radar-msg">Carico il radar…</p></div>
    <div class="radar-bar">
      <button type="button" class="round" id="radarPlay" data-action="radar-play" aria-label="Fai partire l'animazione">${UI.play}</button>
      <input type="range" id="radarRange" min="0" max="12" value="12" step="1" aria-label="Momento del radar">
      <span class="radar-time" id="radarTime">–</span>
    </div>
    <p>La pioggia vista dai radar nelle ultime due ore, un'immagine ogni 10 minuti.${nc ? ` Per le prossime due ore valgono i modelli: ${esc(nowcastText(nc, fmt).replace(/^./, (c) => c.toLowerCase()))}` : ''}</p>`);
}

async function startRadar() {
  const place = currentPlace();
  const el = $('#radarMap');
  if (!place || !el) return;
  const token = ++radarToken;
  const tz = state.view?.result.tz || 'Europe/Rome';
  const fmt = makeFormatters(tz);
  await new Promise((r) => setTimeout(r, reduceMotion.matches ? 0 : 340));
  if (token !== radarToken || openName !== 'radar') return;
  try {
    el.innerHTML = '';
    const { createRadar } = await import('./radar.js');
    const api = await createRadar(el, place, {
      reduceMotion: reduceMotion.matches,
      onFrame: (t, i, n) => {
        const time = $('#radarTime');
        const range = $('#radarRange');
        if (time) time.textContent = i === n - 1 ? `${fmt.hm(t)}, l'ultima` : fmt.hm(t);
        if (range) { range.max = String(n - 1); range.value = String(i); }
      },
    });
    if (token !== radarToken || openName !== 'radar') { api.destroy(); return; }
    radar = api;
    syncRadarButton();
    setTimeout(() => radar?.resize(), 50);
  } catch {
    if (token === radarToken) el.innerHTML = '<p class="radar-msg">Radar non disponibile adesso: controlla la connessione e riprova.</p>';
  }
}

function stopRadar() {
  radarToken++;
  radar?.destroy();
  radar = null;
}

function syncRadarButton() {
  const b = $('#radarPlay');
  if (!b || !radar) return;
  b.innerHTML = radar.playing ? UI.pause : UI.play;
  b.setAttribute('aria-label', radar.playing ? 'Ferma l\'animazione' : 'Fai partire l\'animazione');
}

/* ------------------------------------------------------------------ */
/* Eventi                                                               */
/* ------------------------------------------------------------------ */

function setPreview(k) {
  state.preview = k;
  render();
  updateSky();
}

document.addEventListener('click', (e) => {
  const d = e.target.closest('dialog.sheet');
  if (d && e.target === d) { closeSheet(); return; }
  const t = e.target.closest('[data-action],[data-open],[data-pick],[data-result],[data-place],[data-remove],[data-suggest],[data-day],.st-hit,#placeBtn,#refreshBtn,#askBtn,#radarBtn');
  if (!t) return;
  if (t.matches('.st-hit')) {
    const k = Number(t.dataset.k);
    setPreview(k === 0 || k === state.preview ? null : k);
    return;
  }
  if (t.id === 'placeBtn') { openSheet('places'); return; }
  if (t.id === 'refreshBtn') { load({ force: true }); return; }
  if (t.id === 'askBtn') { openSheet('claude'); return; }
  if (t.id === 'radarBtn') { openSheet('radar'); return; }
  if (t.dataset.open) { openSheet(t.dataset.open); return; }
  if (t.dataset.pick != null) { selectPlace(QUICK[Number(t.dataset.pick)]); return; }
  if (t.dataset.result != null) { selectPlace(state.results[Number(t.dataset.result)]); return; }
  if (t.dataset.place) { const p = state.places.find((x) => x.id === t.dataset.place); if (p) selectPlace(p); return; }
  if (t.dataset.remove) { removePlace(t.dataset.remove); return; }
  if (t.dataset.day) {
    const li = t.closest('.day');
    const open = !li.classList.contains('open');
    state.openDay = open ? t.dataset.day : null;
    document.querySelectorAll('.day.open').forEach((x) => { x.classList.remove('open'); x.querySelector('.day-btn').setAttribute('aria-expanded', 'false'); });
    if (open) { li.classList.add('open'); t.setAttribute('aria-expanded', 'true'); }
    return;
  }
  if (t.dataset.suggest != null) {
    state.question = SUGGESTIONS[Number(t.dataset.suggest)];
    const ta = $('#question'); if (ta) ta.value = state.question;
    refreshPrompt();
    return;
  }
  const a = t.dataset.action;
  if (a === 'close') closeSheet();
  else if (a === 'gps') useGps();
  else if (a === 'retry') load({ force: true });
  else if (a === 'retry-ver') { store.del(`ver.${state.currentId}`); load(); }
  else if (a === 'now') setPreview(null);
  else if (a === 'share') sharePrompt();
  else if (a === 'copy') copyPrompt();
  else if (a === 'radar-play' && radar) {
    if (radar.playing) radar.pause(); else radar.play();
    syncRadarButton();
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'radarRange' && radar) {
    radar.seek(Number(e.target.value));
    syncRadarButton();
  }
});

document.querySelectorAll('dialog.sheet').forEach((d) => {
  d.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(); });
});
window.addEventListener('popstate', () => { if (openName) closeSheet({ fromPop: true }); });

document.addEventListener('keydown', (e) => {
  if (e.target.id === 'searchInput' && e.key === 'Enter' && state.results[0]) selectPlace(state.results[0]);
});

let promptTimer = null;
document.addEventListener('input', (e) => {
  if (e.target.id === 'question') {
    state.question = e.target.value;
    clearTimeout(promptTimer);
    promptTimer = setTimeout(refreshPrompt, 150);
  }
});

document.addEventListener('change', (e) => {
  const m = e.target.dataset?.model;
  if (!m) return;
  if (!e.target.checked && state.models.length <= 2) { e.target.checked = true; return; }
  toggleModel(m, e.target.checked);
});

let dimQueued = false;
window.addEventListener('scroll', () => {
  if (dimQueued) return;
  dimQueued = true;
  requestAnimationFrame(() => {
    dimQueued = false;
    const v = Math.min(1, window.scrollY / (window.innerHeight * 0.8));
    document.documentElement.style.setProperty('--dim', v.toFixed(3));
  });
}, { passive: true });

window.addEventListener('online', () => { render(); load(); });
window.addEventListener('offline', render);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (state.cache.fc && Date.now() - state.cache.fc.at > FC_FRESH) load();
  else { compute(); render(); updateSky(); }
});

/* ------------------------------------------------------------------ */
/* Avvio                                                                */
/* ------------------------------------------------------------------ */

document.documentElement.classList.toggle('in-app', inApp);
document.querySelectorAll('[data-icon]').forEach((n) => { n.innerHTML = UI[n.dataset.icon] || ''; });
render();
setTimeout(() => { load(); checkUpdate(); }, 60);

// Nell'app Android i file sono già nel telefono: il service worker serve solo al sito.
if ('serviceWorker' in navigator && location.protocol === 'https:' && !inApp) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* l'app funziona anche senza */ });
}
