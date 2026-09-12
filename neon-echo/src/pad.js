/**
 * Розкладка керування: КОЖЕН елемент окремо.
 *
 * До цього налаштування були спільні для груп — «прозорість стрілок»,
 * «розмір кнопок». Тепер у ←, →, A, B, C, D, паузи й DBG своя позиція,
 * свій розмір, своя прозорість, форма, підпис і вібрація.
 *
 * Живе у ВЛАСНОМУ ключі localStorage, а не в слоті прогресу. Це не
 * дрібниця: «Скинути прогрес» не має стирати розкладку, яку гравець
 * підганяв під свою руку, а перехід на нову версію гри не має її
 * ламати — тому ключ із номером схеми й м'яке читання будь-якого
 * стороннього вмісту.
 */
import { CONFIG, clamp } from './config.js';

export const PAD_KEY = 'echo_neon_courier_pad_v1';

/** Порядок обходу: ним же перемикається вибір у редакторі. */
export const ELEMS = ['L', 'R', 'A', 'B', 'C', 'D', 'pause', 'dbg'];

export const ELNAME = {
  L: 'Стрілка ←', R: 'Стрілка →', A: 'A · стрибок', B: 'B · клинок',
  C: 'C · постріл', D: 'D · ривок', pause: 'Пауза', dbg: 'DBG'
};

/** Розмір при 100 % і рідна форма. `cap` — чи є в елемента підпис. */
export const ELBASE = {
  L:     { w: CONFIG.ARROW_W, h: CONFIG.ARROW_H, shape: 'tri',   cap: 0, svg: 1 },
  R:     { w: CONFIG.ARROW_W, h: CONFIG.ARROW_H, shape: 'tri',   cap: 0, svg: 1 },
  A:     { w: CONFIG.BTN,      h: CONFIG.BTN,      shape: 'round', cap: 1 },
  B:     { w: CONFIG.BTN,      h: CONFIG.BTN,      shape: 'round', cap: 1 },
  C:     { w: CONFIG.BTN,      h: CONFIG.BTN,      shape: 'round', cap: 1 },
  D:     { w: CONFIG.BTN_DASH, h: CONFIG.BTN_DASH, shape: 'round', cap: 1 },
  pause: { w: 44, h: 44, shape: 'square', cap: 0 },
  dbg:   { w: 40, h: 26, shape: 'square', cap: 0 }
};

/** Один елемент у стані «як задумано»: null у позиції = штатне місце. */
function defElem(k) {
  return { x: null, y: null, s: 100, op: 55, shape: null, lab: 1, vib: 1, hide: 0 };
}
function defProfile(name) {
  const el = {};
  for (const k of ELEMS) el[k] = defElem(k);
  return { name: name, hand: 0, el: el };
}

/* ------------------------------------------------------------------ ПРЕСЕТИ
   Пресет — це не «розмір S/M/L», а готова розкладка: він задає всім
   елементам розміри, прозорості й (де треба) позиції. Далі гравець
   доправляє під себе поелементно. */
export const PRESETS = {
  standard: { name: 'Стандарт', hand: 0, all: { s: 100, op: 55, lab: 1, hide: 0, shape: null, x: null, y: null } },
  lefty:    { name: 'Для лівші', hand: 1, all: { s: 100, op: 55, lab: 1, hide: 0, shape: null, x: null, y: null } },
  big:      { name: 'Великі кнопки', hand: 0,
              all: { op: 70, lab: 1, hide: 0, shape: null, x: null, y: null },
              per: { L: { s: 140 }, R: { s: 140 }, A: { s: 145 }, B: { s: 145 },
                     C: { s: 145 }, D: { s: 135 }, pause: { s: 110 }, dbg: { s: 100 } } },
  minimal:  { name: 'Мінімалізм', hand: 0,
              all: { op: 30, lab: 0, hide: 0, shape: null, x: null, y: null },
              per: { L: { s: 85 }, R: { s: 85 }, A: { s: 90 }, B: { s: 90 },
                     C: { s: 90 }, D: { s: 80 }, pause: { s: 85 }, dbg: { s: 85 } } }
};

const state = {
  prof: 0,
  profs: [defProfile('Профіль 1'), defProfile('Профіль 2'), defProfile('Профіль 3')]
};

/* ------------------------------------------------------- ЧИТАННЯ / ЗАПИС */
const num = (v, lo, hi, d) => {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  return isFinite(n) ? clamp(n, lo, hi) : d;
};
const frac = v => (typeof v === 'number' && isFinite(v) && v >= -0.5 && v <= 1.5) ? v : null;

/** Чуже/старе/побите значення не має валити гру — беремо що впізнали. */
function readElem(o) {
  const e = defElem();
  if (!o || typeof o !== 'object') return e;
  e.x = frac(o.x); e.y = frac(o.y);
  e.s = num(o.s, 60, 200, 100);
  e.op = num(o.op, 20, 100, 55);
  e.shape = (o.shape === 'round' || o.shape === 'square' || o.shape === 'tri') ? o.shape : null;
  e.lab = o.lab === undefined ? 1 : (o.lab ? 1 : 0);
  e.vib = o.vib === undefined ? 1 : (o.vib ? 1 : 0);
  e.hide = o.hide ? 1 : 0;
  return e;
}
function readProfile(o, i) {
  const p = defProfile('Профіль ' + (i + 1));
  if (!o || typeof o !== 'object') return p;
  if (typeof o.name === 'string' && o.name.trim()) p.name = o.name.slice(0, 20);
  p.hand = o.hand ? 1 : 0;
  for (const k of ELEMS) p.el[k] = readElem(o.el && o.el[k]);
  return p;
}
function readState(o) {
  if (!o || typeof o !== 'object') return;
  const src = Array.isArray(o.profs) ? o.profs : [];
  state.profs = [0, 1, 2].map(i => readProfile(src[i], i));
  state.prof = num(o.prof, 0, 2, 0);
}

export const Pad = {
  get state() { return state; },
  /** Поточний профіль. */
  get cur() { return state.profs[state.prof] || state.profs[0]; },
  /** Налаштування одного елемента в поточному профілі. */
  el(k) { return this.cur.el[k] || defElem(k); },
  get hand() { return this.cur.hand ? 1 : 0; },
  set hand(v) { this.cur.hand = v ? 1 : 0; },

  load() {
    try {
      const raw = localStorage.getItem(PAD_KEY);
      if (raw) readState(JSON.parse(raw));
    } catch (e) { /* приватний режим — граємо зі стандартною розкладкою */ }
    return state;
  },
  save() {
    try { localStorage.setItem(PAD_KEY, JSON.stringify(state)); } catch (e) { }
  },
  pick(i) { state.prof = clamp(i | 0, 0, 2); this.save(); },

  /** Скинути один елемент до стандарту. */
  resetElem(k) { this.cur.el[k] = defElem(k); this.save(); },
  /** Скинути весь профіль. */
  resetProfile() {
    const n = this.cur.name;
    state.profs[state.prof] = defProfile(n);
    this.save();
  },
  /** Застосувати пресет до поточного профілю. */
  preset(id) {
    const p = PRESETS[id] || PRESETS.standard;
    const prof = defProfile(p.name);
    prof.hand = p.hand ? 1 : 0;
    for (const k of ELEMS) {
      Object.assign(prof.el[k], p.all || {});
      if (p.per && p.per[k]) Object.assign(prof.el[k], p.per[k]);
    }
    state.profs[state.prof] = prof;
    this.save();
    return p.name;
  },

  /* --------------------------------------------------- ЕКСПОРТ / ІМПОРТ
     Один рядок, який можна переслати або записати. base64 від JSON:
     читати очима не треба, а вставити в поле — треба. */
  exportStr() {
    const p = this.cur;
    const packed = { v: 1, name: p.name, hand: p.hand, el: {} };
    for (const k of ELEMS) {
      const e = p.el[k], d = defElem(k), o = {};
      for (const f of ['x', 'y', 's', 'op', 'shape', 'lab', 'vib', 'hide'])
        if (e[f] !== d[f]) o[f] = e[f];
      if (Object.keys(o).length) packed.el[k] = o;
    }
    let json = JSON.stringify(packed);
    try { return 'ECHO1:' + btoa(unescape(encodeURIComponent(json))); }
    catch (e) { return 'ECHO1:' + json; }
  },
  /** Повертає true, якщо рядок упізнано й застосовано. */
  importStr(str) {
    if (typeof str !== 'string') return false;
    const s = str.trim().replace(/^ECHO1:/, '');
    if (!s) return false;
    let o = null;
    try { o = JSON.parse(decodeURIComponent(escape(atob(s)))); }
    catch (e) { try { o = JSON.parse(s); } catch (e2) { return false; } }
    if (!o || typeof o !== 'object') return false;
    const keep = this.cur.name;
    state.profs[state.prof] = readProfile(o, state.prof);
    if (!o.name) state.profs[state.prof].name = keep;
    this.save();
    return true;
  }
};

/* --------------------------------------------------------- ПЕРЕКРИТТЯ
   Дві кнопки на одному місці — це не «незручно», це непрацездатна
   розкладка: палець потрапляє в ту, що вище в порядку перевірки, і
   друга не натискається ніколи.

   Перевірка рахує ФОРМУ, а не габаритну коробку. Це не педантизм:
   A/B/C/D стоять ромбом, і в сусідніх по діагоналі кружків коробки
   перетинаються, хоча самі кружки не торкаються. За коробками
   стандартна розкладка світилась би червоним із коробки.

   Міряємо візуал, а не хітбокс: хітбокси свідомо більші й трохи
   налізають один на одного навіть там, де все гаразд. */
function isRound(g) { return g.shape === 'round'; }
function hitShapes(a, b) {
  const ar = Math.min(a.w, a.h) / 2, br = Math.min(b.w, b.h) / 2;
  if (isRound(a) && isRound(b)) {                    // коло-коло
    const dx = a.x - b.x, dy = a.y - b.y;
    return dx * dx + dy * dy < (ar + br - 1) * (ar + br - 1);
  }
  if (isRound(a) || isRound(b)) {                    // коло-прямокутник
    const c = isRound(a) ? a : b, r = isRound(a) ? ar : br, q = isRound(a) ? b : a;
    const nx = Math.max(q.x - q.w / 2, Math.min(c.x, q.x + q.w / 2));
    const ny = Math.max(q.y - q.h / 2, Math.min(c.y, q.y + q.h / 2));
    const dx = c.x - nx, dy = c.y - ny;
    return dx * dx + dy * dy < (r - 1) * (r - 1);
  }
  return Math.abs(a.x - b.x) * 2 < (a.w + b.w) - 2 &&
         Math.abs(a.y - b.y) * 2 < (a.h + b.h) - 2;   // прямокутник-прямокутник
}
export function overlaps(geo) {
  const bad = new Set();
  const ks = ELEMS.filter(k => geo[k] && !geo[k].hide);
  for (let i = 0; i < ks.length; i++)
    for (let j = i + 1; j < ks.length; j++)
      if (hitShapes(geo[ks[i]], geo[ks[j]])) { bad.add(ks[i]); bad.add(ks[j]); }
  return bad;
}
