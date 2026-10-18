// Radar: la pioggia vista dai radar nelle ultime due ore, disegnata nello stile di Isobara.
// Coste, confini, regioni e città li disegna l'app (niente mappe di altri, niente chiavi);
// le immagini di RainViewer vengono lette pixel per pixel, tradotte in intensità (dBZ)
// con la loro tabella ufficiale dei colori e ridipinte con i colori dell'app.
// La libreria della mappa (Leaflet) serve solo per spostare e ingrandire, e si carica
// quando si apre il radar.

import { getJSON } from './api.js';
import { topoFeatures, decodeArcs } from './topo.js';

const FRAMES_URL = 'https://api.rainviewer.com/public/weather-maps.json';
const MAP_URL = 'data/italia.json';

/* ------------------------------------------------------------------ */
/* Colori: dalla tabella di RainViewer all'intensità, poi alla palette  */
/* ------------------------------------------------------------------ */

// "Universal Blue", la tabella ufficiale di RainViewer (pioggia), da -10 a 74 dBZ (RRGGBBAA).
const UB = ('63615914 66635a19 69665c1e 6c685d24 6f6b5f29 726e612e 75706234 78736439 7c75653e 7f786744 '
  + '827b6949 857d6a4e 88806c54 8b826d59 8e856f5e 92887164 9e93756e aa9e7978 b6a97e82 c2b4828c '
  + 'cec08796 d2c48ba0 d6c88faa dacc93b4 ded097be 88ddeeff 6cd1ebff 51c5e8ff 36bae5ff 1baee2ff '
  + '00a3e0ff 009ad5ff 0091caff 0088bfff 007fb4ff 0077aaff 0070a3ff 00699cff 006295ff 005b8eff '
  + '005588ff 005180ff 004e78ff 004a70ff 004768ff ffee00ff ffe000ff ffd200ff ffc500ff ffb700ff '
  + 'ffaa00ff ff9f00ff ff9500ff ff8b00ff ff8100ff ff4400ff f23600ff e62800ff d91b00ff cd0d00ff '
  + 'c10000ff a80000ff 8f0000ff 760000ff 5d0000ff ffaaffff ff9fffff ff95ffff ff8bffff ff81ffff '
  + 'ff77ffff ff6cffff ff62ffff ff58ffff ff4effff ffffffff ffffffff ffffffff ffffffff ffffffff '
  + 'ffffffff ffffffff ffffffff ffffffff ffffffff 00ff00ff').split(' ');
const DBZ0 = -10;

// La palette di Isobara: pioggia debole azzurro ghiaccio quasi trasparente, poi sempre più
// luminosa fino al bianco, oro come i fulmini delle icone per i temporali, corallo per la grandine.
export const RAIN_STOPS = [
  [9, [150, 205, 255, 0]],
  [14, [150, 205, 255, 64]],
  [19, [154, 210, 255, 132]],
  [26, [116, 188, 255, 182]],
  [33, [190, 226, 255, 216]],
  [39, [246, 250, 255, 236]],
  [45, [255, 219, 118, 244]],
  [51, [255, 162, 92, 250]],
  [57, [255, 108, 104, 255]],
  [65, [255, 128, 200, 255]],
];

function paint(dbz) {
  if (dbz <= RAIN_STOPS[0][0]) return [0, 0, 0, 0];
  for (let i = 1; i < RAIN_STOPS.length; i++) {
    const [b, cb] = RAIN_STOPS[i];
    if (dbz <= b) {
      const [a, ca] = RAIN_STOPS[i - 1];
      const f = (dbz - a) / (b - a);
      return ca.map((v, j) => Math.round(v + (cb[j] - v) * f));
    }
  }
  return RAIN_STOPS.at(-1)[1];
}

let tables = null;
// LUT: colore (5 bit per canale) → indice nella tabella UB, calcolata una volta sola.
function colorTables() {
  if (tables) return tables;
  const pal = UB.map((h, k) => ({
    dbz: DBZ0 + k,
    r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: parseInt(h.slice(6, 8), 16),
  }));
  const lut = new Uint8Array(32768);
  for (let r = 0; r < 32; r++) {
    for (let g = 0; g < 32; g++) {
      for (let b = 0; b < 32; b++) {
        const R = r * 8 + 4, G = g * 8 + 4, B = b * 8 + 4;
        let best = Infinity, k = 0;
        for (let i = 0; i < pal.length; i++) {
          const p = pal[i];
          const d = (p.r - R) ** 2 + (p.g - G) ** 2 + (p.b - B) ** 2;
          if (d < best) { best = d; k = i; }
        }
        lut[(r << 10) | (g << 5) | b] = k;
      }
    }
  }
  const out = pal.map((p) => paint(p.dbz));
  const alpha = pal.map((p) => p.a);
  tables = { lut, out, alpha };
  return tables;
}

// Ridipinge un'immagine radar: ogni pixel diventa il colore Isobara della sua intensità.
export function recolor(data) {
  const { lut, out, alpha } = colorTables();
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 6) { data[i + 3] = 0; continue; }
    const k = lut[((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3)];
    const c = out[k];
    // l'opacità originale conta solo come copertura del pixel (bordi sfumati)
    const cover = Math.min(1, a / alpha[k]);
    data[i] = c[0];
    data[i + 1] = c[1];
    data[i + 2] = c[2];
    data[i + 3] = c[3] * cover;
  }
  return data;
}

/* ------------------------------------------------------------------ */
/* Città sulla mappa                                                    */
/* ------------------------------------------------------------------ */

// [nome, lat, lon, importanza]: 1 sempre, 2 da vicino.
const CITIES = [
  ['Roma', 41.893, 12.483, 1], ['Milano', 45.464, 9.19, 1], ['Napoli', 40.852, 14.268, 1], ['Torino', 45.07, 7.686, 1],
  ['Palermo', 38.116, 13.362, 1], ['Genova', 44.405, 8.946, 1], ['Bologna', 44.494, 11.343, 1], ['Firenze', 43.77, 11.256, 1],
  ['Bari', 41.117, 16.872, 1], ['Venezia', 45.438, 12.335, 1], ['Cagliari', 39.224, 9.122, 1], ['Trieste', 45.65, 13.777, 1],
  ['Ancona', 43.616, 13.519, 1], ['Pescara', 42.465, 14.214, 1], ['Perugia', 43.112, 12.389, 1], ['Reggio Calabria', 38.111, 15.647, 1],
  ['Catania', 37.502, 15.087, 1], ['Trento', 46.07, 11.121, 1], ['Aosta', 45.737, 7.32, 1], ['Potenza', 40.64, 15.806, 1],
  ['Catanzaro', 38.91, 16.587, 1], ['Campobasso', 41.561, 14.668, 1], ["L'Aquila", 42.35, 13.399, 1],
  ['Nizza', 43.71, 7.262, 1], ['Marsiglia', 43.296, 5.37, 1], ['Zurigo', 47.377, 8.54, 1], ['Ginevra', 46.204, 6.143, 1],
  ['Lubiana', 46.056, 14.505, 1], ['Zagabria', 45.815, 15.982, 1], ['Monaco di Baviera', 48.137, 11.575, 1], ['Vienna', 48.208, 16.373, 1],
  ['Tunisi', 36.806, 10.181, 1], ['La Valletta', 35.899, 14.514, 1], ['Ajaccio', 41.919, 8.738, 1], ['Spalato', 43.508, 16.44, 1],
  ['Innsbruck', 47.269, 11.404, 1], ['Lione', 45.764, 4.836, 1],
  ['Verona', 45.438, 10.992, 2], ['Padova', 45.406, 11.877, 2], ['Brescia', 45.541, 10.212, 2], ['Bergamo', 45.698, 9.677, 2],
  ['Parma', 44.801, 10.328, 2], ['Modena', 44.647, 10.925, 2], ['Reggio Emilia', 44.698, 10.631, 2], ['Piacenza', 45.052, 9.693, 2],
  ['Ferrara', 44.838, 11.62, 2], ['Ravenna', 44.418, 12.204, 2], ['Rimini', 44.06, 12.566, 2], ['Forlì', 44.222, 12.041, 2],
  ['Cesena', 44.139, 12.243, 2], ['Pesaro', 43.91, 12.913, 2], ['Pisa', 43.716, 10.402, 2], ['Livorno', 43.548, 10.311, 2],
  ['Lucca', 43.844, 10.505, 2], ['Siena', 43.318, 11.331, 2], ['Arezzo', 43.463, 11.88, 2], ['Grosseto', 42.76, 11.113, 2],
  ['La Spezia', 44.102, 9.824, 2], ['Savona', 44.309, 8.477, 2], ['Sanremo', 43.818, 7.776, 2], ['Cuneo', 44.384, 7.543, 2],
  ['Alessandria', 44.913, 8.615, 2], ['Novara', 45.446, 8.622, 2], ['Como', 45.808, 9.085, 2], ['Varese', 45.82, 8.825, 2],
  ['Bolzano', 46.498, 11.354, 2], ['Udine', 46.063, 13.235, 2], ['Treviso', 45.666, 12.243, 2], ['Vicenza', 45.548, 11.546, 2],
  ['Mantova', 45.156, 10.791, 2], ['Cremona', 45.133, 10.022, 2], ['Pavia', 45.185, 9.158, 2], ['Belluno', 46.14, 12.217, 2],
  ['Pordenone', 45.956, 12.66, 2], ['Terni', 42.563, 12.643, 2], ['Viterbo', 42.417, 12.105, 2], ['Latina', 41.467, 12.904, 2],
  ['Frosinone', 41.64, 13.34, 2], ['Caserta', 41.074, 14.333, 2], ['Salerno', 40.683, 14.768, 2], ['Benevento', 41.13, 14.782, 2],
  ['Foggia', 41.462, 15.545, 2], ['Taranto', 40.464, 17.247, 2], ['Brindisi', 40.632, 17.936, 2], ['Lecce', 40.352, 18.174, 2],
  ['Matera', 40.667, 16.604, 2], ['Cosenza', 39.298, 16.254, 2], ['Crotone', 39.081, 17.127, 2], ['Messina', 38.193, 15.554, 2],
  ['Siracusa', 37.075, 15.287, 2], ['Ragusa', 36.926, 14.725, 2], ['Agrigento', 37.311, 13.576, 2], ['Trapani', 38.018, 12.514, 2],
  ['Sassari', 40.727, 8.56, 2], ['Olbia', 40.923, 9.498, 2], ['Nuoro', 40.321, 9.33, 2], ['Oristano', 39.904, 8.592, 2],
  ['Teramo', 42.659, 13.704, 2], ['Chieti', 42.351, 14.168, 2], ['Macerata', 43.3, 13.453, 2], ['Ascoli Piceno', 42.854, 13.575, 2],
  ['Rieti', 42.404, 12.857, 2], ['Lecco', 45.856, 9.398, 2], ['Sondrio', 46.17, 9.871, 2], ['Biella', 45.566, 8.054, 2],
  ['Asti', 44.9, 8.207, 2], ['Imperia', 43.889, 8.039, 2], ['Massa', 44.035, 10.14, 2], ['Prato', 43.88, 11.097, 2],
  ['Bastia', 42.697, 9.451, 2], ['Avellino', 40.915, 14.795, 2], ['Barletta', 41.32, 16.282, 2], ['Isernia', 41.594, 14.233, 2],
];

/* ------------------------------------------------------------------ */
/* Caricamento                                                          */
/* ------------------------------------------------------------------ */

let leaflet = null;
function loadLeaflet() {
  if (!document.querySelector('link[data-leaflet]')) {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'vendor/leaflet.css';
    css.dataset.leaflet = '';
    document.head.append(css);
  }
  if (window.L) return Promise.resolve(window.L);
  if (!leaflet) {
    leaflet = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/leaflet.js';
      s.onload = () => resolve(window.L);
      s.onerror = () => { leaflet = null; reject(new Error('Mappa non disponibile')); };
      document.head.append(s);
    });
  }
  return leaflet;
}

let geo = null;
async function loadMap() {
  if (geo) return geo;
  const data = await getJSON(MAP_URL, { timeout: 20000 });
  const w = data.world, r = data.regions;
  const wArcs = decodeArcs(w);
  geo = {
    land: topoFeatures(w, 'landmass', wArcs),
    borders: topoFeatures(w, 'borders', wArcs),
    regions: topoFeatures(r, 'regionlines'),
  };
  return geo;
}

/* ------------------------------------------------------------------ */
/* Mappa                                                                */
/* ------------------------------------------------------------------ */

const LINE = 'rgb(214, 228, 255)';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function radarLayer(L, url, options) {
  const Layer = L.GridLayer.extend({
    createTile(coords, done) {
      const size = this.getTileSize();
      const tile = document.createElement('canvas');
      tile.width = size.x;
      tile.height = size.y;
      const u = url.replace('{z}', coords.z).replace('{x}', coords.x).replace('{y}', coords.y);
      fetch(u)
        .then((res) => (res.ok ? res.blob() : null))
        .then((blob) => (blob ? createImageBitmap(blob) : null))
        .then((img) => {
          if (img) {
            const g = tile.getContext('2d', { willReadFrequently: true });
            g.drawImage(img, 0, 0, size.x, size.y);
            const im = g.getImageData(0, 0, size.x, size.y);
            recolor(im.data);
            g.putImageData(im, 0, 0);
          }
          done(null, tile);
        })
        .catch(() => done(null, tile));
      return tile;
    },
  });
  return new Layer(options);
}

// Etichette che non si sovrappongono: il luogo prima, poi le città più importanti.
function placeLabels(map, labels) {
  const taken = [];
  const z = map.getZoom();
  for (const l of labels) {
    const el = l.marker.getElement();
    if (!el) continue;
    if (l.rank > 1 && z < 7.75) { el.style.display = 'none'; continue; }
    const p = map.latLngToContainerPoint(l.marker.getLatLng());
    const w = l.width, h = 18;
    const box = [p.x - 6, p.y - h / 2, p.x + w, p.y + h / 2];
    const hit = taken.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]);
    el.style.display = hit ? 'none' : '';
    if (!hit) taken.push(box);
  }
}

// Crea il radar dentro `el`. onFrame(time, index, total) a ogni immagine.
export async function createRadar(el, place, { onFrame = () => {}, reduceMotion = false } = {}) {
  const [L, maps, g] = await Promise.all([loadLeaflet(), getJSON(FRAMES_URL, { timeout: 15000 }), loadMap()]);
  const frames = (maps?.radar?.past || []).slice(-13);
  if (!frames.length) throw new Error('Nessuna immagine radar');

  // La mappa disegnata copre il Mediterraneo centrale: per un luogo lontano niente limiti (solo radar).
  const inside = place.lat > 35 && place.lat < 49 && place.lon > -4 && place.lon < 24;
  const map = L.map(el, {
    zoomControl: false,
    attributionControl: false,
    minZoom: 5,
    maxZoom: 9,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    maxBounds: inside ? [[34.2, -5], [49.6, 25]] : null,
    maxBoundsViscosity: 0.85,
    renderer: L.canvas({ padding: 0.5 }),
  }).setView([place.lat, place.lon], 7);

  // Terra appena più chiara del mare, coste sottili, confini tratteggiati, regioni appena accennate.
  const style = (o) => ({ interactive: false, style: () => o });
  L.geoJSON(g.land, style({ stroke: true, color: LINE, opacity: 0.42, weight: 0.9, fill: true, fillColor: '#93a9ff', fillOpacity: 0.095 })).addTo(map);
  L.geoJSON(g.regions, style({ color: LINE, opacity: 0.14, weight: 0.7, fill: false })).addTo(map);
  L.geoJSON(g.borders, style({ color: LINE, opacity: 0.3, weight: 0.8, dashArray: '3 4', fill: false })).addTo(map);

  map.createPane('radar').style.zIndex = 450;
  map.createPane('labels').style.zIndex = 620;
  map.createPane('place').style.zIndex = 640;
  for (const p of ['labels', 'place']) map.getPane(p).style.pointerEvents = 'none';

  // Le immagini radar arrivano fino allo zoom 7: oltre vengono ingrandite (e restano morbide).
  const layers = frames.map((f) => radarLayer(L, `${maps.host}${f.path}/256/{z}/{x}/{y}/2/1_0.png`, {
    pane: 'radar', opacity: 0, maxNativeZoom: 7, maxZoom: 9, tileSize: 256, updateWhenZooming: false, keepBuffer: 1,
  }).addTo(map));

  const near = (a, b) => Math.abs(a.lat - b[1]) < 0.06 && Math.abs(a.lon - b[2]) < 0.08;
  const labels = CITIES.filter((c) => !near(place, c)).map(([name, lat, lon, rank]) => ({
    rank,
    width: 14 + name.length * (rank === 1 ? 7.4 : 6.6),
    marker: L.marker([lat, lon], {
      pane: 'labels', interactive: false, keyboard: false,
      icon: L.divIcon({ className: `r-city r${rank}`, html: `<i></i><span>${esc(name)}</span>`, iconSize: null }),
    }).addTo(map),
  }));
  L.marker([place.lat, place.lon], {
    pane: 'place', interactive: false, keyboard: false,
    icon: L.divIcon({ className: 'r-place', html: `<i class="halo"></i><i class="dot"></i><b>${esc(place.name)}</b>`, iconSize: null }),
  }).addTo(map);
  const relabel = () => placeLabels(map, labels);
  map.on('zoomend moveend', relabel);
  relabel();

  let i = frames.length - 1;
  let timer = null;
  const show = (k) => {
    layers[i].setOpacity(0);
    i = (k + frames.length) % frames.length;
    layers[i].setOpacity(1);
    onFrame(frames[i].time, i, frames.length);
  };
  show(i);

  const step = () => {
    show(i + 1);
    timer = setTimeout(step, i === frames.length - 1 ? 1800 : 520);
  };
  const api = {
    playing: false,
    // dall'ultima immagine riparte dalla prima dopo una breve pausa
    play() {
      if (api.playing) return;
      api.playing = true;
      timer = setTimeout(step, i === frames.length - 1 ? 1200 : 520);
    },
    pause() { api.playing = false; clearTimeout(timer); },
    seek(k) { api.pause(); show(k); },
    resize() { map.invalidateSize(); relabel(); },
    destroy() { api.pause(); map.remove(); },
    count: frames.length,
    times: frames.map((f) => f.time),
  };
  if (!reduceMotion) api.play();
  return api;
}
