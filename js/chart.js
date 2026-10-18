// La striscia delle prossime ore: icone, probabilità di pioggia e la curva della temperatura,
// con una fascia chiara che mostra quanto i modelli sono d'accordo.

import { isNum } from './engine.js';
import { makeFormatters, f0, pct, describe, amount } from './text.js';
import { iconBody } from './icons.js';
import { sunPosition } from './sky.js';

export const COL = 56;

// Curva morbida (Catmull-Rom → Bézier) che passa per tutti i punti.
function smooth(pts) {
  if (!pts.length) return '';
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

// La quantità si mostra quando è probabile e misurabile (almeno 0,1 mm o 0,2 cm).
export const showAmount = (h) => (h.pop >= 0.2 && h.precip >= 0.1) || h.precip >= 0.3 || (h.snow ?? 0) >= 0.2;

export function stripHours(result, count = 48) {
  const start = result.hours.findIndex((h) => h && h.t >= result.now - 3600);
  if (start < 0) return [];
  return result.hours.slice(start, start + count + 1).filter(Boolean);
}

export function hourStrip(result, bm, place, { selected = null } = {}) {
  const hs = stripHours(result);
  if (hs.length < 4) return null;
  const fmt = makeFormatters(result.tz);
  const W = hs.length * COL;
  const iconY = 26, popY = 70, amtY = 86, zoneTop = 94, zoneH = 96, H = 210;
  const x = (k) => k * COL + COL / 2;

  const lo = Math.min(...hs.map((h) => h.lo));
  const hi = Math.max(...hs.map((h) => h.hi));
  const span = Math.max(hi - lo, 4);
  const y = (v) => zoneTop + 24 + (1 - (v - lo) / span) * (zoneH - 34);

  const parts = [];
  if (selected != null && hs[selected]) {
    parts.push(`<rect class="st-sel" x="${selected * COL + 3}" y="2" width="${COL - 6}" height="${H - 4}" rx="18"/>`);
  }

  // Alba e tramonto
  const t0 = hs[0].t, tEnd = hs[hs.length - 1].t;
  const xt = (t) => ((t - t0) / 3600) * COL + COL / 2;
  if (bm?.daily) {
    const marks = [
      ...bm.daily.sunrise.map((t) => ({ t, word: 'alba' })),
      ...bm.daily.sunset.map((t) => ({ t, word: 'tramonto' })),
    ].filter((m) => m.t > t0 && m.t < tEnd);
    for (const m of marks) {
      const xm = xt(m.t);
      parts.push(`<line class="st-sun" x1="${xm.toFixed(1)}" x2="${xm.toFixed(1)}" y1="${zoneTop + 8}" y2="${H - 22}"/>`);
      parts.push(`<text class="st-sunlbl" x="${xm.toFixed(1)}" y="${H - 6}">${m.word} ${fmt.hm(m.t)}</text>`);
    }
  }

  // Fascia dei modelli e curva della previsione
  const upper = hs.map((h, k) => [x(k), y(h.hi)]);
  const lower = hs.map((h, k) => [x(k), y(h.lo)]).reverse();
  const band = `${smooth(upper)}L${lower[0][0]} ${lower[0][1].toFixed(1)}${smooth(lower).slice(1).replace(/^[^C]*/, '')}Z`;
  parts.push(`<path class="st-band" d="${band}"/>`);
  parts.push(`<path class="st-curve" d="${smooth(hs.map((h, k) => [x(k), y(h.temp)]))}"/>`);

  hs.forEach((h, k) => {
    const cx = x(k), cy = y(h.temp);
    const day = sunPosition(place.lat, place.lon, h.t * 1000).elevation > -0.8;
    parts.push(`<text class="st-time" x="${cx}" y="14">${k === 0 ? 'Ora' : fmt.hour(h.t)}</text>`);
    parts.push(`<svg class="wx" x="${cx - 14}" y="${iconY}" width="28" height="28" viewBox="0 0 24 24">${iconBody(h.code, day)}</svg>`);
    if (h.pop >= 0.2) parts.push(`<text class="st-pop" x="${cx}" y="${popY}">${pct(h.pop)}</text>`);
    // quanto cade in quell'ora: millimetri di pioggia o centimetri di neve
    if (showAmount(h)) {
      const q = amount(h.precip, h.snow);
      parts.push(`<text class="st-amt${q.snow ? ' snow' : ''}" x="${cx}" y="${amtY}">${q.text}</text>`);
    }
    parts.push(`<circle class="st-dot${k === selected ? ' on' : ''}" cx="${cx}" cy="${cy.toFixed(1)}" r="${k === selected ? 4.5 : 3}"/>`);
    parts.push(`<text class="st-temp" x="${cx}" y="${(cy - 11).toFixed(1)}">${f0(h.temp)}°</text>`);
  });

  const buttons = hs.map((h, k) => `<button type="button" class="st-hit" data-k="${k}" style="left:${k * COL}px" aria-label="${k === 0 ? 'Adesso' : `Ore ${fmt.hour(h.t)}`}: ${f0(h.temp)} gradi, ${describe(h.code).toLowerCase()}${h.pop >= 0.2 ? `, precipitazioni ${pct(h.pop)}` : ''}${showAmount(h) ? `, ${amount(h.precip, h.snow).text}` : ''}" aria-pressed="${k === selected}"></button>`).join('');

  const html = `<div class="st-track" style="width:${W}px;height:${H}px">
    <svg class="st-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">${parts.join('')}</svg>
    ${buttons}
  </div>`;
  return { html, hours: hs };
}

// Colore della temperatura per le barre dei giorni.
const STOPS = [[-5, [124, 170, 255]], [5, [126, 200, 255]], [12, [150, 230, 205]], [19, [255, 226, 130]], [26, [255, 170, 110]], [34, [255, 110, 100]]];
export function tempColor(t) {
  if (!isNum(t)) return 'rgb(255,255,255)';
  if (t <= STOPS[0][0]) return `rgb(${STOPS[0][1].join(',')})`;
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i];
      const f = (t - a) / (b - a);
      return `rgb(${ca.map((v, j) => Math.round(v + (cb[j] - v) * f)).join(',')})`;
    }
  }
  return `rgb(${STOPS[STOPS.length - 1][1].join(',')})`;
}
