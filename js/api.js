// Richieste a Open-Meteo (gratuito, senza chiave, per uso non commerciale).

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const PREVIOUS = 'https://previous-runs-api.open-meteo.com/v1/forecast';
const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const REVERSE = 'https://nominatim.openstreetmap.org/reverse';

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

async function getJSON(u, { timeout = 25000, signal } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(u, { signal: ctl.signal });
    let body = null;
    try { body = await res.json(); } catch { /* risposta non JSON */ }
    if (!res.ok || body?.error) {
      const reason = body?.reason || '';
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
  }, models, opts);
}

export function fetchBestMatch(place, opts) {
  return getJSON(url(FORECAST, {
    latitude: place.lat, longitude: place.lon,
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation,is_day',
    hourly: 'temperature_2m,apparent_temperature,precipitation_probability',
    daily: 'sunrise,sunset,uv_index_max,precipitation_probability_max',
    timezone: 'auto', timeformat: 'unixtime', past_days: 1, forecast_days: 8,
  }), opts);
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
  }, models, opts);
}

export function fetchTruth(place, win, opts) {
  return getModels(ARCHIVE, {
    latitude: place.lat, longitude: place.lon,
    hourly: 'temperature_2m,wind_speed_10m,precipitation',
    start_date: win.start, end_date: win.end,
    timezone: 'GMT', timeformat: 'unixtime',
  }, ['ecmwf_ifs_analysis_long_window', 'era5'], opts);
}

export function fetchNormals(place, opts) {
  return getJSON(url(ARCHIVE, {
    latitude: place.lat, longitude: place.lon,
    // 30 anni di dati giornalieri pesano circa 150 "chiamate" sul limite gratuito: si scaricano una volta ogni 60 giorni
    daily: 'temperature_2m_max,temperature_2m_min',
    start_date: '1991-01-01', end_date: '2020-12-31',
    models: 'era5_seamless', timezone: 'auto',
  }), { timeout: 60000, ...opts });
}

export async function searchPlaces(text, opts) {
  const data = await getJSON(url(GEOCODE, { name: text, count: 8, language: 'it', format: 'json' }), { timeout: 12000, ...opts });
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
