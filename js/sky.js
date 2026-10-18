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
// Temporale: più scuro e freddo della pioggia, con una punta di viola.
const STORM = P([
  [-12, '#030409', '#07090f', '#0d1019'],
  [-4, '#0a0d16', '#121725', '#1c2233'],
  [2, '#171b29', '#232838', '#33394c'],
  [12, '#212736', '#2e3546', '#424b5e'],
  [40, '#283040', '#36404f', '#4b5668'],
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

// Intensità da 0 a 1 dai mm all'ora: 0,2 mm/h appena qualche goccia, 2 mm/h moderata,
// 8 mm/h forte, oltre 15 mm/h un nubifragio.
export const intensity = (mmh) => clamp(Math.log1p(Math.max(0, mmh) * 1.6) / Math.log1p(24), 0, 1);

// Stato del cielo da mostrare per un'ora e un luogo. precip in mm/h, wind in km/h.
export function skyState({ lat, lon, time, cloud = 0, precip = 0, pop = 0, kind = null, wind = 0 }) {
  const sun = sunPosition(lat, lon, time);
  const el = sun.elevation;
  const c = clamp(cloud / 100, 0, 1);
  const inten = intensity(precip);
  const sure = clamp(pop * 1.4, 0, 1);
  let colors = mix3(at(CLEAR, el), at(OVERCAST, el), Math.pow(clamp((c - 0.15) / 0.8, 0, 1), 1.2) * 0.92);
  const wet = kind === 'rain' || kind === 'thunder' ? clamp(0.45 + inten * 0.7, 0, 1) * sure : 0;
  if (wet) colors = mix3(colors, at(RAIN, el), wet);
  const thunder = kind === 'thunder' ? clamp(0.45 + inten * 0.6, 0, 1) * sure : 0;
  if (thunder) colors = mix3(colors, at(STORM, el), 0.45 + 0.35 * thunder);
  const snowy = kind === 'snow' ? clamp(0.5 + inten * 0.6, 0, 1) : 0;
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
    // quanta pioggia o neve disegnare (0-1) e quanto la inclina il vento
    rain: wet ? clamp(0.08 + inten * 0.95, 0, 1) * clamp(0.35 + sure, 0, 1) : 0,
    snow: snowy ? clamp(0.12 + inten * 0.9, 0, 1) : 0,
    slant: clamp(0.06 + (wind || 0) / 75, 0.06, 0.55),
    thunder,
    fog: foggy,
    night: el < -4,
  };
}

/* ------------------------------------------------------------------ */
/* Disegno su canvas                                                    */
/* ------------------------------------------------------------------ */

let seed = 11;
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

// Un fulmine: una linea spezzata dall'alto verso il basso, con uno o due rami.
function makeBolt(W, H) {
  const pts = [];
  let x = W * (0.12 + Math.random() * 0.76);
  let y = -10;
  const bottom = H * (0.45 + Math.random() * 0.3);
  pts.push([x, y]);
  while (y < bottom) {
    y += 14 + Math.random() * 26;
    x += (Math.random() - 0.5) * 46;
    pts.push([x, y]);
  }
  const branches = [];
  const nb = Math.random() < 0.7 ? 1 + Math.round(Math.random()) : 0;
  for (let b = 0; b < nb; b++) {
    const k = Math.min(pts.length - 1, 2 + Math.floor(Math.random() * Math.max(1, pts.length - 4)));
    let [bx, by] = pts[k];
    const dir = Math.random() < 0.5 ? -1 : 1;
    const br = [[bx, by]];
    const steps = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < steps; i++) {
      by += 10 + Math.random() * 20;
      bx += dir * (8 + Math.random() * 22);
      br.push([bx, by]);
    }
    branches.push(br);
  }
  return { pts, branches };
}

export function createSky(canvas) {
  const ctx = canvas.getContext('2d');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  let W = 0, H = 0, dpr = 1;
  let cur = null, target = null, from = null, t0 = 0;
  let raf = 0, last = 0;
  const stars = Array.from({ length: 110 }, () => ({ x: rnd(), y: rnd() * 0.8, r: 0.5 + rnd() * 1.2, p: rnd() * 6.28, s: 0.6 + rnd() * 1.6 }));
  const clouds = Array.from({ length: 9 }, () => ({ x: rnd(), y: 0.05 + rnd() * 0.75, w: 0.7 + rnd() * 0.8, h: 0.12 + rnd() * 0.16, v: 0.004 + rnd() * 0.008, a: 0.5 + rnd() * 0.5 }));
  // profondità z: le gocce lontane sono corte, lente e tenui, quelle vicine lunghe, veloci e chiare
  const drops = Array.from({ length: 760 }, () => ({ x: rnd(), y: rnd(), z: rnd(), l: 0.8 + rnd() * 0.4, v: 0.9 + rnd() * 0.4 }));
  const flakes = Array.from({ length: 520 }, () => ({ x: rnd(), y: rnd(), z: rnd(), r: 0.7 + rnd() * 1.1, v: 0.8 + rnd() * 0.5, p: rnd() * 6.28 }));
  drops.sort((a, b) => a.z - b.z);
  flakes.sort((a, b) => a.z - b.z);
  let strike = null; // fulmine in corso
  let nextStrike = 0;

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
    slant: (a.slant ?? b.slant) + (b.slant - (a.slant ?? b.slant)) * t,
    thunder: (a.thunder || 0) + ((b.thunder || 0) - (a.thunder || 0)) * t,
    fog: a.fog + (b.fog - a.fog) * t,
  });

  // Lampo: sale in 40 ms e si spegne in circa un terzo di secondo; a volte un secondo guizzo.
  // Mai più di due lampi a evento e al massimo uno ogni due secondi e mezzo.
  const pulse = (t) => (t < 0 ? 0 : t < 40 ? t / 40 : Math.exp(-(t - 40) / 150));
  function lightning(now, s) {
    if (reduce.matches || s.thunder < 0.05) { strike = null; return 0; }
    if (!strike && now >= nextStrike) {
      strike = { t: now, double: Math.random() < 0.45, bolt: Math.random() < 0.85 ? makeBolt(W, H) : null };
      nextStrike = now + (2600 + Math.random() * 7000) / (0.55 + s.thunder);
    }
    if (!strike) return 0;
    const dt = now - strike.t;
    if (dt > 900) { strike = null; return 0; }
    return Math.max(pulse(dt), strike.double ? 0.75 * pulse(dt - 140) : 0) * s.thunder;
  }

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

    // Lampo: il cielo si illumina da dove cade il fulmine
    const flash = lightning(now, s);
    if (flash > 0.01) {
      const bx = strike?.bolt ? strike.bolt.pts[0][0] : W * 0.5;
      const fg = ctx.createRadialGradient(bx, H * 0.15, 0, bx, H * 0.15, Math.max(W, H) * 1.1);
      fg.addColorStop(0, `rgba(226,230,255,${(0.42 * flash).toFixed(3)})`);
      fg.addColorStop(0.5, `rgba(200,210,255,${(0.16 * flash).toFixed(3)})`);
      fg.addColorStop(1, 'rgba(200,210,255,0)');
      ctx.fillStyle = fg;
      ctx.fillRect(0, 0, W, H);
    }

    // Nuvole: grandi velature morbide che scorrono piano; nei lampi si accendono da sotto
    if (s.clouds > 0.01) {
      const n = Math.round(3 + s.clouds * 6);
      const base = s.night ? [150, 160, 180] : [255, 255, 255];
      for (let i = 0; i < n; i++) {
        const c = clouds[i];
        if (!reduce.matches) c.x = (c.x + c.v * dt / 1000 * (1 + s.thunder * 1.5)) % 1.6;
        const cx = (c.x - 0.3) * W * 1.25, cy = c.y * H;
        const rw = c.w * W, rh = c.h * H;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(1, rh / rw);
        const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, rw);
        const a = (s.night ? 0.06 : 0.13) * s.clouds * c.a + 0.22 * flash * c.a;
        rg.addColorStop(0, rgb(base, a));
        rg.addColorStop(1, rgb(base, 0));
        ctx.fillStyle = rg;
        ctx.fillRect(-rw, -rw, rw * 2, rw * 2);
        ctx.restore();
      }
    }

    // Fulmine
    if (flash > 0.02 && strike?.bolt) {
      const { pts, branches } = strike.bolt;
      const line = (list) => { ctx.moveTo(list[0][0], list[0][1]); for (let k = 1; k < list.length; k++) ctx.lineTo(list[k][0], list[k][1]); };
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(190,200,255,0.95)';
      ctx.shadowBlur = 22;
      ctx.strokeStyle = `rgba(236,240,255,${Math.min(1, flash * 2.4).toFixed(3)})`;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      line(pts);
      ctx.stroke();
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (const b of branches) line(b);
      ctx.stroke();
      ctx.restore();
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

    // Pioggia su tre piani: più è forte, più gocce, più lunghe, più veloci; il vento le inclina
    if (s.rain > 0.01) {
      const n = Math.round(24 + s.rain * (drops.length - 24));
      const len = 7 + s.rain * 30;
      const speed = 0.7 + s.rain * 1.1;
      const slant = s.slant ?? 0.18;
      const col = s.textDark ? [40, 60, 90] : [214, 228, 255];
      ctx.lineCap = 'round';
      const layers = [[0, 0.34, 0.45, 0.8], [0.34, 0.7, 0.75, 1.05], [0.7, 1.01, 1.1, 1.4]];
      for (const [z0, z1, depth, width] of layers) {
        ctx.strokeStyle = rgb(col, (0.1 + 0.26 * s.rain) * depth + 0.1 * flash);
        ctx.lineWidth = width * (0.9 + 0.4 * s.rain);
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const d = drops[i];
          if (d.z < z0 || d.z >= z1) continue;
          const v = d.v * speed * (0.6 + 0.6 * d.z);
          if (!reduce.matches) {
            d.y += v * dt / 1000;
            d.x -= slant * v * dt / 1000 * (H / W) * 0.9;
            if (d.y > 1.05) { d.y = -0.05 - rnd() * 0.1; d.x = rnd() * 1.2; }
            if (d.x < -0.1) d.x += 1.2;
          }
          const l = len * d.l * (0.55 + 0.7 * d.z);
          const x = d.x * W, y = d.y * H;
          ctx.moveTo(x, y);
          ctx.lineTo(x - l * slant, y + l);
        }
        ctx.stroke();
      }
      // con la pioggia forte, un velo di spruzzi vicino al suolo
      if (s.rain > 0.55) {
        const a = (s.rain - 0.55) * 0.22;
        const sg = ctx.createLinearGradient(0, H * 0.7, 0, H);
        sg.addColorStop(0, rgb(col, 0));
        sg.addColorStop(1, rgb(col, a));
        ctx.fillStyle = sg;
        ctx.fillRect(0, H * 0.7, W, H * 0.3);
      }
    }

    // Neve su tre piani: fiocchi più numerosi e grandi quando nevica forte, portati dal vento
    if (s.snow > 0.01) {
      const n = Math.round(30 + s.snow * (flakes.length - 30));
      const size = 0.8 + s.snow * 0.9;
      const slant = s.slant ?? 0.1;
      for (let i = 0; i < n; i++) {
        const f = flakes[i];
        const v = f.v * (0.03 + 0.05 * f.z) * (0.85 + 0.5 * s.snow);
        if (!reduce.matches) {
          f.y += v * dt / 1000;
          f.x -= slant * v * dt / 1000 * 0.8;
          if (f.y > 1.03) { f.y = -0.03; f.x = rnd() * 1.1; }
          if (f.x < -0.05) f.x += 1.1;
        }
        const x = (f.x + Math.sin(now / 1600 + f.p) * 0.012 * (0.5 + f.z)) * W;
        ctx.fillStyle = `rgba(255,255,255,${(0.35 + 0.55 * f.z).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, f.y * H, f.r * size * (0.55 + 0.75 * f.z), 0, 6.283);
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
    const moving = cur && (from || (!reduce.matches && (cur.rain > 0.01 || cur.snow > 0.01 || cur.stars > 0.01 || cur.clouds > 0.01 || cur.fog > 0.01 || cur.thunder > 0.01)));
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
      if (state.thunder > 0.05 && !nextStrike) nextStrike = performance.now() + 1200;
      draw(performance.now(), 0);
      kick();
    },
    // per le prove: un fulmine subito
    strikeNow() { nextStrike = 0; strike = null; },
  };
}
