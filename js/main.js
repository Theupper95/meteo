// Isobara: interfaccia.

import { MODELS, MODEL_BY_ID, DEFAULT_MODELS, shortName } from './models.js';
import {
  parseForecast, parseBestMatch, parseVerification, computeSkill, computeWeights,
  evaluateMethod, buildForecast, computeNormals, isNum,
} from './engine.js';
import {
  fetchForecast, fetchBestMatch, fetchPreviousRuns, fetchTruth, fetchNormals,
  verificationWindow, searchPlaces, reverseName,
} from './api.js';
import {
  f0, f1, deg, pct, mm, signed, describe, rose, windText, makeFormatters,
  CONF_LABEL, reasonText, nextHoursText, buildPrompt, claudeUrl,
} from './text.js';
import { weatherIcon, UI } from './icons.js';
import { hourStrip, stripHours, tempColor } from './chart.js';
import { createSky, skyState, toHex } from './sky.js';

const VERSION = '2.0.0';
const FC_FRESH = 20 * 60e3;
const VER_FRESH = 12 * 3600e3;
const NORM_FRESH = 60 * 86400e3;

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

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

function saveForecastCache(id, value) {
  let keys = store.get('fcKeys', []).filter((k) => k !== id);
  keys.unshift(id);
  for (const old of keys.slice(6)) store.del(`fc.${old}`);
  keys = keys.slice(0, 6);
  store.set('fcKeys', keys);
  if (!store.set(`fc.${id}`, value)) {
    for (const old of keys.slice(1)) store.del(`fc.${old}`);
    store.set('fcKeys', [id]);
    store.set(`fc.${id}`, value);
  }
}

const placeId = (p) => `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`;
const modelsKey = (ms) => [...ms].sort().join(',');

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
  cache: { fc: null, ver: null, norm: null },
  view: null,
  preview: null,
  openDay: null,
  revealed: null,
  question: '',
  results: [],
  searching: false,
  searchError: null,
  gpsMessage: null,
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
}

/* ------------------------------------------------------------------ */
/* Dati                                                                 */
/* ------------------------------------------------------------------ */

let loadToken = 0;

function compute() {
  const c = state.cache;
  if (!c.fc) { state.view = null; return; }
  const fc = parseForecast(c.fc.fc, c.fc.models);
  const bm = parseBestMatch(c.fc.bm);
  const models = Object.keys(fc.models);
  if (!models.length) { state.view = null; state.error = { message: 'Nessun modello ha dati per questo luogo' }; return; }
  const skill = c.ver?.skill || {};
  const weights = computeWeights(skill, models);
  const result = buildForecast({ fc, bm, skill, weights, now: Date.now() / 1000, normals: c.norm?.normals || null });
  state.view = { fc, bm, skill, weights, result, fetchedAt: c.fc.at };
}

async function loadVerification(place, models, token) {
  state.verLoading = true;
  render();
  try {
    const win = verificationWindow();
    const [prev, truth] = await Promise.all([fetchPreviousRuns(place, models, win), fetchTruth(place, win)]);
    const ver = parseVerification(prev.data, prev.models, truth.data, truth.models);
    const verModels = Object.keys(ver.fc);
    const value = {
      at: Date.now(), key: modelsKey(models), window: win,
      skill: computeSkill(ver, verModels), evaluation: evaluateMethod(ver, verModels),
      truthLabel: ver.truth.tLabel, verModels,
    };
    if (token !== loadToken) return;
    store.set(`ver.${place.id}`, value);
    state.cache.ver = value;
    state.verError = null;
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

async function load({ force = false } = {}) {
  const place = currentPlace();
  if (!place) { state.view = null; render(); updateSky(); return; }
  const token = ++loadToken;
  const key = modelsKey(state.models);
  state.cache = { fc: store.get(`fc.${place.id}`), ver: store.get(`ver.${place.id}`), norm: store.get(`norm.${place.id}`) };
  if (state.cache.fc && state.cache.fc.key !== key) state.cache.fc = null;
  state.error = null;
  state.preview = null;
  compute();

  const fcStale = force || !state.cache.fc || Date.now() - state.cache.fc.at > FC_FRESH;
  const verStale = !state.cache.ver || state.cache.ver.key !== key || Date.now() - state.cache.ver.at > VER_FRESH;
  const normStale = !state.cache.norm || Date.now() - state.cache.norm.at > NORM_FRESH;

  if (verStale) loadVerification(place, state.models, token);
  if (fcStale) {
    state.loading = true;
    render();
    updateSky();
    try {
      const [f, b] = await Promise.all([fetchForecast(place, state.models), fetchBestMatch(place).catch(() => null)]);
      if (token !== loadToken) return;
      const value = { at: Date.now(), key, models: f.models, fc: f.data, bm: b };
      saveForecastCache(place.id, value);
      state.cache.fc = value;
      if (place.elevation == null && isNum(f.data.elevation)) {
        place.elevation = f.data.elevation;
        store.set('places', state.places);
      }
      compute();
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
/* Luoghi                                                               */
/* ------------------------------------------------------------------ */

function selectPlace(p) {
  const id = placeId(p);
  let place = state.places.find((x) => x.id === id);
  if (!place) {
    place = { id, name: p.name, admin: p.admin || '', lat: p.lat, lon: p.lon, elevation: p.elevation ?? null, gps: !!p.gps };
    state.places.unshift(place);
    state.places = state.places.slice(0, 12);
    store.set('places', state.places);
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
  store.set('places', state.places);
  store.del(`fc.${id}`); store.del(`ver.${id}`); store.del(`norm.${id}`);
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
        ? 'Hai negato il permesso della posizione. Puoi riattivarlo dalle impostazioni del sito in Chrome, o cercare il luogo per nome.'
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
  $('#askBtn').hidden = !(place && v);

  const notice = $('#notice');
  let msg = '';
  if (!navigator.onLine && v) msg = `Sei offline: dati delle ${makeFormatters(v.result.tz).hm(v.fetchedAt / 1000)}.`;
  else if (state.error && v) msg = `${errorText(state.error)}: vedi i dati delle ${makeFormatters(v.result.tz).hm(v.fetchedAt / 1000)}.`;
  notice.hidden = !msg;
  notice.textContent = msg;

  const main = $('#main');
  if (!place) { main.innerHTML = welcomeHTML(); return; }
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
  main.innerHTML = heroHTML(v, first) + stripHTML(v) + weekHTML(v) + trustHTML(v, place) + creditsHTML(v);
  const sc = $('.scroller');
  if (sc) sc.scrollLeft = left;
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

function dayWord(h, result, fmt) {
  const today = result.days[0]?.key;
  const tomorrow = result.days[1]?.key;
  const when = h.day === today ? 'Oggi' : h.day === tomorrow ? 'Domani' : cap(fmt.weekdayLong(h.t));
  return `${when} alle ${fmt.hour(h.t)}`;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

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
  const line = preview
    ? `<p class="line">Vento ${esc(windText(preview.wind, preview.dir))}${isNum(preview.gust) && preview.gust > preview.wind + 8 ? `, raffiche ${f0(preview.gust)}` : ''}.</p>`
    : `<p class="line">${esc(nextHoursText(result, fmt))}</p>`;
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

function weekHTML(v) {
  const { result } = v;
  const fmt = makeFormatters(result.tz);
  const ds = result.days;
  const lo = Math.min(...ds.map((d) => d.tmin));
  const hi = Math.max(...ds.map((d) => d.tmax));
  const pos = (t) => ((t - lo) / Math.max(1, hi - lo)) * 100;
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
        <span class="bar" aria-hidden="true"><i style="left:${a.toFixed(1)}%;width:${(b - a).toFixed(1)}%;background:linear-gradient(90deg,${tempColor(d.tmin)},${tempColor(d.tmax)})"></i></span>
        <span class="d-max">${deg(d.tmax)}</span>
      </button>
      <div class="d-more"><div><div class="d-text">${dayText(d, v, fmt)}</div></div></div>
    </li>`;
  }).join('');
  return `<section class="block"><h2>Sette giorni</h2><ul class="days">${rows}</ul></section>`;
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
  if (d.sunrise && d.sunset) out.push(`Alba ${fmt.hm(d.sunrise)}, tramonto ${fmt.hm(d.sunset)}.`);
  const ms = Object.keys(d.per).sort((a, b) => (v.weights.t1[b] ?? 0) - (v.weights.t1[a] ?? 0));
  const models = ms.map((m) => `${shortName(m)} ${f0(d.per[m].tmin)}°/${f0(d.per[m].tmax)}°`).join(', ');
  return out.map((p) => `<p>${esc(p)}</p>`).join('') + `<p class="models">${esc(models)}</p>`;
}

function trustHTML(v, place) {
  const ver = state.cache.ver;
  const ev = ver?.evaluation;
  let body;
  if (ev) {
    body = `<p class="big">${f1(ev.maeOurs)}°</p>
      <p>È l'errore medio di questa previsione sul giorno dopo, misurato qui negli ultimi ${ev.testDays} giorni. La media semplice dei modelli sbaglia di ${f1(ev.maeMean)}°.</p>`;
  } else if (ver) {
    body = `<p class="big">±${f1(v.result.days[1]?.err ?? 1.2)}°</p><p>È l'errore tipico per domani, calcolato dagli ultimi ${ver.verModels?.length || ''} modelli verificati qui.</p>`;
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

function creditsHTML(v) {
  const fmt = makeFormatters(v.result.tz);
  return `<footer class="credits">
    <p>Aggiornato alle ${fmt.hm(v.fetchedAt / 1000)} con ${v.result.models.length} modelli.</p>
    <p>Dati di <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo.com</a> (CC BY 4.0), modelli di ECMWF, DWD, ItaliaMeteo, Météo-France, NOAA e Met Office.</p>
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
}

function closeSheet({ fromPop = false, silent = false } = {}) {
  if (!openName) return;
  const d = $(`#sheet-${openName}`);
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
      <p>Dati meteo di Open-Meteo.com (CC BY 4.0). Clima 1991–2020 e verifica della pioggia dalla rianalisi ERA5 di Copernicus. Nomi dei luoghi dal GPS: OpenStreetMap.</p>
      <p>I tuoi luoghi restano su questo telefono. Claude riceve la previsione solo quando premi il pulsante. Isobara ${VERSION}.</p>
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
  const args = {
    place, result: v.result, skill: v.skill, weights: v.weights,
    evaluation: state.cache.ver?.evaluation || null, truthLabel: state.cache.ver?.truthLabel || null,
    question: state.question,
  };
  const full = buildPrompt({ ...args, full: true });
  const link = claudeUrl(full).length < 6000 ? claudeUrl(full) : claudeUrl(buildPrompt({ ...args, full: false }));
  return { full, link };
}

function claudeSheet() {
  const p = prompts();
  if (!p) return sheetFrame('claude', 'Chiedi a Claude', '<p>Prima scegli un luogo.</p>');
  const canShare = typeof navigator.share === 'function';
  return sheetFrame('claude', 'Chiedi a Claude', `
    <p>Claude riceve la previsione, quanto sono d'accordo i modelli e quanto ha sbagliato ognuno qui, e ti spiega cosa aspettarti.</p>
    <label class="sr" for="question">La tua domanda</label>
    <textarea class="field" id="question" placeholder="Scrivi una domanda, per esempio: sabato posso andare al mare?">${esc(state.question)}</textarea>
    <div class="chips">${SUGGESTIONS.map((s, i) => `<button type="button" class="chip" data-suggest="${i}">${esc(s)}</button>`).join('')}</div>
    <a class="pill solid wide" id="askLink" href="${esc(p.link)}" target="_blank" rel="noopener" style="margin-top:14px">${UI.arrowOut}Apri in Claude</a>
    <div class="row">
      ${canShare ? `<button type="button" class="pill glass" data-action="share">${UI.share}Condividi</button>` : ''}
      <button type="button" class="pill glass" data-action="copy">${UI.copy}Copia il testo</button>
    </div>
    <p id="claudeNote">Si apre l'app Claude con il messaggio già scritto.${canShare ? ' Con Condividi puoi sceglierla dal menu di Android.' : ''}</p>
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
  try { await navigator.share({ title: `Meteo per ${currentPlace().name}`, text: p.full }); } catch { /* annullato */ }
}

async function copyPrompt() {
  const p = prompts();
  if (!p) return;
  const note = $('#claudeNote');
  try {
    await navigator.clipboard.writeText(p.full);
    if (note) note.textContent = 'Testo copiato: incollalo in una nuova chat di Claude.';
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
  const bar = (st, cls, label) => (st ? `<div class="m-bar ${cls}"><i><em style="width:${((st.maeRaw / maxE) * 100).toFixed(1)}%"></em></i><span>${label} ${f1(st.maeRaw)}°</span></div>` : '');
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
  return sheetFrame('trust', 'Come funziona', `
    <p>Dal ${fmtD(ver.window.start)} al ${fmtD(ver.window.end)} ho confrontato le previsioni fatte 1 e 4 giorni prima da ogni modello con il tempo reale a ${esc(place.name)}.</p>
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
      <li><b>Verifica.</b> L'app recupera cosa avevano previsto 1 e 4 giorni prima e lo confronta con quello che è successo davvero in questo punto.</li>
      <li><b>Correzione.</b> Se un modello qui è sempre troppo caldo di notte, l'app gli toglie l'errore, ora per ora.</li>
      <li><b>Consenso.</b> La previsione è la media dei modelli corretti, con più peso a chi ha sbagliato meno, senza mai affidarsi a uno solo.</li>
      <li><b>Fiducia.</b> Scende quando i modelli si dividono sulla pioggia o sulle temperature, o quando il giorno è lontano.</li>
    </ol>
    <p>Il tempo reale è l'analisi del Centro europeo (${esc(ver.truthLabel)}), che unisce milioni di osservazioni ogni 6 ore: per questo i modelli ECMWF partono un po' avvantaggiati. Per la pioggia si usa la rianalisi ERA5.</p>`);
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
  const t = e.target.closest('[data-action],[data-open],[data-pick],[data-result],[data-place],[data-remove],[data-suggest],[data-day],.st-hit,#placeBtn,#refreshBtn,#askBtn');
  if (!t) return;
  if (t.matches('.st-hit')) {
    const k = Number(t.dataset.k);
    setPreview(k === 0 || k === state.preview ? null : k);
    return;
  }
  if (t.id === 'placeBtn') { openSheet('places'); return; }
  if (t.id === 'refreshBtn') { load({ force: true }); return; }
  if (t.id === 'askBtn') { openSheet('claude'); return; }
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
  else updateSky();
});

/* ------------------------------------------------------------------ */
/* Avvio                                                                */
/* ------------------------------------------------------------------ */

document.querySelectorAll('[data-icon]').forEach((n) => { n.innerHTML = UI[n.dataset.icon] || ''; });
render();
setTimeout(() => load(), 60);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* l'app funziona anche senza */ });
}
