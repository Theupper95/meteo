// Icone disegnate a tratto (viewBox 24×24), colori presi dal tema via CSS.

const CLOUD = 'M7 18.5h10.5a3.5 3.5 0 0 0 .3-6.99A5 5 0 0 0 8.1 10.3a4.1 4.1 0 0 0-1.1 8.2Z';

const rays = (cx, cy, r1, r2, skip = []) => {
  let d = '';
  for (let k = 0; k < 8; k++) {
    if (skip.includes(k)) continue;
    const a = (k * Math.PI) / 4;
    const x1 = cx + r1 * Math.cos(a), y1 = cy + r1 * Math.sin(a);
    const x2 = cx + r2 * Math.cos(a), y2 = cy + r2 * Math.sin(a);
    d += `M${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }
  return d;
};

const sun = (cx = 12, cy = 12, r = 4.2) =>
  `<g class="ic-sun"><circle cx="${cx}" cy="${cy}" r="${r}"/><path d="${rays(cx, cy, r + 2.3, r + 4.4)}"/></g>`;
const smallSun = () => `<g class="ic-sun"><circle cx="8.6" cy="8.4" r="3"/><path d="${rays(8.6, 8.4, 4.7, 6.4, [0, 1, 2])}"/></g>`;
const moon = (s = 1, tx = 0, ty = 0) =>
  `<path class="ic-moon" transform="translate(${tx} ${ty}) scale(${s})" d="M15.2 4.2a7.8 7.8 0 1 0 5.4 12.9 6.4 6.4 0 0 1-5.4-12.9Z"/>`;
const cloud = (tr = '') => `<path class="ic-cloud" ${tr ? `transform="${tr}"` : ''} d="${CLOUD}"/>`;
const up = 'translate(0 -2.6)';

const drops = (n, heavy) => {
  const xs = n === 2 ? [10, 14.5] : n === 3 ? [8.6, 12.6, 16.6] : [7.6, 10.8, 14, 17.2];
  const len = heavy ? 3.4 : 2.6;
  return `<path class="ic-drop" d="${xs.map((x) => `M${x} 18.3l-1 ${len}`).join('')}"/>`;
};
const dots = () => `<g class="ic-dropfill">${[8.6, 12.6, 16.6].map((x, k) => `<circle cx="${x}" cy="${k === 1 ? 20.6 : 19.6}" r="0.95"/>`).join('')}</g>`;
const flake = (x, y, r = 1.7) => {
  let d = '';
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI) / 3 + Math.PI / 2;
    d += `M${(x - r * Math.cos(a)).toFixed(2)} ${(y - r * Math.sin(a)).toFixed(2)}L${(x + r * Math.cos(a)).toFixed(2)} ${(y + r * Math.sin(a)).toFixed(2)}`;
  }
  return d;
};
const snow = () => `<path class="ic-snow" d="${flake(8.4, 20.2)}${flake(12.6, 21)}${flake(16.8, 20.2)}"/>`;
const bolt = () => `<path class="ic-bolt" d="M13.2 15.6 10.6 19.6h3.2l-2.1 3.6"/>`;

export function iconBody(code, isDay) {
  switch (code) {
    case 0:
      return isDay ? sun() : moon();
    case 1:
      return isDay ? `${sun()}` : moon();
    case 2:
      return `${isDay ? smallSun() : moon(0.62, -0.6, 0.4)}${cloud('translate(2.4 2.6) scale(0.88)')}`;
    case 3:
      return `${cloud('translate(5.2 -3.4) scale(0.72)')}${cloud('translate(0 1)')}`;
    case 45:
    case 48:
      return `<path class="ic-fog" d="M4 8.5h16M3 12.5h13.5M6.5 16.5h14.5M5 20.5h11"/>`;
    case 51: case 53: case 55: case 56: case 57:
      return `${cloud(up)}${dots()}`;
    case 61: case 66:
      return `${cloud(up)}${drops(2)}`;
    case 63:
      return `${cloud(up)}${drops(3)}`;
    case 65: case 67: case 82:
      return `${cloud(up)}${drops(4, true)}`;
    case 71: case 73: case 75: case 77: case 85: case 86:
      return `${cloud(up)}${snow()}`;
    case 80: case 81:
      return `${isDay ? smallSun() : moon(0.62, -0.6, 0.4)}${cloud('translate(2.4 0.2) scale(0.88)')}<path class="ic-drop" d="M11.2 19.4l-0.9 2.4M15.4 19.4l-0.9 2.4"/>`;
    case 95: case 96: case 99:
      return `${cloud(up)}${bolt()}`;
    default:
      return cloud();
  }
}

export function weatherIcon(code, isDay = true, size = 32, label = '') {
  const aria = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  return `<svg class="wx" width="${size}" height="${size}" viewBox="0 0 24 24" ${aria}>${iconBody(code, isDay)}</svg>`;
}

// Simbolo della copertura nuvolosa in ottavi (okta), come nelle carte meteorologiche.
export function oktaShape(cx, cy, r, cloudPct) {
  const o = Math.round(Math.min(100, Math.max(0, cloudPct)) / 12.5);
  let fill = '';
  if (o >= 8) fill = `<circle cx="${cx}" cy="${cy}" r="${r}" class="ok-fill"/>`;
  else if (o > 0) {
    const a = (o / 8) * 2 * Math.PI;
    const x = cx + r * Math.sin(a);
    const y = cy - r * Math.cos(a);
    fill = `<path class="ok-fill" d="M${cx} ${cy}V${(cy - r).toFixed(2)}A${r} ${r} 0 ${o > 4 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}Z"/>`;
  }
  return `${fill}<circle cx="${cx}" cy="${cy}" r="${r}" class="ok-ring"/>`;
}

export function okta(cloudPct, size = 16) {
  const r = size / 2 - 1.2;
  return `<svg class="okta" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">${oktaShape(size / 2, size / 2, r, cloudPct)}</svg>`;
}

// Freccia del vento: punta verso dove va l'aria (il vento "da SO" va verso NE).
export function windArrow(x, y, dirFrom, len = 6) {
  return `<g class="wind-arrow" transform="translate(${x} ${y}) rotate(${(dirFrom + 180) % 360})"><path d="M0 ${len}V${-len}M${-len * 0.5} ${-len * 0.45}L0 ${-len}L${len * 0.5} ${-len * 0.45}"/></g>`;
}

export const UI = {
  refresh: '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.2h-4.2"/></svg>',
  pin: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 21s-6.5-6.1-6.5-11a6.5 6.5 0 0 1 13 0c0 4.9-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.4"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>',
  close: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 3c.75 5.4 3.6 8.25 9 9-5.4.75-8.25 3.6-9 9-.75-5.4-3.6-8.25-9-9 5.4-.75 8.25-3.6 9-9Z"/></svg>',
  tabForecast: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M3 16c2.5 0 3-6 5.5-6s3 4 5.5 4 3-8 7-8"/><path d="M3 20h18" class="faint"/></svg>',
  tabClaude: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 17h-7l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5Z"/><path d="M8 10h8M8 13h5"/></svg>',
  tabVerify: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M4 20V10M9.3 20V5M14.6 20v-7M20 20V8"/></svg>',
  tabPlaces: '<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 21s-6.5-6.1-6.5-11a6.5 6.5 0 0 1 13 0c0 4.9-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.4"/></svg>',
  share: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 15V3.5M7.5 8 12 3.5 16.5 8M5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6.5"/></svg>',
  copy: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="8.5" y="8.5" width="11" height="11" rx="1.6"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/></svg>',
  arrowOut: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M14 4.5h5.5V10M19.5 4.5 11 13M10 6H6a1.5 1.5 0 0 0-1.5 1.5v10.5A1.5 1.5 0 0 0 6 19.5h10.5A1.5 1.5 0 0 0 18 18v-4"/></svg>',
};
