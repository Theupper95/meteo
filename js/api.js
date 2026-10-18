// Richieste ai servizi di dati: Open-Meteo (gratuito, senza chiave, per uso non commerciale)
// e le osservazioni delle stazioni dell'Iowa Environmental Mesonet.

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const PREVIOUS = 'https://previous-runs-api.open-meteo.com/v1/forecast';
const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const ENSEMBLE = 'https://ensemble-api.open-meteo.com/v1/ensemble';
const AIR = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const MARINE = 'https://marine-api.open-meteo.com/v1/marine';
const ELEVATION = 'https://api.open-meteo.com/v1/elevation';
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const REVERSE = 'https://nominatim.openstreetmap.org/reverse';
const IEM = 'https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py';

export class ApiError extends Error {
  constructor(message, status, reason) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

function url(base, params) {
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%2C/g, ',')}`)
    .join('&');
  return `${base}?${q}`;
}

export function getJSON(u, opts) {
  return request(u, opts, 'json');
}

export function getText(u, opts) {
  return request(u, opts, 'text');
}

/* ------------------------------------------------------------------ */
/* Coda verso Open-Meteo                                                */
/* ------------------------------------------------------------------ */

// Il servizio gratuito lavora una richiesta alla volta per indirizzo e rifiuta quelle in più:
// l'app ne tiene al massimo due in viaggio, e le più importanti passano prima
// (priorità 0 = previsione e ricerca, 4 = clima di 30 anni).
const OM_MAX = 2;
let omRunning = 0;
let omSeq = 0;
const omWaiting = [];

function omAcquire(priority) {
  if (omRunning < OM_MAX) { omRunning++; return Promise.resolve(); }
  return new Promise((resolve) => {
    omWaiting.push({ priority, seq: omSeq++, resolve });
    omWaiting.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
  });
}

function omRelease() {
  const next = omWaiting.shift();
  if (next) next.resolve();
  else omRunning--;
}

const isOpenMeteo = (u) => /^https:\/\/[a-z-]*\.?open-meteo\.com\//.test(u);

// Errori passeggeri: servizio sovraccarico (503), troppe richieste insieme (429), gateway (502, 504).
export const isTransient = (e) => [502, 503, 504].includes(e?.status) || (e?.status === 429 && /concurrent/i.test(e.reason || ''));

const RETRY_AFTER = [1500, 4000, 9000];
const pause = (ms, signal) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

async function request(u, opts = {}, as = 'json') {
  const om = isOpenMeteo(u);
  let timeouts = 0;
  for (let attempt = 0; ; attempt++) {
    if (om) await omAcquire(opts.priority ?? 2);
    try {
      return await requestOnce(u, opts, as);
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      // si riprova da soli quando il servizio è solo momentaneamente occupato
      const again = isTransient(e) ? attempt < RETRY_AFTER.length : e.reason === 'timeout' && timeouts++ < 1;
      if (!again) throw e;
    } finally {
      if (om) omRelease();
    }
    await pause(RETRY_AFTER[Math.min(attempt, RETRY_AFTER.length - 1)] * (0.8 + 0.4 * Math.random()), opts.signal);
  }
}

async function requestOnce(u, { timeout = 25000, signal } = {}, as = 'json') {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(u, { signal: ctl.signal });
    if (as === 'text') {
      const text = await res.text();
      if (!res.ok) throw new ApiError(`Errore HTTP ${res.status}`, res.status, '');
      return text;
    }
    let body = null;
    try { body = await res.json(); } catch { /* risposta non JSON */ }
    if (!res.ok || body?.error) {
      const reason = body?.reason || body?.message || '';
      throw new ApiError(reason || `Errore HTTP ${res.status}`, res.status, reason);
    }
    return body;
  } catch (e) {
    if (e.name === 'AbortError') throw new ApiError(signal?.aborted ? 'annullata' : 'Il server non risponde', 0, 'timeout');
    if (e instanceof ApiError) throw e;
    throw new ApiError('Connessione assente', 0, 'network');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

// Chiede più modelli insieme; se l'API rifiuta un modello (nome cambiato o non disponibile)
// lo toglie e riprova, così l'app continua a funzionare con gli altri.
async function getModels(base, params, models, opts) {
  let list = [...models];
  for (let attempt = 0; attempt < 5 && list.length; attempt++) {
    try {
      const data = await getJSON(url(base, { ...params, models: list.join(',') }), opts);
      return { data, models: list };
    } catch (e) {
      const bad = e.status === 400 && list.find((m) => new RegExp(`\\b${m}\\b`).test(e.reason || ''));
      if (bad) { list = list.filter((m) => m !== bad); continue; }
      throw e;
    }
  }
  throw new ApiError('Nessun modello disponibile per questo luogo', 400, 'models');
}

const ymd = (d) => d.toISOString().slice(0, 10);

export function fetchForecast(place, models, opts) {
  return getModels(FORECAST, {
    latitude: place.lat, longitude: place.lon,
    hourly: 'temperature_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,snowfall,relative_humidity_2m',
    timezone: 'auto', timeformat: 'unixtime', past_days: 1, forecast_days: 8,
  }, models, { priority: 0, ...opts });
}

export function fetchBestMatch(place, opts) {
  return getJSON(url(FORECAST, {
    latitude: place.lat, longitude: place.lon,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,is_day',
    minutely_15: 'precipitation',
    hourly: 'temperature_2m,apparent_temperature,precipitation_probability,freezing_level_height',
    daily: 'sunrise,sunset,uv_index_max,precipitation_probability_max',
    timezone: 'auto', timeformat: 'unixtime', past_days: 1, forecast_days: 8,
    past_minutely_15: 1, forecast_minutely_15: 12,
  }), { priority: 0, ...opts });
}

// 51 simulazioni del Centro europeo per 15 giorni: servono per la tendenza oltre la settimana.
export function fetchEnsemble(place, opts) {
  return getJSON(url(ENSEMBLE, {
    latitude: place.lat, longitude: place.lon,
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum',
    models: 'ecmwf_ifs025_ensemble',
    forecast_days: 15, timezone: 'auto', timeformat: 'unixtime',
  }), { timeout: 30000, priority: 3, ...opts });
}

// Qualità dell'aria e pollini (Copernicus CAMS).
export function fetchAir(place, opts) {
  return getJSON(url(AIR, {
    latitude: place.lat, longitude: place.lon,
    current: 'european_aqi,european_aqi_pm2_5,european_aqi_pm10,european_aqi_nitrogen_dioxide,european_aqi_ozone',
    hourly: 'european_aqi,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen',
    forecast_days: 2, timezone: 'auto', timeformat: 'unixtime',
  }), { timeout: 20000, priority: 2, ...opts });
}

// Onde e temperatura dell'acqua nella cella di mare più vicina.
export function fetchMarine(place, opts) {
  return getJSON(url(MARINE, {
    latitude: place.lat, longitude: place.lon,
    current: 'wave_height,sea_surface_temperature',
    hourly: 'wave_height,wave_direction,wave_period,sea_surface_temperature',
    forecast_days: 2, timezone: 'auto', timeformat: 'unixtime',
  }), { timeout: 20000, priority: 2, ...opts });
}

export async function fetchElevation(place, opts) {
  const data = await getJSON(url(ELEVATION, { latitude: place.lat, longitude: place.lon }), { timeout: 10000, priority: 1, ...opts });
  const e = data?.elevation?.[0];
  return typeof e === 'number' ? e : null;
}

// Osservazioni orarie (METAR) di una stazione, in CSV: temperatura, vento in nodi, fenomeni.
export function fetchStationObs(id, win, opts) {
  const [y1, m1, d1] = win.start.split('-').map(Number);
  const end = new Date(Date.parse(`${win.end}T00:00:00Z`) + 2 * 86400000);
  const q = [
    `station=${id}`, 'data=tmpc', 'data=sknt', 'data=wxcodes',
    `year1=${y1}`, `month1=${m1}`, `day1=${d1}`,
    `year2=${end.getUTCFullYear()}`, `month2=${end.getUTCMonth() + 1}`, `day2=${end.getUTCDate()}`,
    'tz=Etc/UTC', 'format=onlycomma', 'latlon=no', 'missing=M', 'trace=T', 'direct=no', 'report_type=3',
  ].join('&');
  return getText(`${IEM}?${q}`, { timeout: 30000, ...opts });
}

// Finestra di verifica: gli ultimi 36 giorni fino a ieri (UTC).
export function verificationWindow(now = Date.now()) {
  const end = new Date(now - 86400000);
  const start = new Date(now - 36 * 86400000);
  return { start: ymd(start), end: ymd(end) };
}

export function fetchPreviousRuns(place, models, win, opts) {
  return getModels(PREVIOUS, {
    latitude: place.lat, longitude: place.lon,
    hourly: 'temperature_2m_previous_day1,temperature_2m_previous_day4,precipitation_previous_day1,wind_speed_10m_previous_day1',
    start_date: win.start, end_date: win.end,
    timezone: 'GMT', timeformat: 'unixtime',
  }, models, { priority: 1, ...opts });
}

export function fetchTruth(place, win, opts) {
  return getModels(ARCHIVE, {
    latitude: place.lat, longitude: place.lon,
    hourly: 'temperature_2m,wind_speed_10m,precipitation',
    start_date: win.start, end_date: win.end,
    timezone: 'GMT', timeformat: 'unixtime',
  }, ['ecmwf_ifs_analysis_long_window', 'era5'], { priority: 1, ...opts });
}

export function fetchNormals(place, opts) {
  return getJSON(url(ARCHIVE, {
    latitude: place.lat, longitude: place.lon,
    // 30 anni di dati giornalieri pesano circa 150 "chiamate" sul limite gratuito: si scaricano una volta ogni 60 giorni
    daily: 'temperature_2m_max,temperature_2m_min',
    start_date: '1991-01-01', end_date: '2020-12-31',
    models: 'era5_seamless', timezone: 'auto',
  }), { timeout: 60000, priority: 4, ...opts });
}

export async function searchPlaces(text, opts) {
  const data = await getJSON(url(GEOCODE, { name: text, count: 8, language: 'it', format: 'json' }), { timeout: 12000, priority: 0, ...opts });
  return (data.results || []).map((r) => ({
    name: r.name,
    admin: [r.admin1, r.country_code !== 'IT' ? r.country : null].filter(Boolean).join(', '),
    lat: Math.round(r.latitude * 10000) / 10000,
    lon: Math.round(r.longitude * 10000) / 10000,
    elevation: r.elevation,
  }));
}

// Nome del luogo dalle coordinate GPS (OpenStreetMap). Se fallisce restano le coordinate.
export async function reverseName(lat, lon) {
  try {
    const data = await getJSON(url(REVERSE, { format: 'jsonv2', lat, lon, zoom: 14, 'accept-language': 'it' }), { timeout: 8000 });
    const a = data.address || {};
    const name = a.village || a.town || a.city || a.hamlet || a.suburb || a.municipality || data.name;
    if (!name) return null;
    return { name, admin: [a.state || a.region, a.country_code && a.country_code !== 'it' ? a.country : null].filter(Boolean).join(', ') };
  } catch {
    return null;
  }
}
