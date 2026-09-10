/**
 * Керування: хрестовина зі стрілок + кнопки A/B/C/D, повний мультитач,
 * дублююча клавіатура. Логіка перенесена з версії 1.x без змін, додано
 * лише відступи під безпечну зону екрана (виріз камери).
 */
import { CONFIG, clamp, sign } from './config.js';
import { Store } from './store.js';
import { Sfx, buzz } from './audio.js';

export const Input = (function () {
  const el = {
    layer: document.getElementById('touch'),
    dpad: document.getElementById('dpad'),
    U: document.getElementById('dpU'), D: document.getElementById('dpD'),
    L: document.getElementById('dpL'), R: document.getElementById('dpR'),
    A: document.getElementById('btnA'), B: document.getElementById('btnB'),
    C: document.getElementById('btnC'), Dash: document.getElementById('btnD'),
    pause: document.getElementById('btnPause')
  };

  const kb = { l: 0, r: 0, d: 0, u: 0, a: 0, b: 0, c: 0 };
  const dir = { l: 0, r: 0, u: 0, d: 0 };          // стан хрестовини
  const tc = { a: 0, b: 0, c: 0 };                 // стан кнопок дій
  const held = { a: 0, b: 0, c: 0 };
  const prev = { a: 0, b: 0, c: 0 };
  const btnPos = { A: { x: 0, y: 0, r: 34 }, B: { x: 0, y: 0, r: 34 },
                   C: { x: 0, y: 0, r: 34 }, Dash: { x: 0, y: 0, r: 23 } };
  const pad = { x: 0, y: 0, half: 75, dead: 16 };
  const pauseBox = { x: 0, y: 0, w: 44, h: 44 };

  const ptrs = new Map();
  let dashQ = false, dashDir = 0, pauseQ = false, enabled = false;

  const S = {
    ax: 0, down: false,
    a: false, b: false, c: false,
    aP: false, bP: false, cP: false,
    aR: false, bR: false, cR: false,
    dashP: false, dashDir: 0, pauseP: false
  };

  const SCALE = { S: 0.85, M: 1, L: 1.15 };

  // Відступи безпечної зони (виріз камери / жестова смуга): читаємо з
  // елемента-проби, якому в CSS задано padding: env(safe-area-inset-*).
  const SIDE = { l: 'paddingLeft', r: 'paddingRight', t: 'paddingTop', b: 'paddingBottom' };
  function safeInset(side) {
    const el = document.getElementById('safeProbe');
    if (!el) return 0;
    const n = parseFloat(getComputedStyle(el)[SIDE[side]]);
    return isFinite(n) ? n : 0;
  }
  function layout() {
    const k = SCALE[Store.data.size] || 1;
    const sl = safeInset('l'), sr = safeInset('r'), sb = safeInset('b');
    const W = window.innerWidth - sl - sr, H = window.innerHeight - sb;
    const mir = Store.data.hand ? -1 : 1;          // 1 = хрестовина ліворуч
    const edge = CONFIG.DPAD_EDGE;
    const OX = sl;                                 // зсув усього керування вправо на виріз

    // --- хрестовина ---
    const size = CONFIG.DPAD * k;
    const px = OX + (mir > 0 ? (edge + size / 2) : (W - edge - size / 2));
    const py = H - edge - size / 2;
    pad.x = px; pad.y = py; pad.half = size / 2; pad.dead = CONFIG.DPAD_DEAD * k;
    el.dpad.style.width = size + 'px'; el.dpad.style.height = size + 'px';
    el.dpad.style.left = (px - size / 2) + 'px';
    el.dpad.style.top = (py - size / 2) + 'px';

    // --- кнопки дій ромбом: A знизу, B збоку, C зверху, D (ривок) навпроти B ---
    const d = CONFIG.BTN * k, gap = CONFIG.BTN_GAP * k, dd = CONFIG.BTN_DASH * k;
    const rad = (d + gap) / Math.SQRT2;
    const cx = OX + (mir > 0 ? (W - edge - rad - d / 2) : (edge + rad + d / 2));
    const cy = H - edge - rad - d / 2;
    btnPos.A.x = cx;             btnPos.A.y = cy + rad;  btnPos.A.r = d / 2;
    btnPos.C.x = cx;             btnPos.C.y = cy - rad;  btnPos.C.r = d / 2;
    btnPos.B.x = cx - mir * rad; btnPos.B.y = cy;        btnPos.B.r = d / 2;
    btnPos.Dash.x = cx + mir * rad; btnPos.Dash.y = cy;  btnPos.Dash.r = dd / 2;
    place('A', d); place('B', d); place('C', d); place('Dash', dd);

    pauseBox.x = OX + W - 8 - 44; pauseBox.y = 8 + safeInset('t');
    el.pause.style.left = pauseBox.x + 'px'; el.pause.style.top = pauseBox.y + 'px';
    el.layer.style.setProperty('--ctlop', (Store.data.op || 55) / 100);
  }
  function place(key, size) {
    const p = btnPos[key], e = el[key];
    e.style.width = size + 'px'; e.style.height = size + 'px';
    e.style.left = (p.x - size / 2) + 'px'; e.style.top = (p.y - size / 2) + 'px';
  }

  // Напрямки хрестовини за положенням пальця. bounded=false — палець уже
  // «володіє» хрестовиною, тож дозволяємо вести його скільки завгодно далеко.
  function padDirs(x, y, bounded) {
    const ax = x - pad.x, ay = y - pad.y;
    if (bounded) {
      const hx = pad.half * CONFIG.DPAD_HIT;       // хітбокс на 25% більший
      if (Math.abs(ax) > hx || Math.abs(ay) > hx) return null;
    }
    return { l: ax < -pad.dead ? 1 : 0, r: ax > pad.dead ? 1 : 0,
             u: ay < -pad.dead ? 1 : 0, d: ay > pad.dead ? 1 : 0 };
  }
  function applyDirs(nd) {
    const was = dir.l | dir.r | dir.u | dir.d;
    const fresh = (nd.l && !dir.l) || (nd.r && !dir.r) || (nd.u && !dir.u) || (nd.d && !dir.d);
    dir.l = nd.l; dir.r = nd.r; dir.u = nd.u; dir.d = nd.d;
    el.L.classList.toggle('hit', !!dir.l);
    el.R.classList.toggle('hit', !!dir.r);
    el.U.classList.toggle('hit', !!dir.u);
    el.D.classList.toggle('hit', !!dir.d);
    if (fresh) buzz(10);                            // легкий відгук на нову стрілку
  }
  function clearDirs() {
    dir.l = dir.r = dir.u = dir.d = 0;
    el.L.classList.remove('hit'); el.R.classList.remove('hit');
    el.U.classList.remove('hit'); el.D.classList.remove('hit');
  }
  function inBtn(k, x, y) {
    const p = btnPos[k], dx = x - p.x, dy = y - p.y;
    return dx * dx + dy * dy <= (p.r * 1.22) * (p.r * 1.22);
  }
  function setBtnVisual(k, on) { el[k].classList.toggle('hit', !!on); }

  function down(id, x, y) {
    if (!enabled) return;
    if (x >= pauseBox.x && x <= pauseBox.x + pauseBox.w && y >= pauseBox.y && y <= pauseBox.y + pauseBox.h) {
      pauseQ = true; ptrs.set(id, { kind: 'pause' }); return;
    }
    if (inBtn('Dash', x, y)) {                      // окрема кнопка ривка
      ptrs.set(id, { kind: 'Dash' });
      setBtnVisual('Dash', true);
      dashQ = true; dashDir = 0;
      return;
    }
    for (const k of ['A', 'B', 'C']) {
      if (inBtn(k, x, y)) {
        ptrs.set(id, { kind: k });
        tc[k.toLowerCase()] = 1; setBtnVisual(k, true);
        return;
      }
    }
    const nd = padDirs(x, y, true);
    if (nd) { ptrs.set(id, { kind: 'pad' }); applyDirs(nd); }
    else ptrs.set(id, { kind: 'none' });
  }
  function move(id, x, y) {
    const p = ptrs.get(id);
    if (!p) return;
    if (p.kind === 'pad') {
      applyDirs(padDirs(x, y, false));              // ковзання ← -> → без відриву
    } else if (p.kind === 'A' || p.kind === 'B' || p.kind === 'C') {
      if (!inBtn(p.kind, x, y)) {
        tc[p.kind.toLowerCase()] = 0; setBtnVisual(p.kind, false);
        ptrs.set(id, { kind: 'none' });
      }
    }
  }
  function up(id) {
    const p = ptrs.get(id);
    ptrs.delete(id);
    if (!p) return;
    if (p.kind === 'pad') clearDirs();
    else if (p.kind === 'Dash') setBtnVisual('Dash', false);
    else if (p.kind === 'A' || p.kind === 'B' || p.kind === 'C') {
      tc[p.kind.toLowerCase()] = 0; setBtnVisual(p.kind, false);
    }
  }

  const L = el.layer;
  L.addEventListener('pointerdown', e => { e.preventDefault(); Sfx.resume(); down(e.pointerId, e.clientX, e.clientY); });
  L.addEventListener('pointermove', e => { e.preventDefault(); move(e.pointerId, e.clientX, e.clientY); });
  L.addEventListener('pointerup', e => { e.preventDefault(); up(e.pointerId); });
  L.addEventListener('pointercancel', e => { up(e.pointerId); });
  L.addEventListener('pointerleave', e => { up(e.pointerId); });
  L.addEventListener('contextmenu', e => e.preventDefault());
  // блокуємо зум подвійним тапом і жести масштабування
  document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });
  document.addEventListener('gesturestart', e => e.preventDefault(), { passive: false });
  document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

  const KEYS = {
    ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r', ArrowDown: 'd', KeyS: 'd',
    ArrowUp: 'u', KeyW: 'u', Space: 'a', KeyK: 'a', KeyJ: 'b', KeyL: 'c'
  };
  window.addEventListener('keydown', e => {
    if (e.repeat) return;
    Sfx.resume();
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { dashQ = true; dashDir = 0; e.preventDefault(); return; }
    if (e.code === 'Escape' || e.code === 'KeyP') { pauseQ = true; e.preventDefault(); return; }
    const k = KEYS[e.code];
    if (k) { kb[k] = 1; e.preventDefault(); }
  });
  window.addEventListener('keyup', e => {
    const k = KEYS[e.code];
    if (k) { kb[k] = 0; e.preventDefault(); }
  });
  window.addEventListener('blur', () => {
    kb.l = kb.r = kb.d = kb.u = kb.a = kb.b = kb.c = 0;
    tc.a = tc.b = tc.c = 0;
    ptrs.clear(); clearDirs();
    ['A', 'B', 'C', 'Dash'].forEach(k => setBtnVisual(k, false));
  });

  return {
    S: S,
    kb: kb,
    btn: btnPos,
    pad: pad,
    layout: layout,
    enable(on) {
      enabled = !!on;
      el.layer.classList.toggle('on', !!on);
      if (!on) {
        tc.a = tc.b = tc.c = 0;
        ptrs.clear(); clearDirs();
        ['A', 'B', 'C', 'Dash'].forEach(k => setBtnVisual(k, false));
      }
    },
    // Викликається на кожному фіксованому кроці фізики: рахує фронти.
    step() {
      const l = kb.l || dir.l, r = kb.r || dir.r;
      S.ax = (r ? 1 : 0) - (l ? 1 : 0);
      S.down = !!(kb.d || dir.d);
      held.a = (kb.a || kb.u || tc.a || dir.u) ? 1 : 0;   // ↑ дублює кнопку A
      held.b = (kb.b || tc.b) ? 1 : 0;
      held.c = (kb.c || tc.c) ? 1 : 0;
      S.a = !!held.a; S.b = !!held.b; S.c = !!held.c;
      S.aP = !!(held.a && !prev.a); S.bP = !!(held.b && !prev.b); S.cP = !!(held.c && !prev.c);
      S.aR = !!(!held.a && prev.a); S.bR = !!(!held.b && prev.b); S.cR = !!(!held.c && prev.c);
      prev.a = held.a; prev.b = held.b; prev.c = held.c;
      S.dashP = dashQ; S.dashDir = dashDir; dashQ = false;
    },
    consumePause() { const p = pauseQ; pauseQ = false; return p; },
    clearEdges() { S.aP = S.bP = S.cP = S.aR = S.bR = S.cR = S.dashP = false; }
  };
})();
