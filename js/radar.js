// Radar: la pioggia vista dai radar nelle ultime due ore (RainViewer) su una mappa scura.
// La libreria della mappa (Leaflet) si carica solo quando si apre il radar.

import { getJSON } from './api.js';

const FRAMES_URL = 'https://api.rainviewer.com/public/weather-maps.json';
// Mappa standard di OpenStreetMap, scurita con un filtro CSS (classe osm-dark) perché la pioggia risalti.
const BASE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>, radar <a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>';

let leaflet = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!leaflet) {
    leaflet = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'vendor/leaflet.css';
      document.head.append(css);
      const s = document.createElement('script');
      s.src = 'vendor/leaflet.js';
      s.onload = () => resolve(window.L);
      s.onerror = () => { leaflet = null; reject(new Error('Mappa non disponibile')); };
      document.head.append(s);
    });
  }
  return leaflet;
}

// Crea il radar dentro `el`. onFrame(time, index, total) a ogni fotogramma.
export async function createRadar(el, place, { onFrame = () => {}, reduceMotion = false } = {}) {
  const [L, maps] = await Promise.all([loadLeaflet(), getJSON(FRAMES_URL, { timeout: 15000 })]);
  const frames = (maps?.radar?.past || []).slice(-13);
  if (!frames.length) throw new Error('Nessuna immagine radar');

  const map = L.map(el, {
    zoomControl: false,
    attributionControl: true,
    minZoom: 4,
    maxZoom: 10,
    zoomSnap: 0.5,
    worldCopyJump: true,
  }).setView([place.lat, place.lon], 7);
  map.attributionControl.setPrefix(false).addAttribution(ATTRIBUTION);
  L.tileLayer(BASE, { maxZoom: 19, className: 'osm-dark' }).addTo(map);

  // Un livello per fotogramma, tutti caricati subito: l'animazione cambia solo l'opacità.
  map.createPane('radar').style.zIndex = 350;
  const layers = frames.map((f) => L.tileLayer(`${maps.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`, {
    pane: 'radar', opacity: 0, maxNativeZoom: 7, maxZoom: 10, tileSize: 256,
  }).addTo(map));
  L.circleMarker([place.lat, place.lon], {
    radius: 6, weight: 2.5, color: '#ffffff', fillColor: '#0b1020', fillOpacity: 1, interactive: false,
  }).addTo(map);

  let i = frames.length - 1;
  let timer = null;
  const show = (k) => {
    layers[i].setOpacity(0);
    i = (k + frames.length) % frames.length;
    layers[i].setOpacity(0.8);
    onFrame(frames[i].time, i, frames.length);
  };
  show(i);

  const step = () => {
    show(i + 1);
    timer = setTimeout(step, i === frames.length - 1 ? 1600 : 450);
  };
  const api = {
    playing: false,
    // dall'ultima immagine riparte dalla prima dopo una breve pausa
    play() {
      if (api.playing) return;
      api.playing = true;
      timer = setTimeout(step, i === frames.length - 1 ? 1200 : 450);
    },
    pause() { api.playing = false; clearTimeout(timer); },
    seek(k) { api.pause(); show(k); },
    resize() { map.invalidateSize(); },
    destroy() { api.pause(); map.remove(); },
    count: frames.length,
  };
  if (!reduceMotion) api.play();
  return api;
}
