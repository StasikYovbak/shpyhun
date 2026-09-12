/**
 * Керування: дві великі стрілки ← → + кнопки A/B/C/D, повний мультитач,
 * дублююча клавіатура. Стрілок «вгору» і «вниз» немає: стрибок живе на A,
 * спуск крізь тонкі платформи — утримання A. Відступи враховують
 * безпечну зону екрана (виріз камери).
 */
import { CONFIG, clamp, sign, DEV_MODE } from './config.js';
import { Store } from './store.js';
import { Pad, ELEMS, ELBASE, overlaps } from './pad.js';
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
  /* Ключ елемента в розкладці -> вузол у DOM.

     `dbg` існує ЛИШЕ у збірці розробника, тож і пошук за його id стоїть
     під статичним `DEV_MODE`: інакше рядок 'btnDbg' лишався б у
     релізному бандлі, і `npm run check:release` справедливо рахував би
     це слідом режиму бога. При false Rollup згортає гілку в `null`. */
  const node = k => (k === 'D' ? el.Dash
                   : k === 'dbg' ? (DEV_MODE ? document.getElementById('btnDbg') : null)
                   : el[k]);
  /** Геометрія КОЖНОГО елемента після layout(): центр, візуал, хітбокс. */
  const geo = {};

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
  let preview = false, drag = null, onMoved = null, onPick = null, testing = false;

  const S = {
    ax: 0,
    a: false, b: false, c: false,
    aP: false, bP: false, cP: false,
    aR: false, bR: false, cR: false,
    dashP: false, dashDir: 0, pauseP: false
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
  /* ------------------------------------------------------------ РОЗКЛАДКА
     Позиція кожного елемента рахується в частках безпечної зони, тож
     переживає поворот екрана й іншу роздільність. `x === null` означає
     «стандартне місце» — воно й далі рахується з геометрії екрана, а не
     запікається в збереження. */

  /** Штатне місце елемента: рівно те, що було до поелементних налаштувань. */
  function defaultPos(k, W, H, mir, OX, sizes) {
    const edge = CONFIG.DPAD_EDGE;
    if (k === 'L' || k === 'R') {
      const aw = sizes.L.w, gap = CONFIG.ARROW_GAP * (sizes.L.w / CONFIG.ARROW_W);
      const bw = aw + sizes.R.w + gap;
      const cx = OX + (mir > 0 ? (edge + bw / 2) : (W - edge - bw / 2));
      const cy = H - edge - Math.max(sizes.L.h, sizes.R.h) / 2;
      // ← ліворуч від центра пари, → праворуч; дзеркалення не міняє
      // порядок стрілок — «вліво» завжди зліва, інакше це пастка.
      return k === 'L' ? { x: cx - (bw - aw) / 2, y: cy }
                       : { x: cx + (bw - sizes.R.w) / 2, y: cy };
    }
    if (k === 'pause') return { x: OX + W - 8 - sizes.pause.w / 2, y: safeInset('t') + 8 + sizes.pause.h / 2 };
    if (k === 'dbg')   return { x: OX + W - 60 - sizes.dbg.w / 2, y: safeInset('t') + 8 + sizes.dbg.h / 2 };
    // A/B/C/D ромбом: A знизу, C зверху, B збоку, D навпроти B
    const d = sizes.A.w, bgap = CONFIG.BTN_GAP * (d / CONFIG.BTN);
    const rad = (d + bgap) / Math.SQRT2;
    const half = rad + d / 2;
    const cx = OX + (mir > 0 ? (W - edge - half) : (edge + half));
    const cy = H - edge - half;
    if (k === 'A') return { x: cx, y: cy + rad };
    if (k === 'C') return { x: cx, y: cy - rad };
    if (k === 'B') return { x: cx - mir * rad, y: cy };
    return { x: cx + mir * rad, y: cy };                  // D
  }

  /** Малюємо стрілку в екранних координатах: трикутник або плитка. */
  function arrowPoints(k, g, mir) {
    const x = g.x, y = g.y, hw = g.w / 2, hh = g.h / 2;
    const shape = g.shape;
    if (shape === 'square') {
      const c = Math.min(hw, hh) * 0.28;                  // зрізані кути
      return [[x - hw + c, y - hh], [x + hw - c, y - hh], [x + hw, y - hh + c],
              [x + hw, y + hh - c], [x + hw - c, y + hh], [x - hw + c, y + hh],
              [x - hw, y + hh - c], [x - hw, y - hh + c]].map(p => p.join(',')).join(' ');
    }
    if (shape === 'round') {                              // восьмикутник ≈ коло
      const pts = [];
      for (let i = 0; i < 8; i++) {
        const a = Math.PI * 2 * i / 8 + Math.PI / 8;
        pts.push((x + Math.cos(a) * hw) + ',' + (y + Math.sin(a) * hh));
      }
      return pts.join(' ');
    }
    const tip = (k === 'L') ? -1 : 1;                     // вістря завжди в свій бік
    return [[x + tip * hw, y], [x - tip * hw, y - hh], [x - tip * hw, y + hh]]
           .map(p => p.join(',')).join(' ');
  }

  let padPaired = true, mirNow = 1, badSet = new Set();

  function layout() {
    const sl = safeInset('l'), sr = safeInset('r'), sb = safeInset('b');
    const W = window.innerWidth - sl - sr, H = window.innerHeight - sb;
    const mir = Pad.hand ? -1 : 1;                  // 1 = стрілки ліворуч
    const OX = sl;
    mirNow = mir;

    // Спершу розміри всіх елементів — штатні місця залежать одне від одного.
    const sizes = {};
    for (const k of ELEMS) {
      const c = Pad.el(k), base = ELBASE[k], kk = clamp(c.s, 60, 200) / 100;
      sizes[k] = { w: base.w * kk, h: base.h * kk };
    }

    for (const k of ELEMS) {
      const c = Pad.el(k), base = ELBASE[k];
      const w = sizes[k].w, h = sizes[k].h;
      const d = defaultPos(k, W, H, mir, OX, sizes);
      let cx = c.x === null ? d.x : OX + c.x * W;
      let cy = c.y === null ? d.y : c.y * H;
      cx = clamp(cx, OX + w / 2 + 2, OX + W - w / 2 - 2);
      cy = clamp(cy, h / 2 + 2, H - h / 2 - 2);
      const g = geo[k] || (geo[k] = {});
      g.x = cx; g.y = cy; g.w = w; g.h = h;
      g.hide = c.hide ? 1 : 0; g.vib = c.vib ? 1 : 0;
      g.shape = c.shape || base.shape;
      g.op = clamp(c.op, 20, 100) / 100;
      // Хітбокс на 30 % більший за візуал і ніколи не менший за базовий:
      // зменшена кнопка не має ставати недосяжною.
      const hk = k === 'L' || k === 'R' ? CONFIG.DPAD_HIT : 1.25;
      g.hw = Math.max(w, base.w) * hk / 2;
      g.hh = Math.max(h, base.h) * hk / 2;
      g.r = Math.min(w, h) / 2;
      g.hit = Math.max(Math.min(w, h), Math.min(base.w, base.h)) / 2 * 1.25;
    }

    // Пара стрілок: поки обидві на штатних місцях і однакові, вони
    // працюють ЯК ОДИН блок — так само, як до поелементних налаштувань.
    // Це не оптимізація: спільна коробка з нахиленою межею дає ковзання
    // ← → без відриву пальця, і втратити його було б відчутно.
    const cl = Pad.el('L'), cr = Pad.el('R');
    padPaired = cl.x === null && cl.y === null && cr.x === null && cr.y === null && cl.s === cr.s;
    if (padPaired) {
      const bw = geo.L.w + geo.R.w + CONFIG.ARROW_GAP * (geo.L.w / CONFIG.ARROW_W);
      const cx = (geo.L.x + geo.R.x) / 2, cy = (geo.L.y + geo.R.y) / 2;
      pad.x = cx; pad.y = cy; pad.w = bw; pad.h = Math.max(geo.L.h, geo.R.h);
      pad.mir = mir; pad.hit = CONFIG.DPAD_HIT;
      pad.hw = Math.max(bw, CONFIG.ARROW_W * 2 + CONFIG.ARROW_GAP) * pad.hit / 2;
      pad.hh = Math.max(pad.h, CONFIG.ARROW_H) * pad.hit / 2;
    } else {
      pad.x = (geo.L.x + geo.R.x) / 2; pad.y = (geo.L.y + geo.R.y) / 2;
      pad.w = geo.L.w + geo.R.w; pad.h = Math.max(geo.L.h, geo.R.h);
      pad.hw = Math.max(geo.L.hw, geo.R.hw); pad.hh = Math.max(geo.L.hh, geo.R.hh);
      pad.mir = mir; pad.hit = CONFIG.DPAD_HIT;
    }

    // --- у DOM ---
    el.dpad.setAttribute('viewBox', '0 0 ' + Math.max(1, window.innerWidth) + ' ' + Math.max(1, window.innerHeight));
    el.dpad.style.width = window.innerWidth + 'px';
    el.dpad.style.height = window.innerHeight + 'px';
    el.dpad.style.left = '0px'; el.dpad.style.top = '0px';
    for (const k of ['L', 'R']) {
      const g = geo[k], n = node(k);
      n.setAttribute('points', arrowPoints(k, g, mir));
      n.style.opacity = g.hide ? 0 : g.op;
      n.style.display = g.hide ? 'none' : '';
    }
    for (const k of ['A', 'B', 'C', 'D', 'pause', 'dbg']) {
      const g = geo[k], n = node(k);
      if (!n) continue;
      n.style.width = g.w + 'px'; n.style.height = g.h + 'px';
      n.style.left = (g.x - g.w / 2) + 'px'; n.style.top = (g.y - g.h / 2) + 'px';
      n.style.opacity = g.op;
      n.style.borderRadius = g.shape === 'square' ? Math.min(10, g.w * 0.18) + 'px' : '50%';
      n.style.fontSize = Math.max(9, Math.round(g.h * 0.29)) + 'px';
      if (k !== 'pause' && k !== 'dbg') n.classList.toggle('nocap', !Pad.el(k).lab);
      if (k !== 'dbg') n.style.display = g.hide ? 'none' : '';
    }
    // Старі сукупні коробки — щоб «перетягни блок цілком» і тести,
    // які міряють пару, далі бачили те, що й бачили.
    box.pad.x = pad.x - pad.w / 2; box.pad.y = pad.y - pad.h / 2;
    box.pad.w = pad.w; box.pad.h = pad.h;
    const bx = [geo.A, geo.B, geo.C, geo.D];
    const x0 = Math.min(...bx.map(g => g.x - g.w / 2)), x1 = Math.max(...bx.map(g => g.x + g.w / 2));
    const y0 = Math.min(...bx.map(g => g.y - g.h / 2)), y1 = Math.max(...bx.map(g => g.y + g.h / 2));
    box.btn.x = x0; box.btn.y = y0; box.btn.w = x1 - x0; box.btn.h = y1 - y0;
    for (const k of ['A', 'B', 'C']) { btnPos[k].x = geo[k].x; btnPos[k].y = geo[k].y; btnPos[k].r = geo[k].r; btnPos[k].hit = geo[k].hit; }
    btnPos.Dash.x = geo.D.x; btnPos.Dash.y = geo.D.y; btnPos.Dash.r = geo.D.r; btnPos.Dash.hit = geo.D.hit;
    pauseBox.x = geo.pause.x - geo.pause.w / 2; pauseBox.y = geo.pause.y - geo.pause.h / 2;
    pauseBox.w = geo.pause.w; pauseBox.h = geo.pause.h;

    badSet = overlaps(geo);
    if (preview) markBad();
  }

  /* Показ перекриття — в ОДНОМУ місці: і червоні контури, і банер угорі.
     Інакше вони розходяться (контури малює layout, банер — панель), і
     на екрані виходить «нічого не червоне, але попередження висить». */
  function markBad() {
    for (const k of ELEMS) {
      const n = node(k);
      if (n) n.classList.toggle('bad', badSet.has(k));
    }
    const warn = document.getElementById('cWarn'), hint = document.getElementById('cHint');
    if (warn) warn.hidden = badSet.size === 0;
    if (hint) hint.hidden = badSet.size > 0;
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
    // Пара на штатному місці — стара спільна коробка з нахиленою межею.
    if (padPaired) {
      if (geo.L.hide && geo.R.hide) return null;
      const ay = y - pad.y;
      const ax = x - pad.x + ay * CONFIG.DPAD_TILT * pad.mir;
      if (bounded && (Math.abs(ax) > pad.hw || Math.abs(ay) > pad.hh)) return null;
      const l = ax < 0 ? 1 : 0, r = ax > 0 ? 1 : 0;
      return { l: geo.L.hide ? 0 : l, r: geo.R.hide ? 0 : r };
    }
    // Стрілки рознесені — у кожної власний нахилений хітбокс.
    const inA = arrowHit('L', x, y), inB = arrowHit('R', x, y);
    if (inA && !inB) return { l: 1, r: 0 };
    if (inB && !inA) return { l: 0, r: 1 };
    if (inA && inB) return near(x, y);
    if (bounded) return null;
    return near(x, y);                              // палець уже веде — тягнемо за ближчою
  }
  function arrowHit(k, x, y) {
    const g = geo[k];
    if (!g || g.hide) return false;
    const ay = y - g.y, ax = x - g.x + ay * CONFIG.DPAD_TILT * mirNow;
    return Math.abs(ax) <= g.hw && Math.abs(ay) <= g.hh;
  }
  function near(x, y) {
    if (geo.L.hide) return { l: 0, r: geo.R.hide ? 0 : 1 };
    if (geo.R.hide) return { l: 1, r: 0 };
    const dl = Math.abs(x - geo.L.x), dr = Math.abs(x - geo.R.x);
    return dl <= dr ? { l: 1, r: 0 } : { l: 0, r: 1 };
  }
  function applyDirs(nd) {
    const fresh = (nd.l && !dir.l) || (nd.r && !dir.r);
    dir.l = nd.l; dir.r = nd.r;
    el.L.classList.toggle('hit', !!dir.l);
    el.R.classList.toggle('hit', !!dir.r);
    // Відгук дає лише та стрілка, якій його дозволили: вібрацію
    // вимикають поелементно, а не всю одразу.
    if (fresh && geo[nd.l ? 'L' : 'R'] && geo[nd.l ? 'L' : 'R'].vib) buzz(10);
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

  /* ------------------------------------- РЕДАКТОР: вибір і перетягування
     Тап по елементу вибирає його, протяг — переносить. Тягнеться рівно
     той елемент, у який влучив палець, а не вся група. */
  function pickAt(x, y) {
    // Ідемо зверху вниз за розміром: дрібний DBG поверх великої стрілки
    // має вибиратись, а не програвати їй площею.
    const ks = ELEMS.filter(k => geo[k] && node(k)).sort((a, b) => (geo[a].w * geo[a].h) - (geo[b].w * geo[b].h));
    for (const k of ks) {
      const g = geo[k];
      if (Math.abs(x - g.x) <= g.w / 2 + 6 && Math.abs(y - g.y) <= g.h / 2 + 6) return k;
    }
    return null;
  }
  function dragStart(x, y) {
    const k = pickAt(x, y);
    if (!k) return null;
    if (onPick) onPick(k);
    const g = geo[k];
    return { what: k, dx: x - g.x, dy: y - g.y, moved: 0 };
  }
  function dragTo(x, y) {
    const sl = safeInset('l'), sr = safeInset('r'), sb = safeInset('b');
    const W = window.innerWidth - sl - sr, H = window.innerHeight - sb;
    const snap = v => Math.round(v / 8) * 8;       // прилипання до сітки 8 px
    const g = geo[drag.what];
    let px = snap(x - drag.dx), py = snap(y - drag.dy);
    // Не даємо кинути елемент під панель параметрів — інакше він накриє
    // її повзунки, і дістати їх стане ніяк.
    const panel = document.getElementById('cPanel');
    if (panel && !panel.hidden) {
      const r = panel.getBoundingClientRect(), hh = g.h / 2 + 6;
      const over = px + g.w / 2 > r.left && px - g.w / 2 < r.right &&
                   py + hh > r.top && py - hh < r.bottom;
      if (over) py = (r.top > window.innerHeight / 2) ? r.top - hh : r.bottom + hh;
    }
    // Прив'язка до країв з урахуванням safe-area.
    const cx = clamp(px - sl, g.w / 2, W - g.w / 2) / W;
    const cy = clamp(py, g.h / 2, H - g.h / 2) / H;
    const c = Pad.el(drag.what);
    c.x = cx; c.y = cy;
    drag.moved = 1;
    layout();
    if (onMoved) onMoved(drag.what);
  }

  function down(id, x, y) {
    if (preview) {
      // Тестова зона: кнопка блимає й вібрує рівно так, як у грі, але
      // ввід нікуди не йде — перевірити відгук можна, не виходячи.
      if (testing) {
        const k = pickAt(x, y);
        if (k) {
          const n = node(k); if (n) n.classList.add('hit');
          if (geo[k].vib) buzz(k === 'D' ? 22 : 14);
          ptrs.set(id, { kind: 'test', k: k });
          return;
        }
        ptrs.set(id, { kind: 'none' });
        return;
      }
      drag = dragStart(x, y); if (drag) ptrs.set(id, { kind: 'drag' });
      return;
    }
    if (!enabled) return;
    if (!geo.pause.hide &&
        x >= pauseBox.x && x <= pauseBox.x + pauseBox.w && y >= pauseBox.y && y <= pauseBox.y + pauseBox.h) {
      pauseQ = true; ptrs.set(id, { kind: 'pause' }); return;
    }
    if (!geo.D.hide && inBtn('Dash', x, y)) {        // окрема кнопка ривка
      ptrs.set(id, { kind: 'Dash' });
      setBtnVisual('Dash', true);
      if (geo.D.vib) buzz(12);
      dashQ = true; dashDir = 0;
      return;
    }
    for (const k of ['A', 'B', 'C']) {
      if (!geo[k].hide && inBtn(k, x, y)) {
        ptrs.set(id, { kind: k });
        tc[k.toLowerCase()] = 1; setBtnVisual(k, true);
        if (geo[k].vib) buzz(10);
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
    if (p.kind === 'test') { const n = node(p.k); if (n) n.classList.remove('hit'); return; }
    if (p.kind === 'drag') { drag = null; Pad.save(); return; }
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
    geo: geo,
    /** Перекриті елементи після останнього layout(). */
    bad: () => badSet,
    preset(id) { Pad.preset(id); layout(); },
    /** Сумісність: три старі пресети відображені на нові розкладки. */
    presets: { default: 'standard', big: 'big', compact: 'minimal', lefty: 'lefty' },
    profile(i) { Pad.pick(i); layout(); },
    // Живий перегляд у налаштуваннях: керування видно й тягається,
    // але в гру нічого не передається.
    setPreview(on, moved, picked) {
      preview = !!on; drag = null; onMoved = moved || null; onPick = picked || null;
      el.layer.classList.toggle('on', !!on || enabled);
      el.layer.classList.toggle('prev', !!on);
      if (on) { tc.a = tc.b = tc.c = 0; ptrs.clear(); clearDirs(); ['A', 'B', 'C', 'Dash'].forEach(k => setBtnVisual(k, false)); layout(); }
      else for (const k of ELEMS) { const n = node(k); if (n) n.classList.remove('bad', 'sel'); }
    },
    /** Тестова зона редактора: кнопки реагують, але в гру нічого не йде. */
    setTest(on) { testing = !!on; },
    /** Підсвітити вибраний елемент у редакторі. */
    select(k) {
      for (const e of ELEMS) { const n = node(e); if (n) n.classList.toggle('sel', e === k); }
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
