/**
 * РЕЖИМ БОГА — панель розробника.
 *
 * Інструмент для наскрізного проходження гри: подивитись усі рівні,
 * босів, зброю й катсцени й зрозуміти, що ще доробляти. Не читерство
 * для гравця: увесь модуль підвантажується динамічним import'ом під
 * `if (DEV_MODE)`, і при `DEV_MODE = false` його немає у збірці взагалі.
 *
 * Побічних ефектів на рівні модуля тут немає жодного: DOM будується
 * тільки всередині init().
 */
import { CH, cheating, cheatsOff } from './cheats.js';
import { Store, SAVE_KEY, SAVE_KEY_MAIN } from './store.js';
import { WEAPONS } from './weapons.js';
import { SCRIPTS } from './cutscene.js';

const CSS = `
/* ---------- РЕЖИМ РОЗРОБНИКА (тільки при DEV_MODE = true) ---------- */
#btnDbg{position:absolute;top:8px;right:60px;width:40px;height:26px;z-index:22;
  border:1px solid rgba(255,210,63,.6);border-radius:6px;background:rgba(11,4,19,.5);
  color:#ffd23f;font:inherit;font-size:10px;letter-spacing:.12em;opacity:.5;padding:0}
#btnDbg.hot{border-color:#ff3355;color:#ff6b7f;opacity:.95}
#btnDbg[hidden]{display:none}
/* Поки відкритий будь-який екран меню, кнопка ховається: інакше вона
   лягає поверх правого верхнього кута налаштувань і перекриває вміст. */
body.menuOpen #btnDbg{display:none}
.dbgPanel{position:absolute;inset:0 0 0 auto;width:min(340px,92vw);z-index:20;display:none;
  flex-direction:column;background:rgba(9,4,16,.95);border-left:1px solid rgba(255,210,63,.35);
  font-size:11px;letter-spacing:.04em}
.dbgPanel.on{display:flex}
.dbgHead{display:flex;align-items:center;gap:6px;padding:8px 10px;
  border-bottom:1px solid rgba(255,210,63,.3);color:#ffd23f}
.dbgHead b{flex:1;font-size:11px;letter-spacing:.14em}
.dbgBody{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:6px 10px 18px}
.dbgSec{margin:8px 0 12px}
.dbgSec h4{margin:0 0 5px;font-size:10px;letter-spacing:.18em;color:#22e0ff;font-weight:500}
.dbgRow{display:flex;align-items:center;gap:6px;min-height:26px;padding:1px 0}
.dbgLab{flex:1;color:#9a7fb5;font-size:10.5px}
.dbgBtns{display:flex;gap:3px;flex-wrap:wrap;justify-content:flex-end}
.dbgB{min-height:24px;padding:3px 7px;border:1px solid rgba(154,127,181,.45);border-radius:5px;
  background:rgba(34,224,255,.06);color:#e8ddf5;font:inherit;font-size:10px;cursor:pointer}
.dbgB:active{transform:scale(.96)}
.dbgB.on{border-color:#ffd23f;background:rgba(255,210,63,.22);color:#fff6c9}
.dbgB.dbgN{min-width:22px;padding:3px 4px}
.dbgB.dbgX{color:#ff6b7f;border-color:rgba(255,51,85,.5)}
.dbgNote{color:#6f5f88;font-size:9.5px;line-height:1.4;padding:2px 0 6px;word-break:break-all}
/* червона рамка, поки активний хоч один чит */
#godFrame{position:absolute;inset:0;z-index:21;display:none;pointer-events:none;
  box-shadow:inset 0 0 0 2px rgba(255,51,85,.75),inset 0 0 26px rgba(255,51,85,.25)}
#godFrame.on{display:block}
#godFrame span{position:absolute;top:6px;left:10px;color:#ff6b7f;font-size:10px;
  letter-spacing:.28em;text-shadow:0 0 8px rgba(255,51,85,.8)}
`;

let D = null;                 // залежності з main.js
let panel = null, btn = null, body = null, frameEl = null, frameOn = null;
let open = false, wasPlaying = false;
const errors = [];            // останні помилки з консолі

/* ------------------------------------------------------ дрібні хелпери */
const el = (tag, cls, txt) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt !== undefined) e.textContent = txt;
  return e;
};
function section(title) {
  const s = el('div', 'dbgSec');
  s.appendChild(el('h4', null, title));
  body.appendChild(s);
  return s;
}
/** Рядок «підпис + кнопки». */
function row(sec, label) {
  const r = el('div', 'dbgRow');
  r.appendChild(el('span', 'dbgLab', label));
  const box = el('div', 'dbgBtns');
  r.appendChild(box);
  sec.appendChild(r);
  return box;
}
/** Кнопка-перемикач, прив'язана до поля CH. */
function toggle(sec, label, key, after) {
  const box = row(sec, label);
  const b = el('button', 'dbgB', 'ВИМК');
  const sync = () => {
    b.textContent = CH[key] ? 'УВІМК' : 'ВИМК';
    b.classList.toggle('on', !!CH[key]);
  };
  b.onclick = () => { CH[key] = CH[key] ? 0 : 1; sync(); if (after) after(); refresh(); };
  box.appendChild(b);
  sync();
  return sync;
}
/** Група взаємовиключних кнопок: [підпис, значення]. */
function choice(sec, label, key, opts, after) {
  const box = row(sec, label);
  const bs = [];
  const sync = () => bs.forEach(([b, v]) => b.classList.toggle('on', CH[key] === v));
  for (const [txt, v] of opts) {
    const b = el('button', 'dbgB', txt);
    b.onclick = () => { CH[key] = v; sync(); if (after) after(); refresh(); };
    box.appendChild(b); bs.push([b, v]);
  }
  sync();
  return sync;
}
/** Проста кнопка-дія. */
function action(sec, label, txt, fn) {
  const box = row(sec, label);
  const b = el('button', 'dbgB', txt);
  b.onclick = () => { fn(b); refresh(); };
  box.appendChild(b);
  return b;
}
const syncers = [];
function refresh() {
  for (const f of syncers) f();
  if (btn) btn.classList.toggle('hot', cheating());
}

/* ------------------------------------------------------------- панель */
function build() {
  panel = el('div', 'dbgPanel');
  const head = el('div', 'dbgHead');
  head.appendChild(el('b', null, 'DEV · РЕЖИМ БОГА'));
  const off = el('button', 'dbgB', 'ВИМКНУТИ ВСЕ');
  off.onclick = () => { cheatsOff(); refresh(); };
  const close = el('button', 'dbgB dbgX', '✕');
  close.onclick = () => hide();
  head.appendChild(off); head.appendChild(close);
  panel.appendChild(head);

  body = el('div', 'dbgBody');
  panel.appendChild(body);
  document.body.appendChild(panel);

  /* ---------------- БІЙ ---------------- */
  const c = section('БІЙ');
  syncers.push(toggle(c, 'Безсмертя', 'invuln'));
  syncers.push(choice(c, 'Урон гравця', 'dmgK',
    [['×1', 1], ['×5', 5], ['×20', 20]], () => { CH.oneShot = 0; }));
  syncers.push(toggle(c, 'Вбиває з одного удару', 'oneShot',
    () => { if (CH.oneShot) CH.dmgK = 1; }));
  syncers.push(toggle(c, 'Нескінченні ресурси', 'res', () => {
    if (CH.res) { D.P.heat = 0; D.P.cores = 3; D.P.shells = 6; D.P.reloadT = 0; D.P.droneCd = 0; }
  }));
  syncers.push(toggle(c, 'Ривок без кулдауну', 'dash',
    () => { if (CH.dash) D.P.dashCd = 0; }));
  action(c, 'Серця', 'ЗАПОВНИТИ', () => { D.P.hp = D.P.maxHp; });
  action(c, 'Додати серце', '+1 СЕРЦЕ', () => { D.P.maxHp++; D.P.hp = D.P.maxHp; });
  action(c, 'Зачистити екран', 'ВБИТИ ВСІХ', () => {
    for (const e of D.G.ENEM) if (!e.dead) D.G.damageEnemy(e, 1e6, 0, { pierce: true, shock: true });
  });
  action(c, 'Бос', 'ВБИТИ МИТТЄВО', () => {
    if (!D.G.BOSS.on) return;
    for (const p of D.G.BOSS.parts) p.alive = false;
    D.G.BOSS.hp = 0; D.G.bossDie();
  });
  const ph = row(c, 'Фаза боса');
  for (const n of [1, 2, 3]) {
    const b = el('button', 'dbgB', String(n));
    b.onclick = () => {
      const B = D.G.BOSS;
      if (!B.on || !B.def || n > B.def.phases) return;
      // Фази перемикаємо тим самим порогом HP, що й гра, — щоб бос
      // зайшов у фазу штатно, а не в напівстані.
      B.hp = Math.max(1, Math.ceil(B.maxHp * (1 - (n - 1) / B.def.phases)) - 1);
      D.G.bossCheckPhase();
      refresh();
    };
    ph.appendChild(b);
  }

  /* ---------------- РУХ ---------------- */
  const m = section('РУХ');
  syncers.push(toggle(m, 'Політ / noclip', 'fly'));
  syncers.push(choice(m, 'Швидкість гри', 'speed',
    [['×0,25', 0.25], ['×0,5', 0.5], ['×1', 1], ['×2', 2], ['×4', 4]]));
  syncers.push(toggle(m, 'Покадровий режим', 'frozen'));
  action(m, 'Крок уперед (клавіша «.»)', 'НАСТУПНИЙ КАДР', () => { CH.frozen = 1; CH.stepOnce = 1; });
  syncers.push(toggle(m, 'Потрійний стрибок', 'jump3'));

  /* ---------------- НАВІГАЦІЯ ---------------- */
  const n = section('НАВІГАЦІЯ');
  const lv = row(n, 'Сектор');
  for (let i = 0; i < 10; i++) {
    const b = el('button', 'dbgB dbgN', String(i + 1));
    b.onclick = () => {
      Store.data.unlocked = 10; Store.save();
      D.G.Game.startLevel(i, false);
      hide();
    };
    lv.appendChild(b);
  }
  const cp = row(n, 'Чекпоінт');
  for (let i = 0; i < 3; i++) {
    const b = el('button', 'dbgB dbgN', String(i + 1));
    b.onclick = () => {
      const w = D.G.world;
      if (!w.cps || !w.cps[i]) return;
      D.G.playerSpawnAt(w.cps[i].x, w.cps[i].y);
      for (let k = 0; k <= i; k++) w.cps[k].taken = true;
      w.cpTaken = true; w.cp.x = w.cps[i].x; w.cp.y = w.cps[i].y;
      D.G.Game.cpTaken = true; D.G.Game.cpIndex = i;
      hide();
    };
    cp.appendChild(b);
  }
  action(n, 'Арена боса', 'ПЕРЕЙТИ', () => {
    const w = D.G.world;
    if (!w.bossX) return;
    D.G.playerSpawnAt(w.bossX - 34, 13 * 16 - 16);
    hide();
  });
  action(n, 'Уся зброя', 'РОЗБЛОКУВАТИ', () => {
    Store.data.owned = Object.keys(WEAPONS);
    Store.data.frags = [0, 1, 2];
    Store.data.unlocked = 10;
    Store.save();
    D.G.refreshEquip();
  });
  const cs = row(n, 'Катсцена');
  for (const key of Object.keys(SCRIPTS)) {
    const sc = SCRIPTS[key];
    const b = el('button', 'dbgB', sc.id || key);
    b.onclick = () => {
      const seen = Store.data.seenCuts || [];
      const i = seen.indexOf(sc.id);
      if (i >= 0) seen.splice(i, 1);              // щоб показалась ще раз
      hide();
      D.G.Cut.play(sc, () => { });
      D.G.Game.state = 'cut';
      D.Input.enable(false);
    };
    cs.appendChild(b);
  }

  /* ---------------- ДІАГНОСТИКА ---------------- */
  const g = section('ДІАГНОСТИКА (поведінку гри не міняє)');
  syncers.push(toggle(g, 'Цифри: FPS, спрайти, пули', 'diag'));
  syncers.push(toggle(g, 'Хітбокси', 'boxes'));
  syncers.push(toggle(g, 'Сітка тайлів і підлога', 'grid'));
  syncers.push(toggle(g, 'Стан ШІ ворогів', 'ai'));
  syncers.push(toggle(g, 'Останні помилки консолі', 'errs'));

  /* ---------------- СЛУЖБОВЕ ---------------- */
  const u = section('СЛУЖБОВЕ');
  const slot = el('div', 'dbgNote');
  slot.textContent = 'Слот збереження: ' + SAVE_KEY +
    (SAVE_KEY === SAVE_KEY_MAIN ? '' : '  (основний прогрес не чіпається)');
  u.appendChild(slot);
  action(u, 'Стан у буфер', 'СКОПІЮВАТИ', b => {
    const txt = dump();
    const done = () => { b.textContent = 'СКОПІЙОВАНО'; setTimeout(() => (b.textContent = 'СКОПІЮВАТИ'), 1200); };
    if (navigator.clipboard && navigator.clipboard.writeText)
      navigator.clipboard.writeText(txt).then(done, () => fallbackCopy(txt, done));
    else fallbackCopy(txt, done);
  });
  action(u, 'Весь прогрес', 'СКИНУТИ', b => {
    if (b.dataset.arm !== '1') {                  // друге натискання підтверджує
      b.dataset.arm = '1'; b.textContent = 'ТОЧНО?';
      setTimeout(() => { b.dataset.arm = ''; b.textContent = 'СКИНУТИ'; }, 3000);
      return;
    }
    b.dataset.arm = '';
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { }
    location.reload();
  });

  refresh();
}

/** Дамп стану — рівно те, що зручно вставити в чат при описі бага. */
function dump() {
  const P = D.P, W = D.G.world, B = D.G.BOSS, S = Store.data;
  const o = {
    коли: new Date().toISOString(),
    рівень: { індекс: W.idx, назва: W.def && W.def.n, тема: W.theme, вихід: !!W.exitOpen },
    стан: D.G.Game.state,
    героїня: {
      x: +P.x.toFixed(1), y: +P.y.toFixed(1),
      vx: +P.vx.toFixed(1), vy: +P.vy.toFixed(1),
      onGround: !!P.onGround, анімація: P.anim, стан: P.aState,
      hp: P.hp + '/' + P.maxHp, тепло: Math.round(P.heat), ядра: P.cores, набої: P.shells
    },
    зброя: { ближня: S.melee, дальня: S.ranged, є: S.owned, фрагменти: S.frags },
    бос: B.on ? { тип: B.type, hp: B.hp + '/' + B.maxHp, фаза: B.phase, стан: B.st,
                  лють: !!B.rage, секунд: +B.fightT.toFixed(1) } : null,
    пули: D.G.PARTS ? { кулі: D.G.BULL.length, вороги: D.G.ENEM.length,
                        частинки: D.G.PARTS.length, дрони: D.G.DRONES.length } : null,
    чити: cheating() ? Object.fromEntries(Object.entries(CH).filter(([, v]) => v && v !== 1)) : 'вимкнені',
    налаштування: { легкий: S.easy, гучність: S.vol, музика: S.mus, графіка: S.gfx,
                    bloom: S.bloom, аберація: S.ab, фон: S.bgDim },
    помилки: errors.slice(-10)
  };
  return '```json\n' + JSON.stringify(o, null, 2) + '\n```';
}
function fallbackCopy(txt, done) {
  const ta = el('textarea');
  ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { }
  document.body.removeChild(ta);
}

function show() {
  if (!panel) build();
  open = true;
  panel.classList.add('on');
  // Гра стоїть, поки панель відкрита: власний стан, а не Game.pause(),
  // щоб екран паузи не накрив панель.
  wasPlaying = D.G.Game.state === 'play';
  if (wasPlaying) { D.G.Game.state = 'dbg'; D.Input.enable(false); }
  refresh();
}
function hide() {
  open = false;
  if (panel) panel.classList.remove('on');
  if (wasPlaying) { D.G.Game.state = 'play'; D.Input.enable(true); D.Input.clearEdges(); }
  wasPlaying = false;
}

export const Debug = {
  get open() { return open; },
  get errors() { return errors; },

  /** Червона рамка й напис GOD MODE, поки активний хоч який чит. */
  frame(on) {
    if (on === frameOn) return;
    frameOn = on;
    if (frameEl) frameEl.classList.toggle('on', !!on);
    if (btn) btn.classList.toggle('hot', !!on);
  },

  /**
   * Викликається один раз із main.js, коли DEV_MODE === true.
   * Стилі, кнопка DBG і рамка GOD MODE створюються тут, а не в
   * index.html / style.css: у релізній збірці від них не має лишитись
   * навіть рядка розмітки.
   */
  init(deps) {
    D = deps;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);

    // Кнопка живе поза шаром керування: інакше зникала б разом із
    // кнопками щоразу, коли ввід блокується (панель, пауза, меню).
    btn = el('button', null, 'DBG');
    btn.id = 'btnDbg';
    btn.onclick = e => { e.preventDefault(); e.stopPropagation(); open ? hide() : show(); };
    frameEl = el('div');
    frameEl.id = 'godFrame';
    frameEl.appendChild(el('span', null, 'GOD MODE'));
    const app = document.getElementById('app') || document.body;
    app.appendChild(btn); app.appendChild(frameEl);
    // Останні помилки збираємо самі — на телефоні консолі немає.
    const push = m => { errors.push(m.slice(0, 160)); if (errors.length > 10) errors.shift(); };
    window.addEventListener('error', e => push(e.message || String(e.error)));
    window.addEventListener('unhandledrejection', e => push('promise: ' + (e.reason && e.reason.message || e.reason)));
    const ce = console.error.bind(console);
    console.error = (...a) => { push(a.map(String).join(' ')); ce(...a); };
    // F1 / клавіша D — швидко відкрити панель з клавіатури
    window.addEventListener('keydown', e => {
      if (e.code === 'F1' || (e.code === 'KeyG' && e.shiftKey)) { e.preventDefault(); open ? hide() : show(); }
      if (e.code === 'Period' && CH.frozen) { CH.stepOnce = 1; }
    });
  },
  hide
};
