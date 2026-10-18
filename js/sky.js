// Il cielo di questo luogo a quest'ora: colori calcolati dall'altezza del sole,
// mescolati con nuvole, pioggia, neve e nebbia della previsione.

const RAD = Math.PI / 180;

// Posizione del sole (algoritmo NOAA semplificato, precisione ~1°).
export function sunPosition(lat, lon, ms) {
  const d = ms / 86400000 - 10957.5; // giorni da J2000.0
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (((18.697374558 + 24.06570982441908 * d) % 24) + 24) % 24;
  const ha = (gmst * 15 + lon) * RAD - ra;
  const phi = lat * RAD;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha));
  return { elevation: el / RAD, azimuth: ((az / RAD) + 360) % 360 };
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const P = (rows) => rows.map(([e, a, b, c]) => [e, [hex(a), hex(b), hex(c)]]);

// [elevazione del sole, colore allo zenit, a metà, all'orizzonte]
const CLEAR = P([
  [-18, '#04060d', '#080d1c', '#111a33'],
  [-12, '#060a1a', '#0e1630', '#1f2a4f'],
  [-6, '#10173a', '#2a2d5e', '#6b4a73'],
  [-2, '#1b2459', '#55437e', '#d97a6c'],
  [2, '#24367a', '#8a5c8e', '#f39a5f'],
  [6, '#2a4f9c', '#6d82c0', '#f2c08a'],
  [15, '#2a5fb6', '#4f86d3', '#a9c8ea'],
  [35, '#1e57b8', '#3a79d0', '#8fbbe9'],
  [60, '#1550b5', '#2f6fcb', '#80b2e8'],
]);
const OVERCAST = P([
  [-12, '#07080b', '#0d0f14', '#171a21'],
  [-4, '#181b23', '#252933', '#363b47'],
  [2, '#3a3f4c', '#4f5462', '#6b6f7b'],
  [12, '#4c5664', '#626c7a', '#7f8895'],
  [40, '#566271', '#6c7886', '#8a95a1'],
]);
const RAIN = P([
  [-12, '#05070b', '#0a0e15', '#121821'],
  [-4, '#11161f', '#1b222e', '#28303e'],
  [2, '#262d3a', '#343c4b', '#475061'],
  [12, '#333d4b', '#44505f', '#5b6676'],
  [40, '#3b4656', '#4c5868', '#64707f'],
]);
const SNOW = P([
  [-12, '#12161f', '#1c2230', '#2a3242'],
  [-2, '#3b4352', '#4e5768', '#68717f'],
  [12, '#8d99a8', '#a4afbc', '#c3cbd4'],
]);
const FOG = P([
  [-12, '#15181d', '#1d2127', '#262a31'],
  [-2, '#4b5058', '#5c6169', '#70757c'],
  [12, '#a7afb6', '#b9c0c6', '#c8cdd2'],
]);

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const mix3 = (A, B, t) => A.map((c, i) => mix(c, B[i], t));
function at(palette, el) {
  if (el <= palette[0][0]) return palette[0][1];
  for (let i = 1; i < palette.length; i++) {
    if (el <= palette[i][0]) {
      const [e0, c0] = palette[i - 1];
      const [e1, c1] = palette[i];
      return mix3(c0, c1, (el - e0) / (e1 - e0));
    }
  }
  return palette[palette.length - 1][1];
}
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const rgb = ([r, g, b], a = 1) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
export const toHex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

// Stato del cielo da mostrare per un'ora e un luogo.
export function skyState({ lat, lon, time, cloud = 0, precip = 0, pop = 0, kind = null }) {
  const sun = sunPosition(lat, lon, time);
  const el = sun.elevation;
  const c = clamp(cloud / 100, 0, 1);
  let colors = mix3(at(CLEAR, el), at(OVERCAST, el), Math.pow(clamp((c - 0.15) / 0.8, 0, 1), 1.2) * 0.92);
  const wet = kind === 'rain' || kind === 'thunder' ? clamp(0.45 + precip / 3, 0, 1) * clamp(pop * 1.4, 0, 1) : 0;
  if (wet) colors = mix3(colors, at(RAIN, el), wet);
  const snowy = kind === 'snow' ? clamp(0.5 + precip / 2, 0, 1) : 0;
  if (snowy) colors = mix3(colors, at(SNOW, el), snowy);
  const foggy = kind === 'fog' ? 0.85 : 0;
  if (foggy) colors = mix3(colors, at(FOG, el), foggy);

  // Testo chiaro o scuro, a seconda di quanto è luminoso il cielo
  const L = luminance(colors[1]);
  const textDark = 1.05 / (L + 0.05) < 3.6;
  return {
    colors,
    textDark,
    sun: { el, az: sun.azimuth, glow: el > -5 ? clamp(1 - c * 1.1, 0, 1) * clamp((el + 5) / 8, 0, 1) : 0 },
    stars: el < -6 ? clamp((-6 - el) / 8, 0, 1) * Math.pow(1 - c, 1.5) : 0,
    clouds: clamp((c - 0.1) / 0.9, 0, 1),
    rain: wet ? clamp(0.25 + precip / 4, 0, 1) : 0,
    snow: snowy ? clamp(0.3 + precip / 3, 0, 1) : 0,
    fog: foggy,
    night: el < -4,
  };
}

/* ------------------------------------------------------------------ */
/* Disegno su canvas                                                    */
/* ------------------------------------------------------------------ */

let seed = 11;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

export function createSky(canvas) {
  const ctx = canvas.getContext('2d');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  let W = 0, H = 0, dpr = 1;
  let cur = null, target = null, from = null, t0 = 0;
  let raf = 0, last = 0;
  const stars = Array.from({ length: 110 }, () => ({ x: rnd(), y: rnd() * 0.8, r: 0.5 + rnd() * 1.2, p: rnd() * 6.28, s: 0.6 + rnd() * 1.6 }));
  const clouds = Array.from({ length: 9 }, () => ({ x: rnd(), y: 0.05 + rnd() * 0.75, w: 0.7 + rnd() * 0.8, h: 0.12 + rnd() * 0.16, v: 0.004 + rnd() * 0.008, a: 0.5 + rnd() * 0.5 }));
  const drops = Array.from({ length: 320 }, () => ({ x: rnd(), y: rnd(), l: 12 + rnd() * 14, v: 0.9 + rnd() * 0.5 }));
  const flakes = Array.from({ length: 220 }, () => ({ x: rnd(), y: rnd(), r: 0.8 + rnd() * 1.9, v: 0.035 + rnd() * 0.05, p: rnd() * 6.28 }));

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(performance.now(), 0);
  }

  const lerpState = (a, b, t) => ({
    ...b,
    colors: mix3(a.colors, b.colors, t),
    sun: { ...b.sun, glow: a.sun.glow + (b.sun.glow - a.sun.glow) * t, el: b.sun.el },
    stars: a.stars + (b.stars - a.stars) * t,
    clouds: a.clouds + (b.clouds - a.clouds) * t,
    rain: a.rain + (b.rain - a.rain) * t,
    snow: a.snow + (b.snow - a.snow) * t,
    fog: a.fog + (b.fog - a.fog) * t,
  });

  function draw(now, dt) {
    if (!cur || !W) return;
    if (target && from) {
      const k = reduce.matches ? 1 : clamp((now - t0) / 900, 0, 1);
      const e = 1 - Math.pow(1 - k, 3);
      cur = lerpState(from, target, e);
      if (k >= 1) from = null;
    }
    const s = cur;
    const [top, mid, low] = s.colors;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, rgb(top));
    g.addColorStop(0.55, rgb(mid));
    g.addColorStop(1, rgb(low));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Sole: un alone caldo, più basso e arancione quando tramonta
    if (s.sun.glow > 0.01) {
      const az = s.sun.az;
      const x = W * clamp(0.5 + Math.sin(az * RAD) * -0.42, 0.08, 0.92);
      const y = H * clamp(1.02 - Math.max(s.sun.el, -3) / 70, 0.25, 1.08);
      const warm = clamp(1 - s.sun.el / 18, 0, 1);
      const col = mix([255, 244, 214], [255, 160, 92], warm);
      const r = Math.max(W, H) * (0.55 + 0.25 * warm);
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, rgb(col, 0.42 * s.sun.glow));
      rg.addColorStop(0.35, rgb(col, 0.14 * s.sun.glow));
      rg.addColorStop(1, rgb(col, 0));
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
    }

    // Stelle
    if (s.stars > 0.01) {
      for (const st of stars) {
        const tw = reduce.matches ? 0.8 : 0.55 + 0.45 * Math.sin(now / 1000 * st.s + st.p);
        ctx.fillStyle = `rgba(255,255,255,${(0.75 * s.stars * tw).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(st.x * W, st.y * H, st.r, 0, 6.283);
        ctx.fill();
      }
    }

    // Nuvole: grandi velature morbide che scorrono piano
    if (s.clouds > 0.01) {
      const n = Math.round(3 + s.clouds * 6);
      const base = s.night ? [150, 160, 180] : [255, 255, 255];
      for (let i = 0; i < n; i++) {
        const c = clouds[i];
        if (!reduce.matches) c.x = (c.x + c.v * dt / 1000) % 1.6;
        const cx = (c.x - 0.3) * W * 1.25, cy = c.y * H;
        const rw = c.w * W, rh = c.h * H;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(1, rh / rw);
        const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, rw);
        const a = (s.night ? 0.06 : 0.13) * s.clouds * c.a;
        rg.addColorStop(0, rgb(base, a));
        rg.addColorStop(1, rgb(base, 0));
        ctx.fillStyle = rg;
        ctx.fillRect(-rw, -rw, rw * 2, rw * 2);
        ctx.restore();
      }
    }

    // Nebbia: banchi orizzontali
    if (s.fog > 0.01) {
      for (let i = 0; i < 3; i++) {
        const y = H * (0.35 + i * 0.22) + Math.sin(now / 7000 + i) * 18;
        const lg = ctx.createLinearGradient(0, y - 90, 0, y + 90);
        lg.addColorStop(0, 'rgba(255,255,255,0)');
        lg.addColorStop(0.5, `rgba(255,255,255,${(0.16 * s.fog).toFixed(3)})`);
        lg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = lg;
        ctx.fillRect(0, y - 90, W, 180);
      }
    }

    // Pioggia
    if (s.rain > 0.01) {
      const n = Math.round(60 + s.rain * 260);
      ctx.strokeStyle = s.textDark ? 'rgba(40,60,90,0.35)' : 'rgba(210,225,255,0.32)';
      ctx.lineWidth = 1.1;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const d = drops[i];
        if (!reduce.matches) { d.y += d.v * dt / 1000; if (d.y > 1.05) { d.y = -0.05; d.x = rnd(); } }
        const x = d.x * W, y = d.y * H;
        ctx.moveTo(x, y);
        ctx.lineTo(x - d.l * 0.18, y + d.l);
      }
      ctx.stroke();
    }

    // Neve
    if (s.snow > 0.01) {
      const n = Math.round(60 + s.snow * 160);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      for (let i = 0; i < n; i++) {
        const f = flakes[i];
        if (!reduce.matches) { f.y += f.v * dt / 1000; if (f.y > 1.03) { f.y = -0.03; f.x = rnd(); } }
        const x = (f.x + Math.sin(now / 1600 + f.p) * 0.012) * W;
        ctx.beginPath();
        ctx.arc(x, f.y * H, f.r, 0, 6.283);
        ctx.fill();
      }
    }
  }

  function loop(now) {
    const dt = last ? Math.min(100, now - last) : 16;
    if (now - last >= 30 || !last) {
      draw(now, dt);
      last = now;
    }
    const moving = cur && (from || (!reduce.matches && (cur.rain > 0.01 || cur.snow > 0.01 || cur.stars > 0.01 || cur.clouds > 0.01 || cur.fog > 0.01)));
    raf = moving ? requestAnimationFrame(loop) : 0;
  }
  const kick = () => { if (!raf && document.visibilityState === 'visible') { last = 0; raf = requestAnimationFrame(loop); } };

  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') kick();
    else if (raf) { cancelAnimationFrame(raf); raf = 0; }
  });
  resize();

  return {
    set(state, { instant = false } = {}) {
      if (!cur || instant) { cur = state; target = state; from = null; }
      else { from = cur; target = state; t0 = performance.now(); }
      draw(performance.now(), 0);
      kick();
    },
  };
}
