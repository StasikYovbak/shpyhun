/**
 * Керування: дві великі стрілки ← → + кнопки A/B/C/D, повний мультитач,
 * дублююча клавіатура. Стрілок «вгору» і «вниз» немає: стрибок живе на A,
 * спуск крізь тонкі платформи — утримання A. Відступи враховують
 * безпечну зону екрана (виріз камери).
 */
import { CONFIG, clamp, sign } from './config.js';
import { Store } from './store.js';
import { Sfx, buzz } from './audio.js';

export const Input = (function () {
  const el = {
    layer: document.getElementById('touch'),
    dpad: document.getElementById('dpad'),
    L: document.getElementById('dpL'), R: document.getElementById('dpR'),
    A: document.getElementById('btnA'), B: document.getElementById('btnB'),
    C: document.getElementById('btnC'), Dash: document.getElementById('btnD'),
    pause: document.getElementById('btnPause')
  };

  const kb = { l: 0, r: 0, u: 0, a: 0, b: 0, c: 0 };
  const dir = { l: 0, r: 0 };                      // стан стрілок
  const tc = { a: 0, b: 0, c: 0 };                 // стан кнопок дій
  const held = { a: 0, b: 0, c: 0 };
  const prev = { a: 0, b: 0, c: 0 };
  const btnPos = { A: { x: 0, y: 0, r: 34, hit: 42 }, B: { x: 0, y: 0, r: 34, hit: 42 },
                   C: { x: 0, y: 0, r: 34, hit: 42 }, Dash: { x: 0, y: 0, r: 23, hit: 29 } };
  // Геометрія двох стрілок: спільна коробка + межа між ними.
  const pad = { x: 0, y: 0, w: 190, h: 120, hit: 1.3, mir: 1 };
  const pauseBox = { x: 0, y: 0, w: 44, h: 44 };
  const box = { pad: { x: 0, y: 0, w: 0, h: 0 }, btn: { x: 0, y: 0, w: 0, h: 0 } };

  const ptrs = new Map();
  let dashQ = false, dashDir = 0, pauseQ = false, enabled = false;
  let preview = false, drag = null, onMoved = null;

  const S = {
    ax: 0,
    a: false, b: false, c: false,
    aP: false, bP: false, cP: false,
    aR: false, bR: false, cR: false,
    dashP: false, dashDir: 0, pauseP: false
  };

  // Пресети розміру лишаються, але тепер це просто пари значень повзунків.
  const SCALE = { S: 0.85, M: 1, L: 1.15 };
  const PRESETS = {
    default: { dpadSize: 100, btnSize: 100, dpadOp: 55, btnOp: 55, dpadPos: null, btnPos: null },
    big:     { dpadSize: 140, btnSize: 135, dpadOp: 70, btnOp: 70, dpadPos: null, btnPos: null },
    compact: { dpadSize: 78,  btnSize: 82,  dpadOp: 45, btnOp: 50, dpadPos: null, btnPos: null },
    lefty:   { dpadSize: 100, btnSize: 100, dpadOp: 55, btnOp: 55, dpadPos: null, btnPos: null, hand: 1 }
  };

  // Відступи безпечної зони (виріз камери / жестова смуга): читаємо з
  // елемента-проби, якому в CSS задано padding: env(safe-area-inset-*).
  const SIDE = { l: 'paddingLeft', r: 'paddingRight', t: 'paddingTop', b: 'paddingBottom' };
  function safeInset(side) {
    const el = document.getElementById('safeProbe');
    if (!el) return 0;
    const n = parseFloat(getComputedStyle(el)[SIDE[side]]);
    return isFinite(n) ? n : 0;
  }
  // Обидва блоки мають власний розмір (70..160%), прозорість (20..100%)
  // і — за бажанням — власне місце. Позиція зберігається в частках
  // безпечної зони, тож переживає поворот екрана й іншу роздільність.
  function layout() {
    const D = Store.data;
    const kd = clamp(D.dpadSize || 100, 70, 160) / 100;
    const kb2 = clamp(D.btnSize || 100, 70, 160) / 100;
    const sl = safeInset('l'), sr = safeInset('r'), sb = safeInset('b');
    const W = window.innerWidth - sl - sr, H = window.innerHeight - sb;
    const mir = D.hand ? -1 : 1;                   // 1 = стрілки ліворуч
    const edge = CONFIG.DPAD_EDGE;
    const OX = sl;                                 // зсув усього керування вправо на виріз

    // --- дві стрілки ← → ---
    const aw = CONFIG.ARROW_W * kd, ah = CONFIG.ARROW_H * kd, gap = CONFIG.ARROW_GAP * kd;
    const bw = aw * 2 + gap, bh = ah;               // спільна коробка обох стрілок
    let px = OX + (mir > 0 ? (edge + bw / 2) : (W - edge - bw / 2));
    let py = H - edge - bh / 2;
    if (D.dpadPos) { px = OX + D.dpadPos.x * W; py = D.dpadPos.y * H; }
    px = clamp(px, OX + bw / 2 + 2, OX + W - bw / 2 - 2);
    py = clamp(py, bh / 2 + 2, H - bh / 2 - 2);
    pad.x = px; pad.y = py; pad.w = bw; pad.h = bh; pad.mir = mir;
    // хітбокс на 30% більший за візуал і ніколи не менший за базовий
    pad.hit = CONFIG.DPAD_HIT;
    pad.hw = Math.max(bw, CONFIG.ARROW_W * 2 + CONFIG.ARROW_GAP) * pad.hit / 2;
    pad.hh = Math.max(bh, CONFIG.ARROW_H) * pad.hit / 2;
    el.dpad.style.width = bw + 'px'; el.dpad.style.height = bh + 'px';
    el.dpad.style.left = (px - bw / 2) + 'px';
    el.dpad.style.top = (py - bh / 2) + 'px';
    box.pad.x = px - bw / 2; box.pad.y = py - bh / 2; box.pad.w = bw; box.pad.h = bh;

    // --- кнопки дій ромбом: A знизу, B збоку, C зверху, D (ривок) навпроти B ---
    const d = CONFIG.BTN * kb2, bgap = CONFIG.BTN_GAP * kb2, dd = CONFIG.BTN_DASH * kb2;
    const rad = (d + bgap) / Math.SQRT2;
    const half = rad + d / 2;
    let cx = OX + (mir > 0 ? (W - edge - half) : (edge + half));
    let cy = H - edge - half;
    if (D.btnPos) { cx = OX + D.btnPos.x * W; cy = D.btnPos.y * H; }
    cx = clamp(cx, OX + half + 2, OX + W - half - 2);
    cy = clamp(cy, half + 2, H - half - 2);
    btnPos.A.x = cx;             btnPos.A.y = cy + rad;  btnPos.A.r = d / 2;
    btnPos.C.x = cx;             btnPos.C.y = cy - rad;  btnPos.C.r = d / 2;
    btnPos.B.x = cx - mir * rad; btnPos.B.y = cy;        btnPos.B.r = d / 2;
    btnPos.Dash.x = cx + mir * rad; btnPos.Dash.y = cy;  btnPos.Dash.r = dd / 2;
    btnPos.A.hit = btnPos.B.hit = btnPos.C.hit = Math.max(d, CONFIG.BTN) / 2 * 1.25;
    btnPos.Dash.hit = Math.max(dd, CONFIG.BTN_DASH) / 2 * 1.25;
    place('A', d); place('B', d); place('C', d); place('Dash', dd);
    box.btn.x = cx - half; box.btn.y = cy - half; box.btn.w = half * 2; box.btn.h = half * 2;

    pauseBox.x = OX + W - 8 - 44; pauseBox.y = 8 + safeInset('t');
    el.pause.style.left = pauseBox.x + 'px'; el.pause.style.top = pauseBox.y + 'px';
    el.layer.style.setProperty('--dpadop', clamp(D.dpadOp || 55, 20, 100) / 100);
    el.layer.style.setProperty('--btnop', clamp(D.btnOp || 55, 20, 100) / 100);
  }
  // Пресет розкладки: значення повзунків + скидання ручних позицій.
  function applyPreset(name) {
    const p = PRESETS[name] || PRESETS.default;
    for (const k of Object.keys(p)) Store.data[k] = p[k];
    if (name !== 'lefty') Store.data.hand = 0;
    Store.data.size = 'M'; Store.data.op = Store.data.btnOp;
    layout();
  }
  function place(key, size) {
    const p = btnPos[key], e = el[key];
    e.style.width = size + 'px'; e.style.height = size + 'px';
    e.style.left = (p.x - size / 2) + 'px'; e.style.top = (p.y - size / 2) + 'px';
  }

  /**
   * Яка стрілка під пальцем. bounded=false — палець уже «володіє» блоком
   * стрілок, тож ведемо його скільки завгодно далеко.
   *
   * Хітбокс на 30 % ширший і вищий за візуал, а ще нахилений усередину:
   * великий палець крутиться навколо нижнього кута екрана й угору йде
   * по дузі, а не по прямій, тож верх зони зсунуто до центра екрана.
   * Межа між ← і → нахилена так само, тому ковзання з однієї стрілки на
   * другу без відриву працює на будь-якій висоті.
   */
  function padDirs(x, y, bounded) {
    const ay = y - pad.y;
    const ax = x - pad.x + ay * CONFIG.DPAD_TILT * pad.mir;
    if (bounded && (Math.abs(ax) > pad.hw || Math.abs(ay) > pad.hh)) return null;
    return { l: ax < 0 ? 1 : 0, r: ax > 0 ? 1 : 0 };
  }
  function applyDirs(nd) {
    const fresh = (nd.l && !dir.l) || (nd.r && !dir.r);
    dir.l = nd.l; dir.r = nd.r;
    el.L.classList.toggle('hit', !!dir.l);
    el.R.classList.toggle('hit', !!dir.r);
    if (fresh) buzz(10);                            // легкий відгук на нову стрілку
  }
  function clearDirs() {
    dir.l = dir.r = 0;
    el.L.classList.remove('hit'); el.R.classList.remove('hit');
  }
  /**
   * Повне обнулення вводу. Викликається звідусіль, де палець може
   * зникнути повз наші обробники: blur, visibilitychange, згортання
   * застосунку, пауза, втрата захоплення вказівника. Без цього ОС їсть
   * pointerup при згортанні — і напрямок лишається натиснутим назавжди.
   */
  function resetInput() {
    kb.l = kb.r = kb.u = kb.a = kb.b = kb.c = 0;
    tc.a = tc.b = tc.c = 0;
    held.a = held.b = held.c = 0;
    prev.a = prev.b = prev.c = 0;
    ptrs.clear(); drag = null;
    dashQ = false; dashDir = 0;
    clearDirs();
    ['A', 'B', 'C', 'Dash'].forEach(k => setBtnVisual(k, false));
    S.ax = 0;
    S.a = S.b = S.c = false;
    S.aP = S.bP = S.cP = S.aR = S.bR = S.cR = false;
    S.dashP = false; S.dashDir = 0;
  }
  function inBtn(k, x, y) {
    const p = btnPos[k], dx = x - p.x, dy = y - p.y;
    return dx * dx + dy * dy <= p.hit * p.hit;
  }
  function setBtnVisual(k, on) { el[k].classList.toggle('hit', !!on); }

  // --- перетягування блоків у налаштуваннях -------------------------------
  function inBox(b, x, y) { return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h; }
  function dragStart(x, y) {
    if (inBox(box.pad, x, y)) return { what: 'pad', dx: x - (box.pad.x + box.pad.w / 2), dy: y - (box.pad.y + box.pad.h / 2) };
    if (inBox(box.btn, x, y)) return { what: 'btn', dx: x - (box.btn.x + box.btn.w / 2), dy: y - (box.btn.y + box.btn.h / 2) };
    return null;
  }
  function dragTo(x, y) {
    const sl = safeInset('l'), sr = safeInset('r'), sb = safeInset('b');
    const W = window.innerWidth - sl - sr, H = window.innerHeight - sb;
    const snap = v => Math.round(v / 8) * 8;       // прилипання до сітки 8 px
    let px = snap(x - drag.dx), py = snap(y - drag.dy);
    // Блок не можна кинути поверх панелі налаштувань — інакше він
    // накриє її кнопки й повзунки, і дістати їх стане ніяк.
    const b = drag.what === 'pad' ? box.pad : box.btn;
    const panel = document.querySelector('#controls .inner');
    if (panel) {
      const r = panel.getBoundingClientRect(), hw = b.w / 2 + 6, hh = b.h / 2 + 6;
      if (px + hw > r.left && px - hw < r.right && py + hh > r.top && py - hh < r.bottom)
        px = (px < (r.left + r.right) / 2) ? r.left - hw : r.right + hw;
    }
    const cx = clamp(px - sl, 0, W) / W;
    const cy = clamp(py, 0, H) / H;
    Store.data[drag.what === 'pad' ? 'dpadPos' : 'btnPos'] = { x: cx, y: cy };
    layout();
    if (onMoved) onMoved();
  }

  function down(id, x, y) {
    if (preview) { drag = dragStart(x, y); if (drag) ptrs.set(id, { kind: 'drag' }); return; }
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
    if (p.kind === 'drag') { if (drag) dragTo(x, y); return; }
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
    if (p.kind === 'drag') { drag = null; Store.save(); return; }
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
  L.addEventListener('lostpointercapture', e => { up(e.pointerId); });
  L.addEventListener('contextmenu', e => e.preventDefault());
  // Системні жести й згортання не завжди дають pointercancel — страхуємось.
  window.addEventListener('touchcancel', resetInput, { passive: true });
  document.addEventListener('visibilitychange', resetInput);
  window.addEventListener('pagehide', resetInput);
  // блокуємо зум подвійним тапом і жести масштабування
  document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });
  document.addEventListener('gesturestart', e => e.preventDefault(), { passive: false });
  document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

  const KEYS = {
    ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r',
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
  window.addEventListener('blur', resetInput);

  return {
    S: S,
    kb: kb,
    btn: btnPos,
    pad: pad,
    box: box,
    layout: layout,
    preset: applyPreset,
    presets: PRESETS,
    // Живий перегляд у налаштуваннях: керування видно й тягається,
    // але в гру нічого не передається.
    setPreview(on, moved) {
      preview = !!on; drag = null; onMoved = moved || null;
      el.layer.classList.toggle('on', !!on || enabled);
      el.layer.classList.toggle('prev', !!on);
      if (on) { tc.a = tc.b = tc.c = 0; ptrs.clear(); clearDirs(); ['A', 'B', 'C', 'Dash'].forEach(k => setBtnVisual(k, false)); }
    },
    reset: resetInput,
    enable(on) {
      enabled = !!on;
      if (preview) return;
      el.layer.classList.toggle('on', !!on);
      if (!on) resetInput();          // пауза, меню, будь-який екран
    },
    // Викликається на кожному фіксованому кроці фізики: рахує фронти.
    step() {
      const l = kb.l || dir.l, r = kb.r || dir.r;
      S.ax = (r ? 1 : 0) - (l ? 1 : 0);
      held.a = (kb.a || kb.u || tc.a) ? 1 : 0;           // стрибок лише з A (та клавіатури)
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
