/* ============================================================================
   NEON DRIFT 1017  —  a hand-written pseudo-3D racer
   No engines, no libraries, no image assets. Every pixel is drawn here.
   ========================================================================== */
(() => {
'use strict';

/* ---------------------------------------------------------------- utils - */
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const easeIn = (a, b, p) => a + (b - a) * p * p;
const easeOut = (a, b, p) => a + (b - a) * (1 - (1 - p) * (1 - p));
const easeInOut = (a, b, p) => a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5);
const smooth = (p) => p * p * (3 - 2 * p);
const TAU = Math.PI * 2;
const fmt = (t) => {
  if (!isFinite(t) || t <= 0) return '--:--.--';
  const m = Math.floor(t / 60), s = Math.floor(t % 60), c = Math.floor((t * 100) % 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
};
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rgb = (c, a) => a === undefined ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`
  : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
function rr(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function poly(g, pts) {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
}

/* --------------------------------------------------------------- config - */
const SEG = 200;              // segment length (world units)
const ROAD_W = 2000;          // half road width
const LANES = 3;
const CAM_H = 1150;
const FOV = 100;
const DRAW = 300;
const MAX_SPEED = 13200;
const KMH = 330;
const TOTAL_LAPS = 3;
const AI_COUNT = 5;
const CEN = 0.235;            // centrifugal force
const STEER = 2.15;           // steering rate

const LEN = { none: 0, short: 16, med: 32, long: 64 };
const CRV = { none: 0, easy: 2, med: 4, hard: 6 };
const HIL = { none: 0, low: 20, med: 40, high: 60 };

const COL = {
  horizon: [255, 74, 112],
  fog: [96, 26, 62],
  grassA: [27, 7, 46],
  grassB: [20, 5, 36],
  road: [16, 14, 26],
  roadB: [21, 18, 33],
  rumbleA: [255, 42, 133],
  rumbleB: [0, 224, 255],
  lane: [236, 226, 255],
  edge: [0, 235, 255],
};

/* ----------------------------------------------------------------- dom - */
const stage = $('stage');
const canvas = $('scene');
const ctx = canvas.getContext('2d', { alpha: false });
const gaugeCv = $('gauge');
const gaugeCtx = gaugeCv.getContext('2d');
const mapCv = $('minimap');
const mapCtx = mapCv.getContext('2d');

let W = 0, H = 0, DPR = 1, horizonY = 0;
let camDepth = 1 / Math.tan((FOV / 2) * Math.PI / 180);
let playerZ = CAM_H * camDepth;

/* ================================================================ TRACK = */
let segments = [];
let trackLength = 0;

function lastY() { return segments.length ? segments[segments.length - 1].p2.world.y : 0; }

function addSegment(curve, y) {
  const n = segments.length;
  const y1 = lastY();
  segments.push({
    index: n, curve, finish: false,
    p1: { world: { x: 0, y: y1, z: n * SEG }, camZ: 0, scale: 0, sx: 0, sy: 0, sw: 0 },
    p2: { world: { x: 0, y, z: (n + 1) * SEG }, camZ: 0, scale: 0, sx: 0, sy: 0, sw: 0 },
    sprites: [], cars: [], clip: 0, fog: 0, visible: false, looped: false,
  });
}

function addRoad(enter, hold, leave, curve, height) {
  const startY = lastY();
  const endY = startY + height * SEG;
  const total = enter + hold + leave;
  let n;
  for (n = 0; n < enter; n++) addSegment(easeIn(0, curve, n / enter), easeInOut(startY, endY, n / total));
  for (n = 0; n < hold; n++) addSegment(curve, easeInOut(startY, endY, (enter + n) / total));
  for (n = 0; n < leave; n++) addSegment(easeInOut(curve, 0, n / leave), easeInOut(startY, endY, (enter + hold + n) / total));
}

const addStraight = (n = LEN.med) => addRoad(n, n, n, 0, 0);
const addCurve = (n, curve, height) => addRoad(n, n, n, curve, height || 0);
const addHill = (n, height) => addRoad(n, n, n, 0, height);
const addSCurves = () => {
  addRoad(LEN.med, LEN.med, LEN.med, -CRV.easy, HIL.none);
  addRoad(LEN.med, LEN.med, LEN.med, CRV.med, HIL.med);
  addRoad(LEN.med, LEN.med, LEN.med, CRV.easy, -HIL.low);
  addRoad(LEN.med, LEN.med, LEN.med, -CRV.easy, HIL.med);
  addRoad(LEN.med, LEN.med, LEN.med, -CRV.med, -HIL.med);
};
const addBumps = () => {
  addRoad(10, 10, 10, 0, 5);
  addRoad(10, 10, 10, 0, -2);
  addRoad(10, 10, 10, 0, -5);
  addRoad(10, 10, 10, 0, 8);
  addRoad(10, 10, 10, 0, 5);
  addRoad(10, 10, 10, 0, -7);
  addRoad(10, 10, 10, 0, 5);
  addRoad(10, 10, 10, 0, -2);
};
const addLowRollingHills = (n = LEN.short, h = HIL.low / 2) => {
  addRoad(n, n, n, 0, h); addRoad(n, n, n, 0, -h);
  addRoad(n, n, n, CRV.easy, h); addRoad(n, n, n, 0, 0);
  addRoad(n, n, n, -CRV.easy, h / 2); addRoad(n, n, n, 0, -h);
};

function buildTrack() {
  segments = [];
  addStraight(LEN.med);
  addLowRollingHills();
  addSCurves();
  addCurve(LEN.med, CRV.med, HIL.low);
  addBumps();
  addLowRollingHills();
  addCurve(LEN.long, -CRV.med, HIL.med);
  addStraight(LEN.short);
  addHill(LEN.med, HIL.high);
  addSCurves();
  addCurve(LEN.long, CRV.hard, -HIL.low);
  addStraight(LEN.short);
  addHill(LEN.long, -HIL.med);
  addSCurves();
  addCurve(LEN.long, -CRV.hard, HIL.low);
  addBumps();
  addStraight(LEN.med);
  addCurve(LEN.med, CRV.easy, HIL.none);
  addStraight(LEN.short);
  // bring the loop back to y=0 so the seam is invisible
  addRoad(LEN.med, LEN.med, LEN.med, 0, -lastY() / SEG);
  trackLength = segments.length * SEG;
  for (let i = 0; i < 3; i++) segments[i].finish = true;
}

/* ------------------------------------------------------- sprite builders - */
function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function spriteOf(w, h, draw) { const c = cv(w, h); draw(c.getContext('2d'), w, h); return c; }

function palmSprite() {
  return spriteOf(220, 400, (g, w, h) => {
    const cx = w * 0.50, base = h, topY = h * 0.30;
    // trunk — tapered and slightly curved
    g.beginPath();
    g.moveTo(cx - 14, base);
    g.quadraticCurveTo(cx - 3, h * 0.60, cx - 24, topY);
    g.lineTo(cx - 13, topY - 6);
    g.quadraticCurveTo(cx + 7, h * 0.60, cx + 14, base);
    g.closePath();
    const tg = g.createLinearGradient(0, base, 0, topY);
    tg.addColorStop(0, '#08030f'); tg.addColorStop(1, '#31154a');
    g.fillStyle = tg; g.fill();
    g.strokeStyle = 'rgba(255,90,170,.18)'; g.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const y = base - (base - topY) * (i / 8);
      g.beginPath(); g.moveTo(cx - 12 + i * 1.5, y); g.lineTo(cx + 12 - i * 1.5, y + 3); g.stroke();
    }
    // crown
    g.save();
    g.translate(cx - 18, topY);
    const L = w * 0.47;
    g.shadowColor = 'rgba(255,60,150,.40)'; g.shadowBlur = 16;
    for (let i = 0; i < 11; i++) {
      const a = -Math.PI * 0.92 + (i / 10) * Math.PI * 0.84;
      const len = L * (0.74 + ((i * 53) % 11) / 24);
      const dx = Math.cos(a), dy = Math.sin(a);
      const ex = dx * len, ey = dy * len * 0.8 + len * 0.34;
      const mx = dx * len * 0.52, my = dy * len * 0.52 - len * 0.13;
      const wid = len * 0.15;
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(mx, my - wid, ex, ey);
      g.quadraticCurveTo(mx, my + wid, 0, 0);
      const grd = g.createLinearGradient(0, 0, ex, ey);
      grd.addColorStop(0, '#3d1860'); grd.addColorStop(0.65, '#260d3e'); grd.addColorStop(1, '#140622');
      g.fillStyle = grd; g.fill();
      g.strokeStyle = 'rgba(255,80,170,.30)'; g.lineWidth = 1.2; g.stroke();
    }
    g.restore();
    // coconut cluster
    g.fillStyle = '#0d0419';
    for (let i = 0; i < 3; i++) {
      g.beginPath(); g.arc(cx - 26 + i * 8, topY + 9 + (i % 2) * 5, 5, 0, TAU); g.fill();
    }
  });
}

function pylonSprite() {
  return spriteOf(140, 400, (g, w, h) => {
    const cx = w / 2, top = h * 0.14, base = h - 8;
    // post
    const pg = g.createLinearGradient(cx - 8, 0, cx + 8, 0);
    pg.addColorStop(0, '#05020c'); pg.addColorStop(0.45, '#2a1240'); pg.addColorStop(1, '#05020c');
    g.fillStyle = pg;
    g.fillRect(cx - 7, top + 24, 14, base - top - 24);
    // neon strip
    g.save();
    g.shadowColor = 'rgba(0,229,255,.9)'; g.shadowBlur = 18;
    const ng = g.createLinearGradient(0, top + 30, 0, base);
    ng.addColorStop(0, '#9ff8ff'); ng.addColorStop(0.55, '#00e5ff'); ng.addColorStop(1, '#ff2e88');
    g.fillStyle = ng;
    g.fillRect(cx - 2, top + 30, 4, base - top - 36);
    g.restore();
    // halo
    g.save();
    g.globalCompositeOperation = 'lighter';
    const glow = g.createRadialGradient(cx, top + 14, 2, cx, top + 14, 58);
    glow.addColorStop(0, 'rgba(255,130,200,.55)');
    glow.addColorStop(1, 'rgba(255,46,136,0)');
    g.fillStyle = glow; g.beginPath(); g.arc(cx, top + 14, 58, 0, TAU); g.fill();
    g.restore();
    // ring
    g.save();
    g.shadowColor = 'rgba(255,46,136,.95)'; g.shadowBlur = 26;
    g.strokeStyle = '#ffe4f2'; g.lineWidth = 5;
    g.beginPath(); g.arc(cx, top + 14, 19, 0, TAU); g.stroke();
    g.restore();
    // plinth
    g.fillStyle = '#0a0417';
    g.fillRect(cx - 17, base, 34, 8);
  });
}

function billboardSprite(text, c1, c2) {
  return spriteOf(420, 260, (g, w, h) => {
    // posts
    g.fillStyle = '#0a0416';
    g.fillRect(w * 0.22, h * 0.62, 12, h * 0.38);
    g.fillRect(w * 0.76, h * 0.62, 12, h * 0.38);
    // frame
    g.save();
    g.shadowColor = c1; g.shadowBlur = 38;
    g.strokeStyle = c1; g.lineWidth = 5;
    rr(g, w * 0.06, h * 0.06, w * 0.88, h * 0.62, 8); g.stroke();
    g.restore();
    const grd = g.createLinearGradient(0, 0, w, h);
    grd.addColorStop(0, 'rgba(12,2,26,.96)'); grd.addColorStop(1, 'rgba(30,4,40,.96)');
    g.fillStyle = grd; rr(g, w * 0.06, h * 0.06, w * 0.88, h * 0.62, 8); g.fill();
    // tubes
    g.save();
    g.shadowColor = c2; g.shadowBlur = 22; g.strokeStyle = c2; g.lineWidth = 3;
    g.beginPath(); g.moveTo(w * 0.1, h * 0.60); g.lineTo(w * 0.9, h * 0.60); g.stroke();
    g.restore();
    // text
    g.save();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = c1; g.shadowBlur = 30;
    g.fillStyle = '#fff';
    g.font = `900 ${text.length > 9 ? 46 : 58}px Orbitron, Bahnschrift, sans-serif`;
    g.fillText(text, w / 2, h * 0.34);
    g.globalAlpha = .8; g.fillStyle = c2; g.font = '700 16px Rajdhani, sans-serif';
    g.fillText('NEON DRIFT SERIES', w / 2, h * 0.52);
    g.restore();
  });
}

function archSprite(label) {
  return spriteOf(1000, 460, (g, w, h) => {
    const pw = 54;
    g.save();
    g.shadowColor = 'rgba(255,46,136,.75)'; g.shadowBlur = 40;
    g.fillStyle = '#12061f';
    g.fillRect(0, h * 0.18, pw, h * 0.82);
    g.fillRect(w - pw, h * 0.18, pw, h * 0.82);
    g.fillStyle = '#12061f';
    rr(g, 0, h * 0.06, w, h * 0.22, 14); g.fill();
    g.restore();
    // neon tubes
    g.save();
    g.shadowColor = 'rgba(0,229,255,.9)'; g.shadowBlur = 26;
    g.strokeStyle = '#7ff6ff'; g.lineWidth = 6;
    g.beginPath(); g.moveTo(pw + 10, h * 0.235); g.lineTo(w - pw - 10, h * 0.235); g.stroke();
    g.strokeStyle = 'rgba(255,46,136,.9)';
    g.beginPath(); g.moveTo(pw + 10, h * 0.10); g.lineTo(w - pw - 10, h * 0.10); g.stroke();
    g.beginPath(); g.moveTo(pw * 0.5, h * 0.30); g.lineTo(pw * 0.5, h); g.stroke();
    g.beginPath(); g.moveTo(w - pw * 0.5, h * 0.30); g.lineTo(w - pw * 0.5, h); g.stroke();
    g.restore();
    g.save();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 74px Orbitron, Bahnschrift, sans-serif';
    g.fillStyle = '#fff';
    g.shadowColor = 'rgba(0,229,255,.95)'; g.shadowBlur = 36;
    g.fillText(label, w / 2, h * 0.05);
    g.restore();
  });
}

function chevronSprite(dir) {
  return spriteOf(200, 220, (g, w, h) => {
    g.save();
    g.translate(w / 2, h / 2);
    g.shadowColor = 'rgba(255,209,102,.9)'; g.shadowBlur = 26;
    g.fillStyle = '#0f0520';
    rr(g, -w * 0.34, -h * 0.44, w * 0.68, h * 0.88, 10); g.fill();
    g.strokeStyle = '#ffd166'; g.lineWidth = 4;
    for (let i = 0; i < 3; i++) {
      g.beginPath();
      const x = -18 + i * 18;
      g.moveTo(x + dir * 14, -26); g.lineTo(x - dir * 6, 0); g.lineTo(x + dir * 14, 26); g.stroke();
    }
    g.restore();
  });
}

/* ------------------------------------------------------------ car art - */
function carArt(g, w, h, pal, opt) {
  opt = opt || {};
  const cx = w / 2, base = h - h * 0.03;
  const X = (v) => cx + v * w, Y = (v) => base + v * h;
  const paint = pal.paint, acc = pal.accent;

  // ground shadow
  const sg = g.createRadialGradient(cx, base, 2, cx, base, w * 0.5);
  sg.addColorStop(0, 'rgba(0,0,0,.85)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
  g.save(); g.translate(cx, base); g.scale(1, 0.13); g.translate(-cx, -base);
  g.fillStyle = sg; g.beginPath(); g.arc(cx, base, w * 0.52, 0, TAU); g.fill(); g.restore();

  // underglow
  g.save(); g.globalCompositeOperation = 'lighter';
  const ug = g.createRadialGradient(cx, base - h * 0.06, 1, cx, base - h * 0.06, w * 0.5);
  ug.addColorStop(0, `rgba(${hex2(acc)},.55)`); ug.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = ug; g.beginPath(); g.ellipse(cx, base - h * 0.05, w * 0.5, h * 0.16, 0, 0, TAU); g.fill();
  g.restore();

  // wheels
  const ww = w * 0.155;
  for (const s of [-1, 1]) {
    const wx = X(s * 0.435);
    const grd = g.createLinearGradient(0, Y(-0.47), 0, Y(0));
    grd.addColorStop(0, '#1b1728'); grd.addColorStop(0.55, '#0c0a15'); grd.addColorStop(1, '#040308');
    g.fillStyle = grd;
    rr(g, wx - ww / 2, Y(-0.50), ww, h * 0.50, ww * 0.20); g.fill();
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.strokeStyle = `rgba(${hex2(acc)},.85)`; g.lineWidth = Math.max(1.2, w * 0.006);
    g.shadowColor = `rgba(${hex2(acc)},1)`; g.shadowBlur = w * 0.018;
    g.beginPath(); g.ellipse(wx, Y(-0.16), ww * 0.30, h * 0.10, 0, 0, TAU); g.stroke();
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,.09)'; g.lineWidth = Math.max(1, w * 0.005);
    g.beginPath(); g.moveTo(wx - ww * 0.30, Y(-0.44)); g.lineTo(wx - ww * 0.30, Y(-0.02)); g.stroke();
  }

  // main body silhouette
  const bodyGrad = g.createLinearGradient(0, Y(-0.80), 0, Y(0));
  bodyGrad.addColorStop(0, shade(paint, 1.72));
  bodyGrad.addColorStop(0.28, shade(paint, 1.22));
  bodyGrad.addColorStop(0.62, shade(paint, 0.86));
  bodyGrad.addColorStop(1, shade(paint, 0.40));
  g.fillStyle = bodyGrad;
  g.beginPath();
  g.moveTo(X(-0.415), Y(0));
  g.lineTo(X(-0.455), Y(-0.105));
  g.lineTo(X(-0.440), Y(-0.400));
  g.lineTo(X(-0.492), Y(-0.505));
  g.lineTo(X(-0.450), Y(-0.620));
  g.lineTo(X(-0.330), Y(-0.740));
  g.lineTo(X(-0.220), Y(-0.792));
  g.lineTo(X(0.220), Y(-0.792));
  g.lineTo(X(0.330), Y(-0.740));
  g.lineTo(X(0.450), Y(-0.620));
  g.lineTo(X(0.492), Y(-0.505));
  g.lineTo(X(0.440), Y(-0.400));
  g.lineTo(X(0.455), Y(-0.105));
  g.lineTo(X(0.415), Y(0));
  g.closePath();
  g.fill();

  // rear bumper panel darkening
  const panel = g.createLinearGradient(0, Y(-0.47), 0, Y(0));
  panel.addColorStop(0, 'rgba(0,0,0,.02)');
  panel.addColorStop(1, 'rgba(0,0,0,.62)');
  g.fillStyle = panel;
  g.beginPath();
  g.moveTo(X(-0.455), Y(-0.105));
  g.lineTo(X(-0.440), Y(-0.400));
  g.lineTo(X(-0.452), Y(-0.470));
  g.lineTo(X(0.452), Y(-0.470));
  g.lineTo(X(0.440), Y(-0.400));
  g.lineTo(X(0.455), Y(-0.105));
  g.lineTo(X(0.415), Y(0));
  g.lineTo(X(-0.415), Y(0));
  g.closePath(); g.fill();

  // shoulder sheen
  g.strokeStyle = 'rgba(255,255,255,.30)';
  g.lineWidth = Math.max(1, h * 0.006);
  g.beginPath();
  g.moveTo(X(-0.462), Y(-0.532));
  g.quadraticCurveTo(X(0), Y(-0.588), X(0.462), Y(-0.532));
  g.stroke();

  // diffuser
  g.fillStyle = '#07060d';
  rr(g, X(-0.40), Y(-0.135), w * 0.80, h * 0.075, 4); g.fill();
  g.fillStyle = 'rgba(255,255,255,.08)';
  for (let i = -3; i <= 3; i++) g.fillRect(X(i * 0.095), Y(-0.130), Math.max(1, w * 0.006), h * 0.065);

  // rear glass
  const glass = g.createLinearGradient(0, Y(-0.79), 0, Y(-0.62));
  glass.addColorStop(0, '#4d3669'); glass.addColorStop(0.45, '#1a0d2e'); glass.addColorStop(1, '#08030f');
  g.fillStyle = glass;
  g.beginPath();
  g.moveTo(X(-0.245), Y(-0.625)); g.lineTo(X(0.245), Y(-0.625));
  g.lineTo(X(0.196), Y(-0.775)); g.lineTo(X(-0.196), Y(-0.775));
  g.closePath(); g.fill();
  g.save(); g.globalCompositeOperation = 'lighter';
  g.fillStyle = 'rgba(150,220,255,.13)';
  g.beginPath();
  g.moveTo(X(-0.222), Y(-0.655)); g.lineTo(X(-0.095), Y(-0.655));
  g.lineTo(X(-0.152), Y(-0.765)); g.lineTo(X(-0.202), Y(-0.765));
  g.closePath(); g.fill(); g.restore();

  // engine deck slats
  g.fillStyle = 'rgba(0,0,0,.40)';
  for (let i = 0; i < 5; i++) g.fillRect(X(-0.18 + i * 0.075), Y(-0.616), w * 0.040, h * 0.010);

  // spoiler
  g.fillStyle = shade(paint, 0.62);
  g.fillRect(X(-0.175), Y(-0.838), w * 0.046, h * 0.056);
  g.fillRect(X(0.129), Y(-0.838), w * 0.046, h * 0.056);
  const wing = g.createLinearGradient(0, Y(-0.898), 0, Y(-0.838));
  wing.addColorStop(0, shade(paint, 1.55));
  wing.addColorStop(0.55, shade(paint, 1.05));
  wing.addColorStop(1, shade(paint, 0.38));
  g.fillStyle = wing;
  rr(g, X(-0.478), Y(-0.892), w * 0.956, h * 0.056, 3); g.fill();
  g.fillStyle = shade(paint, 0.30);
  rr(g, X(-0.478), Y(-0.880), w * 0.024, h * 0.082, 2); g.fill();
  rr(g, X(0.454), Y(-0.880), w * 0.024, h * 0.082, 2); g.fill();
  g.save(); g.globalCompositeOperation = 'lighter';
  g.strokeStyle = `rgba(${hex2(acc)},.6)`; g.lineWidth = Math.max(1, h * 0.0042);
  g.beginPath(); g.moveTo(X(-0.446), Y(-0.842)); g.lineTo(X(0.446), Y(-0.842)); g.stroke();
  g.restore();

  // tail light bar
  g.save();
  const brake = !!opt.brake;
  g.shadowColor = brake ? 'rgba(255,40,60,1)' : 'rgba(255,30,90,.95)';
  g.shadowBlur = brake ? w * 0.13 : w * 0.065;
  g.fillStyle = brake ? '#ff5566' : '#e6164f';
  rr(g, X(-0.398), Y(-0.548), w * 0.796, h * 0.062, h * 0.022); g.fill();
  g.fillStyle = brake ? '#fff1f1' : '#ffa8ca';
  rr(g, X(-0.330), Y(-0.535), w * 0.660, h * 0.020, h * 0.009); g.fill();
  g.restore();

  // license plate
  g.fillStyle = 'rgba(228,238,255,.88)';
  rr(g, X(-0.090), Y(-0.352), w * 0.180, h * 0.080, 3); g.fill();
  g.fillStyle = '#120614';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `700 ${Math.round(h * 0.050)}px Orbitron, monospace`;
  g.fillText('DS 1017', X(0), Y(-0.3125));

  // exhausts + flames
  for (const s of [-1, 1]) {
    g.fillStyle = '#0a0714';
    g.beginPath(); g.ellipse(X(s * 0.205), Y(-0.072), w * 0.028, h * 0.019, 0, 0, TAU); g.fill();
    g.save(); g.globalCompositeOperation = 'lighter';
    if (opt.boost) {
      const fl = 0.7 + Math.random() * 0.5;
      const grd = g.createRadialGradient(X(s * 0.205), Y(-0.06), 1, X(s * 0.205), Y(-0.06), w * 0.09 * fl);
      grd.addColorStop(0, 'rgba(255,255,255,.95)');
      grd.addColorStop(0.35, 'rgba(140,230,255,.8)');
      grd.addColorStop(1, 'rgba(60,80,255,0)');
      g.fillStyle = grd;
      g.beginPath(); g.ellipse(X(s * 0.205), Y(-0.05), w * 0.07 * fl, h * 0.05 * fl, 0, 0, TAU); g.fill();
    }
    g.fillStyle = 'rgba(255,170,90,.45)';
    g.beginPath(); g.ellipse(X(s * 0.205), Y(-0.066), w * 0.018, h * 0.012, 0, 0, TAU); g.fill();
    g.restore();
  }
}
function shade(c, f) { return `rgb(${Math.min(255, c[0] * f) | 0},${Math.min(255, c[1] * f) | 0},${Math.min(255, c[2] * f) | 0})`; }
function hex2(h) {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)].join(',');
}

/* ------------------------------------------------------------- palettes - */
const PAINT = [
  { paint: [255, 46, 136], accent: '#00e5ff' },
  { paint: [0, 229, 255], accent: '#ffd166' },
  { paint: [182, 255, 60], accent: '#ff2e88' },
  { paint: [255, 182, 72], accent: '#7a5cff' },
];
const AI_PAINT = [
  { paint: [0, 229, 255], accent: '#ffffff' },
  { paint: [255, 170, 60], accent: '#00e5ff' },
  { paint: [140, 100, 255], accent: '#ff2e88' },
  { paint: [80, 255, 170], accent: '#ffd166' },
  { paint: [255, 90, 120], accent: '#00e5ff' },
];

/* ---------------------------------------------------------- sprite bank - */
const BANK = {};
function buildSprites() {
  const palm = palmSprite();
  BANK.palm = { img: palm, hWorld: 2900 };
  const pylon = pylonSprite();
  BANK.pylon = { img: pylon, hWorld: 2400 };
  BANK.arch = { img: archSprite('NEON DRIFT'), hWorld: 2400 };
  BANK.arch2 = { img: archSprite('1017'), hWorld: 2400 };
  BANK.bb1 = { img: billboardSprite('DEEPSEEK', '#00e5ff', '#ff2e88'), hWorld: 1300 };
  BANK.bb2 = { img: billboardSprite('V4.1 FLASH', '#ff2e88', '#00e5ff'), hWorld: 1300 };
  BANK.bb3 = { img: billboardSprite('1017', '#ffd166', '#00e5ff'), hWorld: 1300 };
  BANK.chevL = { img: chevronSprite(-1), hWorld: 900 };
  BANK.chevR = { img: chevronSprite(1), hWorld: 900 };
  BANK.cars = AI_PAINT.map(p => {
    const c = cv(440, 300);
    carArt(c.getContext('2d'), 440, 300, p, {});
    return c;
  });
}

/* -------------------------------------------------------------- helpers - */
function findSegment(z) {
  let i = Math.floor(z / SEG) % segments.length;
  if (i < 0) i += segments.length;
  return segments[i];
}

/* ------------------------------------------------------------- palettes - */
const palCache = new Map();
function fogIndex(f) { return Math.round(clamp(f, 0, 1) * 22); }
function palette(f) {
  const k = fogIndex(f);
  if (palCache.has(k)) return palCache.get(k);
  const t = Math.pow(k / 22, 1.15);
  const fc = COL.fog;
  const p = {
    grassA: rgb(mixc(COL.grassA, fc, t)),
    grassB: rgb(mixc(COL.grassB, fc, t)),
    road: rgb(mixc(COL.road, fc, t)),
    roadB: rgb(mixc(COL.roadB, fc, t)),
    rumbleA: rgb(mixc(COL.rumbleA, fc, t * 0.62)),
    rumbleB: rgb(mixc(COL.rumbleB, fc, t * 0.62)),
    lane: rgb(mixc(COL.lane, fc, t * 0.9)),
    edge: rgb(mixc(COL.edge, fc, t * 0.7)),
    t,
  };
  palCache.set(k, p);
  return p;
}

/* ================================================================ AUDIO = */
const Audio1 = {
  ctx: null, master: null, musicBus: null, sfxBus: null,
  eng: null, wind: null, screech: null, ready: false, musicOn: true,
  step: 0, nextNote: 0, timer: null, bpm: 112,

  init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ac = this.ctx = new AC();
    this.master = ac.createGain(); this.master.gain.value = 0.85; this.master.connect(ac.destination);
    this.musicBus = ac.createGain(); this.musicBus.gain.value = 0.34; this.musicBus.connect(this.master);
    this.sfxBus = ac.createGain(); this.sfxBus.gain.value = 0.9; this.sfxBus.connect(this.master);

    // engine: two detuned saws + sub, through a resonant low-pass
    const eg = this.eng = { gain: ac.createGain(), filter: ac.createBiquadFilter(), oscs: [] };
    eg.gain.gain.value = 0;
    eg.filter.type = 'lowpass'; eg.filter.frequency.value = 520; eg.filter.Q.value = 7;
    eg.filter.connect(eg.gain); eg.gain.connect(this.sfxBus);
    for (const [type, det, g] of [['sawtooth', 0, 0.5], ['sawtooth', 7, 0.35], ['square', -5, 0.16]]) {
      const o = ac.createOscillator(); o.type = type; o.detune.value = det;
      const gg = ac.createGain(); gg.gain.value = g;
      o.connect(gg); gg.connect(eg.filter); o.start(); eg.oscs.push(o);
    }
    const sub = ac.createOscillator(); sub.type = 'sine'; sub.frequency.value = 45;
    const subG = ac.createGain(); subG.gain.value = 0.5;
    sub.connect(subG); subG.connect(eg.gain); sub.start();
    eg.sub = sub;

    // wind noise
    this.wind = this.noiseLoop('bandpass', 900, 0.7);
    this.wind.gain.gain.value = 0;
    // tyre screech
    this.screech = this.noiseLoop('bandpass', 2100, 6);
    this.screech.gain.gain.value = 0;
    // gravel / offroad
    this.gravel = this.noiseLoop('lowpass', 420, 1);
    this.gravel.gain.gain.value = 0;

    this.ready = true;
    this.schedule = this.schedule.bind(this);
    this.timer = setInterval(this.schedule, 25);
    this.nextNote = ac.currentTime + 0.1;
  },

  noiseLoop(type, freq, q) {
    const ac = this.ctx, len = ac.sampleRate * 2;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ac.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(this.sfxBus); src.start();
    return { src, filter: f, gain: g };
  },

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },

  engine(rpm, speedPct, load, offroad, drift) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const f = 42 + rpm * 118;
    for (const o of this.eng.oscs) o.frequency.setTargetAtTime(f * (o.type === 'square' ? 0.5 : 1), t, 0.05);
    this.eng.sub.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.eng.filter.frequency.setTargetAtTime(340 + rpm * 2400 * (0.55 + load * 0.7), t, 0.06);
    this.eng.gain.gain.setTargetAtTime(0.055 + load * 0.05, t, 0.08);
    this.wind.gain.gain.setTargetAtTime(speedPct * 0.05, t, 0.1);
    this.wind.filter.frequency.setTargetAtTime(500 + speedPct * 1800, t, 0.1);
    this.screech.gain.gain.setTargetAtTime(drift ? 0.10 : 0, t, 0.03);
    this.gravel.gain.gain.setTargetAtTime(offroad ? 0.09 : 0, t, 0.05);
  },
  mute() {
    if (!this.ready) return;
    this.sfxBus.gain.setTargetAtTime(this.sfxBus.gain.value > 0 ? 0 : 0.9, this.ctx.currentTime, 0.05);
  },
  toggleMusic() {
    if (!this.ready) return;
    this.musicOn = !this.musicOn;
    this.musicBus.gain.setTargetAtTime(this.musicOn ? 0.34 : 0, this.ctx.currentTime, 0.15);
  },
  blip(freq, dur, type, vol, when) {
    if (!this.ready) return;
    const t = (when || this.ctx.currentTime);
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type || 'square'; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol || 0.18, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + dur + 0.05);
  },
  crash() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.28);
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g); g.connect(this.sfxBus); o.start(t); o.stop(t + 0.35);
    const n = this.ctx.createBufferSource();
    const len = this.ctx.sampleRate * 0.25, buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    n.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 900;
    const gg = this.ctx.createGain(); gg.gain.value = 0.35;
    n.connect(f); f.connect(gg); gg.connect(this.sfxBus); n.start(t);
  },
  whoosh() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    const len = this.ctx.sampleRate * 0.6, buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(3200, t + 0.5);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.4, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    src.connect(f); f.connect(g); g.connect(this.sfxBus); src.start(t);
  },

  /* ---- synthwave sequencer ---- */
  schedule() {
    if (!this.ready) return;
    const ac = this.ctx;
    const stepDur = 60 / this.bpm / 4;
    while (this.nextNote < ac.currentTime + 0.12) {
      this.playStep(this.step, this.nextNote, stepDur);
      this.step = (this.step + 1) % 64;
      this.nextNote += stepDur;
    }
  },
  playStep(step, t, sd) {
    const bar = Math.floor(step / 16) % 4;
    const s = step % 16;
    // A minor progression: Am - F - C - G
    const roots = [55, 43.65, 65.41, 49.0];
    const chords = [[220, 261.6, 329.6, 440], [174.6, 220, 261.6, 349.2], [130.8, 164.8, 196, 261.6], [196, 246.9, 293.7, 392]];
    // bass
    if (s % 4 === 0 || s === 6 || s === 14) this.mBass(roots[bar] * (s === 14 ? 2 : 1), t, sd * 1.7);
    // kick
    if (s === 0 || s === 4 || s === 8 || s === 12) this.mKick(t);
    // hat
    if (s % 2 === 1) this.mHat(t, 0.05);
    // snare
    if (s === 4 || s === 12) this.mSnare(t);
    // arp
    const ch = chords[bar];
    const note = ch[(step * 3) % 4] * (s % 8 === 7 ? 2 : 1);
    this.mArp(note, t, sd * 0.9);
  },
  mBass(f, t, d) {
    const ac = this.ctx;
    const o = ac.createOscillator(), g = ac.createGain(), fl = ac.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.value = f;
    fl.type = 'lowpass'; fl.frequency.setValueAtTime(900, t); fl.frequency.exponentialRampToValueAtTime(220, t + d);
    fl.Q.value = 4;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.20, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(fl); fl.connect(g); g.connect(this.musicBus);
    o.start(t); o.stop(t + d + 0.05);
  },
  mArp(f, t, d) {
    const ac = this.ctx;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'square'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.055, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(this.musicBus);
    o.start(t); o.stop(t + d + 0.02);
  },
  mKick(t) {
    const ac = this.ctx;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g); g.connect(this.musicBus); o.start(t); o.stop(t + 0.25);
  },
  mHat(t, v) {
    this.noiseHit(t, 0.045, 'highpass', 7500, v);
  },
  mSnare(t) {
    this.noiseHit(t, 0.14, 'bandpass', 1900, 0.11);
  },
  noiseHit(t, dur, type, freq, vol) {
    const ac = this.ctx;
    const len = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ac.createBufferSource(); src.buffer = buf;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = ac.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.musicBus);
    src.start(t);
  },
};

/* ============================================================ BACKGROUND = */
let skyCanvas = null, ridgeFar = null, ridgeNear = null, cityLayer = null;
let bgPan = 0;

function makeRidge(seed, top, bottom, rim, amp, h) {
  const w = Math.max(2, Math.ceil(W));
  const c = cv(w, Math.max(2, Math.ceil(h)));
  const g = c.getContext('2d');
  const r = mulberry32(seed);
  const a1 = r() * TAU, a2 = r() * TAU, a3 = r() * TAU;
  const N = 200;
  const ys = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    ys.push(h * 0.60
      + Math.sin(t * TAU * 2 + a1) * amp * 0.52
      + Math.sin(t * TAU * 5 + a2) * amp * 0.27
      + Math.sin(t * TAU * 11 + a3) * amp * 0.13);
  }
  g.beginPath(); g.moveTo(0, h);
  for (let i = 0; i <= N; i++) g.lineTo((i / N) * w, ys[i]);
  g.lineTo(w, h); g.closePath();
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, top); grd.addColorStop(1, bottom);
  g.fillStyle = grd; g.fill();
  g.save();
  g.strokeStyle = rim; g.lineWidth = 1.6;
  g.shadowColor = rim; g.shadowBlur = 14;
  g.beginPath();
  for (let i = 0; i <= N; i++) { const x = (i / N) * w; i ? g.lineTo(x, ys[i]) : g.moveTo(x, ys[i]); }
  g.stroke();
  g.restore();
  return c;
}

function makeCity(seed, h) {
  const w = Math.ceil(W * 2), c = cv(w, Math.max(2, Math.ceil(h)));
  const g = c.getContext('2d');
  const r = mulberry32(seed);
  g.fillStyle = '#0a0219';
  let x = 0;
  while (x < w) {
    const bw = 12 + r() * 46;
    const bh = h * (0.25 + r() * 0.72);
    g.fillStyle = '#0a0219';
    g.fillRect(x, h - bh, bw, bh);
    // antenna
    if (r() < 0.2) { g.fillRect(x + bw / 2, h - bh - 8 - r() * 14, 1.5, 24); }
    // windows
    g.fillStyle = r() < 0.5 ? 'rgba(0,229,255,.55)' : 'rgba(255,46,136,.5)';
    for (let wy = h - bh + 5; wy < h - 5; wy += 7) {
      for (let wx = x + 3; wx < x + bw - 3; wx += 6) {
        if (r() < 0.30) g.fillRect(wx, wy, 2, 2.6);
      }
    }
    x += bw + r() * 10;
  }
  return c;
}

function buildBackground() {
  const hz = horizonY;
  // ---- sky
  const c = cv(Math.max(2, W * DPR), Math.max(2, H * DPR));
  const g = c.getContext('2d');
  g.scale(DPR, DPR);
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0.00, '#05000f');
  grd.addColorStop(0.20, '#12022b');
  grd.addColorStop(0.38, '#3b0a52');
  grd.addColorStop(0.55, '#8d1367');
  grd.addColorStop(0.70, '#e02b6b');
  grd.addColorStop(0.82, '#ff5570');
  grd.addColorStop(1.00, '#ff9268');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);

  const rnd = mulberry32(777);
  for (let i = 0; i < 190; i++) {
    const x = rnd() * W, y = rnd() * hz * 0.9;
    const s = rnd() < 0.88 ? 1 : 1.9;
    g.globalAlpha = 0.2 + rnd() * 0.75;
    g.fillStyle = rnd() < 0.22 ? '#a9ecff' : '#ffffff';
    g.fillRect(x, y, s, s);
  }
  g.globalAlpha = 1;

  // ---- sun
  const sr = Math.min(W, H) * 0.165;
  const sx = W * 0.635, sy = hz - sr * 0.52;
  const sun = cv(sr * 2 + 4, sr * 2 + 4);
  const sg = sun.getContext('2d');
  const rg = sg.createRadialGradient(sr + 2, sr * 0.55, 1, sr + 2, sr + 2, sr);
  rg.addColorStop(0, '#fffbe0'); rg.addColorStop(0.30, '#ffd96b');
  rg.addColorStop(0.62, '#ff8a4d'); rg.addColorStop(1, '#ff2e63');
  sg.fillStyle = rg; sg.beginPath(); sg.arc(sr + 2, sr + 2, sr, 0, TAU); sg.fill();
  sg.globalCompositeOperation = 'destination-out';
  let bandY = sr * 1.00, bandH = sr * 0.016;
  while (bandY < sr * 2 + 4) {
    sg.fillRect(0, bandY, sr * 2 + 4, bandH);
    bandY += bandH * 1.85 + sr * 0.034;
    bandH *= 1.32;
  }
  g.drawImage(sun, sx - sr, sy - sr);
  g.save();
  g.globalCompositeOperation = 'lighter';
  const glow = g.createRadialGradient(sx, sy, sr * 0.72, sx, sy, sr * 2.5);
  glow.addColorStop(0, 'rgba(255,110,140,.26)');
  glow.addColorStop(0.5, 'rgba(255,60,120,.09)');
  glow.addColorStop(1, 'rgba(255,60,120,0)');
  g.fillStyle = glow; g.fillRect(0, 0, W, H);
  g.restore();

  // horizon haze
  const haze = g.createLinearGradient(0, hz - H * 0.09, 0, hz + 4);
  haze.addColorStop(0, 'rgba(255,120,150,0)');
  haze.addColorStop(1, 'rgba(255,150,170,.28)');
  g.fillStyle = haze; g.fillRect(0, hz - H * 0.09, W, H * 0.09 + 4);

  skyCanvas = c;
  ridgeFar = makeRidge(11, '#3a0f4e', '#180428', 'rgba(255,80,160,.55)', H * 0.055, H * 0.20);
  ridgeNear = makeRidge(29, '#26073a', '#0b0118', 'rgba(0,229,255,.35)', H * 0.042, H * 0.14);
  cityLayer = makeCity(53, H * 0.11);
}

/* ------------------------------------------------------------ decoration - */
function addProp(seg, bank, offset) { seg.sprites.push({ bank, offset }); }

function decorate() {
  const rnd = mulberry32(1017);
  const N = segments.length;
  for (let i = 0; i < N; i++) {
    const s = segments[i];
    if (i % 8 === 0) {
      if (rnd() < 0.8) addProp(s, BANK.palm, -(1.35 + rnd() * 1.1));
      if (rnd() < 0.8) addProp(s, BANK.palm, (1.35 + rnd() * 1.1));
    }
    if (i % 19 === 8) { addProp(s, BANK.pylon, -1.16); addProp(s, BANK.pylon, 1.16); }
    if (i % 63 === 28) addProp(s, rnd() < 0.5 ? BANK.bb1 : BANK.bb2, (rnd() < 0.5 ? -1 : 1) * (2.3 + rnd() * 1.0));
    if (i % 97 === 61) addProp(s, rnd() < 0.5 ? BANK.bb3 : BANK.bb2, (rnd() < 0.5 ? -1 : 1) * (2.1 + rnd() * 1.2));
    if (i % 37 === 18 && Math.abs(s.curve) > 1.2) {
      const dir = s.curve > 0 ? 1 : -1;
      addProp(s, dir > 0 ? BANK.chevR : BANK.chevL, -dir * 1.09);
    }
    if (i % 260 === 130) addProp(s, (i / 260) % 2 < 1 ? BANK.arch : BANK.arch2, 0);
  }
  addProp(segments[0], BANK.arch, 0);
}

/* ================================================================ STATE = */
const G = {
  state: 'menu',
  position: 0, speed: 0, playerX: 0,
  steer: 0, steerT: 0, drift: 0,
  nitro: 1, boosting: false,
  lap: 1, lapClock: 0, clock: 0, raceClock: 0,
  countdown: 0, lastCount: 4,
  lapTimes: [], best: 0, topSpeed: 0,
  shake: 0, paint: 0,
  cars: [], particles: [],
  msgT: 0, fps: 60, frames: 0, fpsT: 0, renderMs: 0, wallT: 0,
  finished: false, place: 6,
  offroad: 0, gear: 1, rpm: 0.2,
};

const keys = { left: false, right: false, accel: false, brake: false, nitro: false };
let hasTouch = false;
function setTouchVisible(v) { $('touch').classList.toggle('hidden', !(hasTouch && v)); }

function initCars() {
  G.cars = [];
  const grid = [
    { off: -0.55, z: 3200, base: 0.905 },
    { off: 0.55, z: 4600, base: 0.888 },
    { off: -0.22, z: 6200, base: 0.930 },
    { off: 0.26, z: 7800, base: 0.872 },
    { off: 0.72, z: 9400, base: 0.912 },
  ];
  for (let i = 0; i < AI_COUNT; i++) {
    G.cars.push({
      z: grid[i].z, offset: grid[i].off, base: grid[i].base,
      speed: 0, lap: 1, img: BANK.cars[i % BANK.cars.length],
      phase: Math.random() * TAU, hit: 0,
    });
  }
}
function resetRace() {
  G.position = 0; G.speed = 0; G.playerX = 0;
  G.steer = 0; G.steerT = 0; G.drift = 0;
  G.nitro = 1; G.boosting = false;
  G.lap = 1; G.lapClock = 0; G.raceClock = 0;
  G.lapTimes = []; G.best = 0; G.topSpeed = 0;
  G.particles.length = 0; G.shake = 0;
  G.finished = false; G.place = 6;
  initCars();
}

/* ================================================================ INPUT = */
function bindInput() {
  const map = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'accel', KeyW: 'accel',
    ArrowDown: 'brake', KeyS: 'brake',
    Space: 'nitro',
  };
  addEventListener('keydown', (e) => {
    if (map[e.code]) { keys[map[e.code]] = true; e.preventDefault(); }
    if (e.code === 'Escape') { e.preventDefault(); togglePause(); }
    if (e.code === 'Enter') {
      if (G.state === 'menu') startRace();
      else if (G.state === 'finish') startRace();
    }
    if (e.code === 'KeyR' && (G.state === 'finish' || G.state === 'race')) startRace();
    if (e.code === 'KeyM') Audio1.toggleMusic();
    if (e.code === 'KeyF') { const f = $('fps'); f.style.display = f.style.display === 'block' ? 'none' : 'block'; }
    if (e.code === 'KeyP') togglePause();
  });
  addEventListener('keyup', (e) => { if (map[e.code]) keys[map[e.code]] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  // touch
  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) hasTouch = true;
  touch.querySelectorAll('button').forEach((b) => {
    const k = b.dataset.key;
    const on = (e) => { e.preventDefault(); keys[k] = true; Audio1.init(); Audio1.resume(); };
    const off = (e) => { e.preventDefault(); keys[k] = false; };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointerleave', off);
    b.addEventListener('pointercancel', off);
  });
}

/* ================================================================ RENDER = */
function project(p, camX, camY, camZ) {
  p.camZ = p.world.z - camZ;
  const z = p.camZ;
  if (z < 1) { p.scale = 0; p.sx = W / 2; p.sy = H; p.sw = 0; return; }
  p.scale = camDepth / z;
  p.sx = W / 2 + p.scale * (p.world.x - camX) * W / 2;
  p.sy = horizonY - p.scale * (p.world.y - camY) * H / 2;
  p.sw = p.scale * ROAD_W * W / 2;
}

function drawBackground() {
  ctx.drawImage(skyCanvas, 0, 0, W, H);
  const hz = horizonY;
  const pan = bgPan;

  // city
  if (cityLayer) {
    const cw = cityLayer.width, chh = cityLayer.height;
    let ox = (((-pan * 0.35 - G.playerX * 40) % cw) + cw) % cw;
    const y = hz - chh + 2;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(cityLayer, -ox, y, cw, chh);
    ctx.drawImage(cityLayer, cw - ox, y, cw, chh);
    ctx.globalAlpha = 1;
  }
  const drawRidge = (layer, mult, yOff) => {
    if (!layer) return;
    const lw = layer.width, lh = layer.height;
    let ox = (((-pan * mult - G.playerX * mult * 40) % lw) + lw) % lw;
    const y = hz - lh + yOff;
    ctx.drawImage(layer, -ox, y, lw, lh);
    ctx.drawImage(layer, lw - ox, y, lw, lh);
  };
  drawRidge(ridgeFar, 1.0, 1);
  drawRidge(ridgeNear, 1.7, 3);
}

function drawSegment(seg) {
  const p1 = seg.p1, p2 = seg.p2;
  const pal = palette(seg.fog);
  const y1 = p1.sy, y2 = p2.sy;
  const hgt = y1 - y2;
  if (hgt <= 0) return;

  ctx.fillStyle = (seg.index % 2) ? pal.grassA : pal.grassB;
  ctx.fillRect(0, y2, W, hgt + 1);

  if (seg.index % 12 === 0 && seg.fog < 0.8) {
    ctx.fillStyle = `rgba(0,229,255,${0.14 * (1 - seg.fog)})`;
    ctx.fillRect(0, y2, W, Math.max(1, hgt * 0.32));
  }

  const r1 = Math.max(0.6, p1.sw / 7), r2 = Math.max(0.6, p2.sw / 7);
  const alt = Math.floor(seg.index / 2) % 2;
  const roadCol = alt ? pal.road : pal.roadB;

  ctx.fillStyle = alt ? pal.rumbleA : pal.rumbleB;
  poly(ctx, [[p1.sx - p1.sw, y1], [p1.sx - p1.sw + r1, y1], [p2.sx - p2.sw + r2, y2], [p2.sx - p2.sw, y2]]); ctx.fill();
  poly(ctx, [[p1.sx + p1.sw, y1], [p1.sx + p1.sw - r1, y1], [p2.sx + p2.sw - r2, y2], [p2.sx + p2.sw, y2]]); ctx.fill();

  ctx.fillStyle = roadCol;
  poly(ctx, [[p1.sx - p1.sw + r1, y1], [p1.sx + p1.sw - r1, y1], [p2.sx + p2.sw - r2, y2], [p2.sx - p2.sw + r2, y2]]); ctx.fill();

  if (alt && seg.fog < 0.82) {
    ctx.fillStyle = pal.lane;
    for (let l = 1; l < LANES; l++) {
      const w1 = p1.sw * 0.010 + 0.4, w2 = p2.sw * 0.010 + 0.4;
      const lx1 = p1.sx - p1.sw + p1.sw * 2 * (l / LANES);
      const lx2 = p2.sx - p2.sw + p2.sw * 2 * (l / LANES);
      poly(ctx, [[lx1 - w1, y1], [lx1 + w1, y1], [lx2 + w2, y2], [lx2 - w2, y2]]); ctx.fill();
    }
  }

  if (seg.fog < 0.5) {
    const ea = 0.55 * (1 - seg.fog / 0.5);
    ctx.fillStyle = `rgba(226,236,255,${ea})`;
    const e1 = Math.max(0.8, p1.sw * 0.015), e2 = Math.max(0.8, p2.sw * 0.015);
    poly(ctx, [[p1.sx - p1.sw + r1, y1], [p1.sx - p1.sw + r1 + e1, y1], [p2.sx - p2.sw + r2 + e2, y2], [p2.sx - p2.sw + r2, y2]]); ctx.fill();
    poly(ctx, [[p1.sx + p1.sw - r1, y1], [p1.sx + p1.sw - r1 - e1, y1], [p2.sx + p2.sw - r2 - e2, y2], [p2.sx + p2.sw - r2, y2]]); ctx.fill();
  }

  if (seg.fog < 0.62) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const a = 0.42 * (1 - seg.fog / 0.62);
    ctx.fillStyle = `rgba(0,229,255,${a})`;
    poly(ctx, [[p1.sx - p1.sw, y1], [p1.sx - p1.sw + r1 * 0.45, y1], [p2.sx - p2.sw + r2 * 0.45, y2], [p2.sx - p2.sw, y2]]); ctx.fill();
    poly(ctx, [[p1.sx + p1.sw, y1], [p1.sx + p1.sw - r1 * 0.45, y1], [p2.sx + p2.sw - r2 * 0.45, y2], [p2.sx + p2.sw, y2]]); ctx.fill();
    ctx.restore();
  }

  if (seg.finish) {
    ctx.fillStyle = 'rgba(245,248,255,.85)';
    for (let i = 0; i < 16; i += 2) {
      const t0 = i / 16, t1 = (i + 1) / 16;
      const a1 = p1.sx - p1.sw + p1.sw * 2 * t0, b1 = p1.sx - p1.sw + p1.sw * 2 * t1;
      const a2 = p2.sx - p2.sw + p2.sw * 2 * t0, b2 = p2.sx - p2.sw + p2.sw * 2 * t1;
      poly(ctx, [[a1, y1], [b1, y1], [b2, y2], [a2, y2]]); ctx.fill();
    }
  }
}

function drawProp(seg, prop) {
  const p = seg.p1;
  if (p.scale <= 0) return;
  const b = prop.bank;
  const pxu = p.scale * (W / 2);
  const dh = pxu * b.hWorld;
  if (dh < 1.4 || dh > H * 7) return;
  const dw = dh * (b.img.width / b.img.height);
  const x = p.sx + p.sw * prop.offset - dw / 2;
  const y = p.sy - dh;
  if (x + dw < -40 || x > W + 40) return;
  ctx.globalAlpha = Math.max(0.04, 1 - seg.fog * 0.95);
  ctx.drawImage(b.img, x, y, dw, dh);
  ctx.globalAlpha = 1;
}

function drawAICar(seg, car) {
  const p = seg.p1;
  if (p.scale <= 0) return;
  const pxu = p.scale * (W / 2);
  const dh = pxu * 840;
  if (dh < 1.2) return;
  const dw = dh * (car.img.width / car.img.height);
  const x = p.sx + p.sw * car.offset - dw / 2;
  const y = p.sy - dh * 0.966;
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.beginPath();
  ctx.ellipse(x + dw / 2, y + dh * 0.985, dw * 0.5, dh * 0.055, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = Math.max(0.05, 1 - seg.fog * 0.95);
  ctx.drawImage(car.img, x, y, dw, dh);
  ctx.globalAlpha = 1;
}

function renderRoad() {
  const base = findSegment(G.position);
  const basePercent = (G.position % SEG) / SEG;
  const pSeg = findSegment(G.position + playerZ);
  const pp = ((G.position + playerZ) % SEG) / SEG;
  const playerY = lerp(pSeg.p1.world.y, pSeg.p2.world.y, pp);
  const camY = playerY + CAM_H;
  const baseIdx = base.index;
  const N = segments.length;
  let maxy = H;
  let x = 0, dx = -(base.curve * basePercent);

  // bucket cars into segments
  for (let n = 0; n < DRAW; n++) {
    const s = segments[(baseIdx + n) % N];
    s.cars.length = 0;
    s.visible = false;
  }
  if (G.state !== 'menu') for (const c of G.cars) {
    const idx = Math.floor(c.z / SEG) % N;
    let rel = idx - baseIdx;
    if (rel < 0) rel += N;
    if (rel < DRAW) segments[idx].cars.push(c);
  }

  for (let n = 0; n < DRAW; n++) {
    const seg = segments[(baseIdx + n) % N];
    seg.looped = seg.index < baseIdx;
    seg.fog = 1 - Math.exp(-n / 150);
    seg.clip = maxy;
    const camZ = G.position - (seg.looped ? trackLength : 0);
    project(seg.p1, G.playerX * ROAD_W - x, camY, camZ);
    project(seg.p2, G.playerX * ROAD_W - x - dx, camY, camZ);
    x += dx; dx += seg.curve;
    if (seg.p1.camZ <= camDepth || seg.p2.sy >= seg.p1.sy || seg.p2.sy >= maxy) continue;
    seg.visible = true;
    drawSegment(seg);
    maxy = seg.p2.sy;
  }

  for (let n = DRAW - 1; n >= 0; n--) {
    const seg = segments[(baseIdx + n) % N];
    if (!seg.visible) continue;
    if (seg.p1.sy > seg.clip + 2) continue;
    for (let i = 0; i < seg.sprites.length; i++) drawProp(seg, seg.sprites[i]);
    for (let i = 0; i < seg.cars.length; i++) drawAICar(seg, seg.cars[i]);
  }
}

let playerImgs = [];
function buildPlayerImgs() {
  playerImgs = PAINT.map((p) => {
    const c = cv(600, 409);
    carArt(c.getContext('2d'), 600, 409, p, {});
    return c;
  });
}

function drawPlayerCar() {
  const cw = clamp(W * 0.215, 130, 420);
  const ch = cw * (409 / 600);
  const sp = G.speed / MAX_SPEED;
  const bounce = Math.sin(G.clock * 19) * (0.8 + sp * 2.4) + (G.offroad > 0.2 ? (Math.random() - 0.5) * 7 : 0);
  const x = W / 2 + G.steer * W * 0.016;
  const y = H - 16 + bounce;
  const img = playerImgs[G.paint] || playerImgs[0];
  if (!img) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(G.steer * 0.016 + G.drift * G.steer * 0.045);
  ctx.drawImage(img, -cw / 2, -ch * 0.966, cw, ch);

  if (keys.brake || G.offroad > 0.4) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const bg = ctx.createRadialGradient(0, -ch * 0.52, 4, 0, -ch * 0.52, cw * 0.55);
    bg.addColorStop(0, 'rgba(255,60,90,.38)');
    bg.addColorStop(1, 'rgba(255,30,60,0)');
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.ellipse(0, -ch * 0.52, cw * 0.55, ch * 0.14, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }
  if (G.boosting) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // heat bloom behind the car
    const hb = ctx.createRadialGradient(0, -ch * 0.16, 6, 0, -ch * 0.16, cw * 0.62);
    hb.addColorStop(0, 'rgba(120,225,255,.30)');
    hb.addColorStop(0.55, 'rgba(80,140,255,.12)');
    hb.addColorStop(1, 'rgba(60,80,255,0)');
    ctx.fillStyle = hb;
    ctx.beginPath(); ctx.ellipse(0, -ch * 0.14, cw * 0.62, ch * 0.26, 0, 0, TAU); ctx.fill();
    // twin jets
    for (const s of [-1, 1]) {
      const fl = 0.85 + Math.random() * 0.4;
      const fx = s * cw * 0.205, fy = -ch * 0.030;
      const len = ch * 0.20 * fl, wid = cw * 0.062 * fl;
      const fg = ctx.createRadialGradient(fx, fy, 2, fx, fy, len);
      fg.addColorStop(0, 'rgba(255,255,255,.95)');
      fg.addColorStop(0.25, 'rgba(180,240,255,.8)');
      fg.addColorStop(0.6, 'rgba(90,140,255,.4)');
      fg.addColorStop(1, 'rgba(60,80,255,0)');
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.ellipse(fx, fy - len * 0.18, wid, len * 0.70, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.beginPath();
      ctx.ellipse(fx, fy - len * 0.28, wid * 0.34, len * 0.14, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();
}

function drawParticles() {
  for (const p of G.particles) {
    const a = clamp(p.life / p.max, 0, 1);
    if (p.kind === 'spark') {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = `rgba(255,${180 + p.r * 60 | 0},120,${a})`;
      ctx.lineWidth = p.size;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02); ctx.stroke();
      ctx.restore();
    } else if (p.kind === 'smoke') {
      const s = p.size * (1.7 - a * 0.7);
      ctx.fillStyle = `rgba(${p.c},${a * 0.20})`;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, s * 1.2, s * 0.78, 0, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = `rgba(${p.c},${a * 0.5})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
    }
  }
}

const streaks = [];
for (let i = 0; i < 46; i++) streaks.push({ a: Math.random() * TAU, r: 0.25 + Math.random() * 0.8, w: 0.5 + Math.random() * 1.4 });

function drawSpeedLines(sp) {
  if (sp < 0.72) return;
  const t = (sp - 0.72) / 0.28;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, horizonY + 10, W, H - horizonY - 10);
  ctx.clip();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = `rgba(150,240,255,${0.025 + t * 0.085})`;
  const cx = W / 2, cy = horizonY + H * 0.10;
  const maxR = Math.hypot(W, H) * 0.60;
  for (const s of streaks) {
    const r0 = (0.42 + s.r * 0.24) * maxR;
    const len = (26 + t * 130) * s.w;
    ctx.lineWidth = s.w;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(s.a) * r0, cy + Math.sin(s.a) * r0 * 0.85);
    ctx.lineTo(cx + Math.cos(s.a) * (r0 + len), cy + Math.sin(s.a) * (r0 + len) * 0.85);
    ctx.stroke();
  }
  ctx.restore();
}

const GRID_OFFS = [-5.6, -4.4, -3.4, -2.6, -1.95, -1.35, 1.35, 1.95, 2.6, 3.4, 4.4, 5.6];
function drawGroundGrid(baseIdx) {
  const N = segments.length;
  const g = ctx.createLinearGradient(0, horizonY, 0, H);
  g.addColorStop(0, 'rgba(0,229,255,0)');
  g.addColorStop(0.30, 'rgba(0,229,255,.12)');
  g.addColorStop(1, 'rgba(130,90,255,.30)');
  ctx.strokeStyle = g;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  const lim = Math.min(DRAW - 1, 230);
  for (let k = 0; k < GRID_OFFS.length; k++) {
    const off = GRID_OFFS[k];
    let started = false;
    for (let n = lim; n >= 0; n--) {
      const seg = segments[(baseIdx + n) % N];
      if (!seg.visible) { started = false; continue; }
      const x = seg.p1.sx + seg.p1.sw * off;
      const y = seg.p1.sy;
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}

function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  let sx = 0, sy = 0;
  if (G.shake > 0.01) {
    sx = (Math.random() - 0.5) * G.shake * 16;
    sy = (Math.random() - 0.5) * G.shake * 12;
  }
  ctx.save();
  ctx.translate(sx, sy);
  drawBackground();
  renderRoad();
  drawGroundGrid(findSegment(G.position).index);
  drawParticles();
  drawPlayerCar();
  ctx.restore();
  drawSpeedLines(G.speed / MAX_SPEED);
  if (G.boosting) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(W / 2, H * 0.78, H * 0.05, W / 2, H * 0.78, H * 0.55);
    g.addColorStop(0, 'rgba(120,220,255,.10)');
    g.addColorStop(1, 'rgba(80,120,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
}

/* =================================================================== HUD = */
const ui = {
  hud: $('hud'), lap: $('lapVal'), pos: $('posVal'), lapTime: $('lapTime'),
  best: $('bestTime'), nitro: $('nitroFill'), nitroPct: $('nitroPct'),
  msg: $('msg'), msgMain: document.querySelector('#msg .msg-main'), msgSub: document.querySelector('#msg .msg-sub'),
  flash: $('flash'), menu: $('menu'), results: $('results'), pause: $('pause'),
  resTitle: $('resTitle'), resTotal: $('resTotal'), resBest: $('resBest'), resTop: $('resTop'),
  resLaps: $('resLaps'), resKicker: $('resKicker'), warn: $('warn'),
};
let msgTimer = null;
function showMsg(main, sub, go) {
  ui.msgMain.textContent = main;
  ui.msgSub.textContent = sub || '';
  ui.msg.classList.remove('show', 'go');
  void ui.msg.offsetWidth;
  ui.msg.classList.add('show');
  if (go) ui.msg.classList.add('go');
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => ui.msg.classList.remove('show'), 1500);
}
function flash() {
  ui.flash.classList.remove('on');
  void ui.flash.offsetWidth;
  ui.flash.classList.add('on');
}

let lastLapTxt = '', lastPosTxt = '', lastLapTimeTxt = '', lastBestTxt = '', lastPlace = 0;
function updateHUD() {
  const lapTxt = `${G.lap}<i>/${TOTAL_LAPS}</i>`;
  if (lapTxt !== lastLapTxt) { ui.lap.innerHTML = lapTxt; lastLapTxt = lapTxt; }
  const posTxt = `${G.place}<i>/${AI_COUNT + 1}</i>`;
  if (posTxt !== lastPosTxt) { ui.pos.innerHTML = posTxt; lastPosTxt = posTxt; }
  if (G.place !== lastPlace) {
    const chip = ui.pos.parentElement;
    if (lastPlace) {
      chip.classList.remove('pos-up'); void chip.offsetWidth; chip.classList.add('pos-up');
      Audio1.blip(G.place < lastPlace ? 900 : 420, 0.09, 'triangle', 0.09);
    }
    lastPlace = G.place;
  }
  if (ui.warn) ui.warn.classList.toggle('on', G.offroad > 0.55 && G.speed > 1200 && G.state === 'race');
  const lt = G.state === 'race' || G.state === 'finish' ? fmt(G.lapClock) : '0:00.00';
  if (lt !== lastLapTimeTxt) { ui.lapTime.textContent = lt; lastLapTimeTxt = lt; }
  const bt = fmt(G.best);
  if (bt !== lastBestTxt) { ui.best.textContent = bt; lastBestTxt = bt; }
  ui.nitro.style.width = (G.nitro * 100).toFixed(1) + '%';
  ui.nitroPct.textContent = Math.round(G.nitro * 100) + '%';
  const ms = $('mSpeed');
  if (ms) ms.innerHTML = Math.round(G.speed / MAX_SPEED * KMH) + '<i>km/h</i>';
  drawGauge(G.speed / MAX_SPEED * KMH, G.rpm, G.gear);
  drawMap();
}

/* --------------------------------------------------------------- gauge -- */
let gaugeStatic = null;
function buildGaugeStatic() {
  const S = 260, c = S / 2, R = S * 0.365;
  const s = cv(S * DPR, S * DPR);
  const g = s.getContext('2d');
  g.scale(DPR, DPR);
  const a0 = Math.PI * 0.78, a1 = Math.PI * 2.22;

  const plate = g.createRadialGradient(c, c * 0.85, 10, c, c, S * 0.5);
  plate.addColorStop(0, 'rgba(24,8,44,.86)');
  plate.addColorStop(0.72, 'rgba(8,2,18,.76)');
  plate.addColorStop(1, 'rgba(8,2,18,0)');
  g.fillStyle = plate;
  g.beginPath(); g.arc(c, c, S * 0.5, 0, TAU); g.fill();

  g.lineCap = 'round';
  g.lineWidth = 10;
  g.strokeStyle = 'rgba(255,255,255,.085)';
  g.beginPath(); g.arc(c, c, R, a0, a1); g.stroke();

  for (let i = 0; i <= 11; i++) {
    const a = a0 + (a1 - a0) * (i / 11);
    const major = i % 2 === 0;
    const r0 = R + 8, r1 = R + (major ? 17 : 12);
    g.strokeStyle = major ? 'rgba(255,255,255,.30)' : 'rgba(255,255,255,.14)';
    g.lineWidth = major ? 2.2 : 1.2;
    g.beginPath();
    g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
    g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
    g.stroke();
  }
  // faint inner ring
  g.strokeStyle = 'rgba(0,229,255,.10)';
  g.lineWidth = 1.4;
  g.beginPath(); g.arc(c, c, R - 16, a0, a1); g.stroke();

  gaugeStatic = s;
}

function drawGauge(kmh, rpm, gear) {
  const S = 260, c = S / 2, R = S * 0.365;
  const g = gaugeCtx;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, S * DPR, S * DPR);
  if (gaugeStatic) g.drawImage(gaugeStatic, 0, 0);
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  const a0 = Math.PI * 0.78, a1 = Math.PI * 2.22;

  const t = clamp(kmh / 400, 0, 1);
  const grd = g.createLinearGradient(0, S, S, 0);
  grd.addColorStop(0, '#00e5ff'); grd.addColorStop(0.5, '#7a5cff'); grd.addColorStop(1, '#ff2e88');
  g.strokeStyle = grd;
  g.lineWidth = 10;
  g.lineCap = 'round';
  g.shadowColor = 'rgba(255,46,136,.85)';
  g.shadowBlur = 16;
  g.beginPath(); g.arc(c, c, R, a0, a0 + (a1 - a0) * t); g.stroke();
  g.shadowBlur = 0;

  // needle
  const an = a0 + (a1 - a0) * t;
  g.save();
  g.translate(c, c);
  g.rotate(an);
  g.shadowColor = '#ff2e88'; g.shadowBlur = 18;
  g.fillStyle = '#ff9cc4';
  g.beginPath();
  g.moveTo(-6, -3); g.lineTo(R - 14, -1.6); g.lineTo(R - 14, 1.6); g.lineTo(-6, 3);
  g.closePath(); g.fill();
  g.restore();
  g.beginPath(); g.arc(c, c, 7, 0, TAU);
  g.fillStyle = '#1a0430'; g.fill();
  g.strokeStyle = '#ff2e88'; g.lineWidth = 2; g.stroke();

  // digital speed
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,229,255,.85)'; g.shadowBlur = 22;
  g.fillStyle = '#ffffff';
  g.font = '900 46px Orbitron, Bahnschrift, sans-serif';
  g.fillText(String(Math.round(kmh)).padStart(3, ' '), c, c + 54);
  g.shadowBlur = 0;
  g.font = '700 11px Orbitron, Bahnschrift, sans-serif';
  g.fillStyle = 'rgba(255,255,255,.45)';
  g.fillText('KM / H', c, c + 82);

  // gear
  g.font = '900 22px Orbitron, Bahnschrift, sans-serif';
  g.fillStyle = '#8ff6ff';
  g.shadowColor = 'rgba(0,229,255,.8)'; g.shadowBlur = 14;
  g.fillText('D' + gear, c, c - 56);
  g.shadowBlur = 0;
}

/* ------------------------------------------------------------------ map -- */
let mapPts = [], mapScale = 1, mapOX = 0, mapOY = 0, mapPath = null;
function buildMapPath() {
  const n = segments.length;
  let sum = 0;
  for (const s of segments) sum += s.curve;
  const k = 0.0034;
  // force the integrated heading to close on exactly one full turn so the
  // schematic reads as a circuit, while keeping the corner character
  const extra = (TAU - sum * k) / n;
  let ang = -Math.PI / 2, x = 0, y = 0;
  const pts = [];
  for (let i = 0; i < n; i++) {
    ang += segments[i].curve * k + extra;
    x += Math.sin(ang); y -= Math.cos(ang);
    pts.push([x, y]);
  }
  for (let pass = 0; pass < 14; pass++) {
    for (let i = 0; i < n; i++) {
      const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
      pts[i][0] = (a[0] + pts[i][0] * 2 + b[0]) * 0.25;
      pts[i][1] = (a[1] + pts[i][1] * 2 + b[1]) * 0.25;
    }
  }
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  for (const p of pts) {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
  }
  const pad = 30, S = 200;
  mapScale = Math.min((S - pad * 2) / (maxX - minX || 1), (S - pad * 2) / (maxY - minY || 1));
  mapOX = S / 2 - (minX + maxX) / 2 * mapScale;
  mapOY = S / 2 - (minY + maxY) / 2 * mapScale;
  mapPts = pts;
  const path = new Path2D();
  path.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i += 2) path.lineTo(pts[i][0], pts[i][1]);
  path.closePath();
  mapPath = path;
}

function drawMap() {
  const g = mapCtx;
  const S = 200;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.clearRect(0, 0, S, S);
  if (!mapPath) return;
  g.save();
  g.translate(mapOX, mapOY);
  g.scale(mapScale, mapScale);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(0,229,255,.16)';
  g.lineWidth = 9 / mapScale;
  g.stroke(mapPath);
  g.strokeStyle = 'rgba(150,247,255,.95)';
  g.lineWidth = 2.6 / mapScale;
  g.stroke(mapPath);

  const s0 = mapPts[0];
  g.fillStyle = '#ffd166';
  g.beginPath(); g.arc(s0[0], s0[1], 2.6 / mapScale, 0, TAU); g.fill();

  for (const c of G.cars) {
    const idx = Math.min(mapPts.length - 1, Math.floor(c.z / trackLength * mapPts.length));
    const p = mapPts[idx];
    g.fillStyle = 'rgba(255,110,170,.9)';
    g.beginPath(); g.arc(p[0], p[1], 2.2 / mapScale, 0, TAU); g.fill();
  }

  const prog = ((G.lap - 1) * trackLength + G.position) % trackLength;
  const idx = Math.min(mapPts.length - 1, Math.floor(prog / trackLength * mapPts.length));
  const p = mapPts[idx];
  g.fillStyle = '#ffffff';
  g.beginPath(); g.arc(p[0], p[1], 3.6 / mapScale, 0, TAU); g.fill();
  g.fillStyle = 'rgba(0,229,255,.55)';
  g.beginPath(); g.arc(p[0], p[1], 6.5 / mapScale, 0, TAU); g.fill();
  g.restore();
}

/* ================================================================ UPDATE = */
function update(dt) {
  G.clock += dt;
  G.shake = Math.max(0, G.shake - dt * 3.2);

  if (G.state === 'menu') {
    G.speed = MAX_SPEED * 0.55;
    G.position = (G.position + G.speed * dt) % trackLength;
    G.playerX = Math.sin(G.clock * 0.35) * 0.28;
    bgPan += (Math.cos(G.clock * 0.35) * 0.001) * dt * 900;
    for (const c of G.cars) { c.z = (c.z + MAX_SPEED * 0.5 * dt) % trackLength; }
    return;
  }
  if (G.state === 'paused') return;

  if (G.state === 'countdown') {
    G.countdown -= dt;
    const n = Math.ceil(G.countdown);
    if (n < G.lastCount) {
      G.lastCount = n;
      if (n > 0) { showMsg(String(n), 'GET READY'); Audio1.blip(520, 0.12, 'square', 0.16); }
      else {
        showMsg('GO!', `${TOTAL_LAPS} LAPS · ${AI_COUNT + 1} CARS`, true);
        Audio1.blip(880, 0.3, 'square', 0.2);
        G.state = 'race';
        flash();
      }
    }
    G.lapClock = 0;
    G.raceClock = 0;
    for (const c of G.cars) c.speed = 0;
    return;
  }

  if (G.state === 'finish') {
    G.speed = Math.max(0, G.speed - 4200 * dt);
    G.position = (G.position + G.speed * dt) % trackLength;
    return;
  }

  /* ---------------- racing ---------------- */
  G.raceClock += dt;
  G.lapClock += dt;

  const seg = findSegment(G.position + playerZ);
  const sp = G.speed / MAX_SPEED;

  // steering
  G.steerT = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  // gamepad
  pollPad();
  const steerRate = 9 + 6 * (1 - sp);
  G.steer += (G.steerT - G.steer) * clamp(dt * steerRate, 0, 1);

  // nitro
  const wantBoost = keys.nitro && G.nitro > 0.02 && G.speed > 1200;
  G.boosting = wantBoost;
  if (G.boosting) {
    G.nitro = Math.max(0, G.nitro - dt * 0.26);
    if (Math.random() < 0.5) {
      G.particles.push({
        x: W / 2 + (Math.random() - 0.5) * W * 0.1, y: H - H * 0.10 + (Math.random() - 0.5) * 20,
        vx: (Math.random() - 0.5) * 120, vy: 180 + Math.random() * 260,
        life: 0.5, max: 0.5, size: 2 + Math.random() * 3, c: '140,220,255', kind: 'smoke',
      });
    }
  } else {
    G.nitro = Math.min(1, G.nitro + dt * 0.072);
  }

  // longitudinal
  const offroad = Math.abs(G.playerX) > 0.96;
  G.offroad = lerp(G.offroad, offroad ? 1 : 0, clamp(dt * 6, 0, 1));
  if (offroad && G.speed > 2500) G.shake = Math.max(G.shake, 0.10);
  const maxNow = MAX_SPEED * (G.boosting ? 1.16 : 1) * (offroad ? 0.44 : 1);
  if (G.countdown <= 0) {
    if (keys.accel || G.boosting) {
      const power = G.boosting ? 12600 : 7200;
      G.speed += power * dt * (1 - clamp(G.speed / maxNow, 0, 1) * 0.72);
    }
    if (keys.brake) G.speed -= 13000 * dt;
    if (!keys.accel && !G.boosting && !keys.brake) G.speed -= 1500 * dt;
    if (offroad) G.speed -= 2800 * dt;
  }
  G.speed = clamp(G.speed, 0, maxNow);
  if (G.speed > G.topSpeed) G.topSpeed = G.speed;

  // lateral
  const steerGain = STEER * (0.34 + 0.8 * Math.min(sp, 1.1));
  G.playerX += G.steer * steerGain * dt;
  G.playerX -= seg.curve * CEN * Math.min(sp, 1.15) ** 2 * dt * 2.6;

  // drift state
  const drifting = Math.abs(G.steer) > 0.55 && sp > 0.55;
  G.drift += ((drifting ? 1 : 0) - G.drift) * clamp(dt * 4, 0, 1);
  if (drifting) {
    G.playerX += G.steer * 0.22 * dt * sp;
    G.speed -= 900 * dt;
  }

  // guard rail
  const limit = 2.4;
  if (Math.abs(G.playerX) > limit) {
    const sign = Math.sign(G.playerX);
    G.playerX = sign * limit;
    const outward = (G.steer * sign) + clamp(seg.curve * -sign * sp * sp * 0.7, -1, 1);
    if (outward > 0.30 && G.speed > 300) {
      G.speed = Math.max(0, G.speed - (3000 + G.speed * 0.9) * dt);
      if (G.wallT <= 0) {
        G.wallT = 0.55;
        G.shake = Math.min(1, G.shake + 0.7);
        Audio1.crash();
        for (let i = 0; i < 10; i++) {
          G.particles.push({
            x: W / 2 + sign * W * 0.16, y: H - H * 0.16,
            vx: -sign * (120 + Math.random() * 260), vy: -Math.random() * 380,
            life: 0.4, max: 0.4, size: 1.4 + Math.random() * 2.2, r: Math.random(), c: '255,210,140', kind: 'spark',
          });
        }
      }
    }
  }
  G.wallT = Math.max(0, G.wallT - dt);

  // position & laps
  G.position += G.speed * dt;
  if (G.position >= trackLength) {
    G.position -= trackLength;
    onLap();
  }

  // gear + rpm
  const gsp = G.speed / MAX_SPEED;
  G.gear = clamp(Math.floor(gsp * 6) + 1, 1, 6);
  const rev = gsp * 6 - Math.floor(gsp * 6);
  G.rpm = 0.16 + rev * 0.84;

  // AI
  for (const c of G.cars) {
    const cs = findSegment(c.z);
    const target = MAX_SPEED * c.base * (1 - Math.min(0.22, Math.abs(cs.curve) * 0.030));
    c.speed += (target - c.speed) * clamp(dt * 1.1, 0, 1);
    c.z += c.speed * dt;
    if (c.z >= trackLength) { c.z -= trackLength; c.lap++; }
    c.offset += Math.sin(G.clock * 0.5 + c.phase) * dt * 0.10;
    c.offset = clamp(c.offset, -0.82, 0.82);
    c.hit = Math.max(0, c.hit - dt);
  }

  // collisions
  const pz = G.position + playerZ;
  for (const c of G.cars) {
    let dz = c.z - pz;
    if (dz > trackLength / 2) dz -= trackLength;
    if (dz < -trackLength / 2) dz += trackLength;
    if (dz > -300 && dz < 800 && Math.abs(c.offset - G.playerX) < 0.52 && G.speed > 500) {
      G.speed *= 0.74;
      G.playerX += (G.playerX >= c.offset ? 1 : -1) * 0.16;
      G.shake = 1;
      c.hit = 0.6;
      Audio1.crash();
      for (let i = 0; i < 16; i++) {
        G.particles.push({
          x: W / 2 + (Math.random() - 0.5) * W * 0.16, y: H - H * 0.16,
          vx: (Math.random() - 0.5) * 600, vy: -Math.random() * 500,
          life: 0.45, max: 0.45, size: 1.5 + Math.random() * 2.5, r: Math.random(), c: '255,200,120', kind: 'spark',
        });
      }
      break;
    }
  }

  // rank
  const prog = (G.lap - 1) * trackLength + G.position;
  let place = 1;
  for (const c of G.cars) if ((c.lap - 1) * trackLength + c.z > prog) place++;
  G.place = place;

  // effects
  const spd = G.speed / MAX_SPEED;
  if (G.offroad > 0.35 && G.speed > 900) {
    for (let i = 0; i < 3; i++) {
      G.particles.push({
        x: W / 2 + (Math.random() - 0.5) * W * 0.2, y: H - H * 0.10,
        vx: (Math.random() - 0.5) * 300, vy: -80 - Math.random() * 220,
        life: 0.6, max: 0.6, size: 6 + Math.random() * 12, c: '170,120,190', kind: 'smoke',
      });
    }
  }
  if (G.drift > 0.5 && G.speed > 4000) {
    for (let i = 0; i < 2; i++) {
      G.particles.push({
        x: W / 2 + (Math.random() - 0.5) * W * 0.22, y: H - H * 0.07,
        vx: (Math.random() - 0.5) * 260, vy: -40 - Math.random() * 160,
        life: 0.7, max: 0.7, size: 8 + Math.random() * 16, c: '210,200,255', kind: 'smoke',
      });
    }
  }
  for (let i = G.particles.length - 1; i >= 0; i--) {
    const p = G.particles[i];
    p.life -= dt;
    if (p.life <= 0) { G.particles.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.98; p.vy *= 0.985;
  }
  if (G.particles.length > 220) G.particles.splice(0, G.particles.length - 220);

  bgPan += seg.curve * spd * dt * 260 + G.steer * spd * dt * 40;

  // audio
  Audio1.engine(G.rpm, spd, keys.accel ? 1 : 0.25, G.offroad > 0.4, G.drift > 0.6);
}

function pollPad() {
  if (!navigator.getGamepads) return;
  const pads = navigator.getGamepads();
  const p = pads && pads[0];
  if (!p) return;
  const ax = p.axes[0] || 0;
  if (Math.abs(ax) > 0.15) { keys.left = ax < -0.15; keys.right = ax > 0.15; }
  if (p.buttons[7] && p.buttons[7].value > 0.2) keys.accel = true;
  if (p.buttons[6] && p.buttons[6].value > 0.2) keys.brake = true;
  if (p.buttons[0] && p.buttons[0].pressed) keys.nitro = true;
}

function onLap() {
  const t = G.lapClock;
  G.lapTimes.push(t);
  if (!G.best || t < G.best) G.best = t;
  G.lapClock = 0;
  Audio1.blip(660, 0.1, 'square', 0.14);
  if (G.lap >= TOTAL_LAPS) { finishRace(); return; }
  G.lap++;
  if (G.lap === TOTAL_LAPS) showMsg('FINAL LAP', fmt(t));
  else showMsg('LAP ' + G.lap, fmt(t));
}

/* ================================================================= FLOW = */
function startRace() {
  Audio1.init(); Audio1.resume();
  resetRace();
  ui.menu.classList.add('hidden');
  ui.results.classList.add('hidden');
  ui.pause.classList.add('hidden');
  ui.hud.classList.remove('hidden');
  setTouchVisible(true);
  G.state = 'countdown';
  G.countdown = 3.6; G.lastCount = 4;
  showMsg('3', 'GET READY');
  Audio1.blip(520, 0.12, 'square', 0.16);
  lastLapTxt = lastPosTxt = lastLapTimeTxt = lastBestTxt = ''; lastPlace = 0;
}
function finishRace() {
  G.state = 'finish';
  G.finished = true;
  const total = G.lapTimes.reduce((a, b) => a + b, 0);
  const best = Math.min(...G.lapTimes.filter(Boolean), Infinity);
  ui.resTitle.innerHTML = `P${G.place}<small> / ${AI_COUNT + 1}</small>`;
  ui.resKicker.textContent = G.place === 1 ? 'RACE WINNER' : 'RACE COMPLETE';
  ui.resTotal.textContent = fmt(total);
  ui.resBest.textContent = fmt(isFinite(best) ? best : 0);
  ui.resTop.textContent = Math.round(G.topSpeed / MAX_SPEED * KMH) + ' km/h';
  ui.resLaps.innerHTML = G.lapTimes.map((t, i) =>
    `<div class="row ${t === best && G.lapTimes.length > 1 ? 'best' : ''}"><span>LAP ${i + 1}</span><span>${fmt(t)}</span></div>`
  ).join('') + `<div class="row"><span>BEST</span><span>${fmt(isFinite(best) ? best : 0)}</span></div>`;
  ui.results.classList.remove('hidden');
  setTouchVisible(false);
  flash();
  Audio1.blip(720, 0.16, 'square', 0.16);
  setTimeout(() => Audio1.blip(960, 0.3, 'square', 0.16), 140);
}
function togglePause() {
  if (G.state === 'race') {
    G.state = 'paused';
    ui.pause.classList.remove('hidden');
    for (const k in keys) keys[k] = false;
  } else if (G.state === 'paused') {
    G.state = 'race';
    ui.pause.classList.add('hidden');
  }
}
function toMenu() {
  G.state = 'menu';
  ui.pause.classList.add('hidden');
  ui.results.classList.add('hidden');
  ui.hud.classList.add('hidden');
  setTouchVisible(false);
  ui.menu.classList.remove('hidden');
}

/* ================================================================= BOOT = */
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.max(2, Math.round(W * DPR));
  canvas.height = Math.max(2, Math.round(H * DPR));
  horizonY = Math.round(H * 0.47);
  gaugeCv.width = 260 * DPR; gaugeCv.height = 260 * DPR;
  mapCv.width = 200 * DPR; mapCv.height = 200 * DPR;
  buildBackground();
  buildGaugeStatic();
  buildMapPath();
}

function bindUI() {
  $('startBtn').addEventListener('click', startRace);
  $('resumeBtn').addEventListener('click', togglePause);
  $('quitBtn').addEventListener('click', toMenu);
  $('againBtn').addEventListener('click', startRace);
  $('menuBtn').addEventListener('click', toMenu);
  document.querySelectorAll('.swatch').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.swatch').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      G.paint = +b.dataset.paint;
    });
  });
  addEventListener('resize', resize);
  addEventListener('orientationchange', () => setTimeout(resize, 120));
  document.addEventListener('visibilitychange', () => { if (document.hidden && G.state === 'race') togglePause(); });
  addEventListener('pointerdown', () => { Audio1.init(); Audio1.resume(); }, { once: true });
}

let lastT = 0;
function frame(now) {
  if (!lastT) lastT = now;
  let dt = (now - lastT) / 1000;
  lastT = now;
  dt = Math.min(dt, 1 / 20);
  if (G.state === 'race' || G.state === 'countdown') updateHUD();
  update(dt);
  const t0 = performance.now();
  render();
  const rms = performance.now() - t0;
  G.renderMs = G.renderMs ? G.renderMs * 0.92 + rms * 0.08 : rms;
  G.frames++;
  G.fpsT += dt;
  if (G.fpsT > 0.5) {
    G.fps = G.frames / G.fpsT;
    G.frames = 0; G.fpsT = 0;
    const f = $('fps');
    if (f && f.style.display === 'block') f.textContent = `${Math.round(G.fps)} FPS · ${G.renderMs.toFixed(1)} ms`;
  }
  requestAnimationFrame(frame);
}

function boot() {
  buildTrack();
  buildSprites();
  buildPlayerImgs();
  decorate();
  resize();
  initCars();
  bindInput();
  bindUI();
  // attract-mode starting point
  G.position = 6000;
  requestAnimationFrame(frame);
  window.__ND = { G, segments, trackLength: () => trackLength, startRace, keys, toMenu, Audio1 };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})();
