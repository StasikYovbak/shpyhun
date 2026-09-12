/**
 * ЯДРО ГРИ — фізика, світ, герой, вороги, боси, стан гри.
 * Перенесено з версії 1.x майже дослівно: змінився лише шар малювання,
 * який тепер живе в src/render/. Тут немає жодного звертання до canvas.
 */
import { DEV_MODE,
  VW, VH, TS, DT, MAXDT, CONFIG, PH, BL, RG, SPR, BSPR, px as SC, SCALE, S, Si,
  clamp, lerp, sign, rnd, rndi, aabb, boxHit, dist2, mulberry
} from './config.js';
import { Store } from './store.js';
import { LEVELS } from './levels.js';
import { THEME } from './themes.js';
import { Sfx, Music, buzz } from './audio.js';
import { Input } from './input.js';
import { Cut, script as cutScript } from './cutscene.js';
import { CH } from './cheats.js';
import { D as DIFF, setDiff, HARDEST } from './difficulty.js';
import { makeTutorial, STEPS as TUT_STEPS, PARRY_NEED, PARRY_GIVEUP } from './tutorial.js';
import { WEAPONS, LEVEL_REWARD, FRAG_LEVELS } from './weapons.js';

/** Гачки в бік інтерфейсу — щоб ядро не знало нічого про DOM. */
export const hooks = {
  showScreen() { }, refreshLevels() { }, refreshProgress() { },
  setClear() { }, setWinStat() { },
  showReward(reward, next) { next(); },
  askAssist() { }
};

/* ---------------- частинки (масив із компактуванням) ---------------- */
const PARTS = [];
const PART_MAX = 260;
/**
 * Позиція вже у світових пікселях, а от РОЗЛІТ, РОЗМІР і ТЯЖІННЯ
 * частки — це магнітуди, тож їх множить SCALE просто тут. Одна правка
 * замість двох сотень по всіх викликах burst/part у файлі.
 */
function part(x, y, vx, vy, life, col, size, grav, kind) {
  if (PARTS.length >= PART_MAX) PARTS.shift();
  PARTS.push({ x: x, y: y, vx: S(vx), vy: S(vy), t: life, max: life, col: col,
               s: S(size || 1), g: S(grav === undefined ? 260 : grav), k: kind || 0 });
}
function burst(x, y, n, col, spd, life, grav, size) {
  for (let i = 0; i < n; i++) {
    const a = rnd(0, Math.PI * 2), v = rnd(spd * 0.35, spd);
    part(x, y, Math.cos(a) * v, Math.sin(a) * v, rnd(life * 0.55, life), col,
         size || 1, grav === undefined ? 220 : grav, 0);
  }
}
function updateParts(dt) {
  for (let i = PARTS.length - 1; i >= 0; i--) {
    const p = PARTS[i];
    p.t -= dt;
    if (p.t <= 0) { PARTS[i] = PARTS[PARTS.length - 1]; PARTS.pop(); continue; }
    p.vy += p.g * dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
  }
}


/* ---------------- спливаючі кільця/хвилі ---------------- */
const RINGS = [];
/** Радіуси кільця — теж магнітуди, тож масштабуються тут. */
function ring(x, y, r0, r1, life, col, width) {
  if (RINGS.length > 30) RINGS.shift();
  RINGS.push({ x: x, y: y, r0: S(r0), r1: S(r1), t: life, max: life, col: col,
               w: S(width || 1) });
}
function updateRings(dt) {
  for (let i = RINGS.length - 1; i >= 0; i--) {
    RINGS[i].t -= dt;
    if (RINGS[i].t <= 0) { RINGS[i] = RINGS[RINGS.length - 1]; RINGS.pop(); }
  }
}


/* ------------- візуальний почерк зброї -------------
   Кожна зброя лишає на екрані власний слід. Тут тільки дані й таймери:
   малює це render/index.js, шкоди ці об'єкти не завдають. */
const WFX = [];
const WFX_MAX = 64;
function wfx(o) {
  if (WFX.length >= WFX_MAX) WFX.shift();
  o.max = o.t; WFX.push(o); return o;
}
function updateWfx(dt) {
  for (let i = WFX.length - 1; i >= 0; i--) {
    const f = WFX[i];
    f.t -= dt;
    if (f.vx) { f.x += f.vx * dt; f.vx *= 0.9; }
    if (f.vy) { f.y += f.vy * dt; f.vy *= 0.9; }
    if (f.t <= 0) { WFX[i] = WFX[WFX.length - 1]; WFX.pop(); }
  }
}

/* ---------------- камера ---------------- */
/** Ширина/висота видимого кадру. Рендер розширює w до 528 px на витягнутих
 *  екранах — щоб замість чорних смуг було більше огляду. */
export const view = { w: VW, h: VH };
const cam = {
  x: 0, y: 0, shake: 0, shakeT: 0, lockX0: -1, lockX1: -1,
  reset(px, py) {
    this.shake = 0; this.shakeT = 0; this.lockX0 = -1; this.lockX1 = -1;
    this.x = clamp(px - view.w / 2, 0, Math.max(0, world.pw - view.w));
    this.y = clamp(py - view.h / 2, 0, Math.max(0, world.ph - view.h));
  },
  hit(mag) { this.shake = Math.max(this.shake, mag); this.shakeT = 0.28; },
  update(dt, tx, ty) {
    let minX = 0, maxX = Math.max(0, world.pw - view.w);
    // На аренах босів камеру раніше прибивало до меж арени — через це
    // героїня з'їжджала з центра «щоб показати боса». У режимі «по центру»
    // цього винятку немає: межі лишаються тільки в світу.
    if (this.lockX0 >= 0 && Store.data.cam === 1) {
      const span = this.lockX1 - this.lockX0;
      if (span <= view.w) {
        // кадр ширший за арену — центруємо арену, а не показуємо порожнечу за нею
        const c = clamp((this.lockX0 + this.lockX1) / 2 - view.w / 2, 0, Math.max(0, world.pw - view.w));
        minX = maxX = c;
      } else { minX = this.lockX0; maxX = this.lockX1 - view.w; }
    }
    // «По центру» (за замовчуванням): героїня жорстко в центрі кадру —
    // ні мертвої зони, ні випередження, ні зсуву вниз. Це прямо проти
    // того, щоб палець ховав її за собою. «Класична» лишає старий
    // варіант зі згладжуванням і зсувом на 5 % вниз.
    const classic = Store.data.cam === 1;
    const gx = clamp(tx - view.w / 2, minX, maxX);
    const gy = clamp(ty - view.h * (classic ? 0.55 : 0.5), 0, Math.max(0, world.ph - view.h));
    this.x = classic ? lerp(this.x, gx, clamp(dt * 9, 0, 1)) : gx;
    // по вертикалі згладжування лишається завжди — інакше кадр сіпається
    // на кожному стрибку — але цілиться рівно в центр
    this.y = lerp(this.y, gy, clamp(dt * (classic ? 7 : 11), 0, 1));
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      if (this.shakeT <= 0) this.shake = 0; else this.shake *= 0.90;
    }
  },
  // Зсув для малювання (з тремтінням), завжди цілі пікселі.
  ox() { return Math.round(this.x + (this.shake > 0.2 ? rnd(-this.shake, this.shake) : 0)); },
  oy() { return Math.round(this.y + (this.shake > 0.2 ? rnd(-this.shake, this.shake) : 0)); }
};

/* ================================================================
   7. СВІТ: розбір карти, доступ до тайлів, AABB-колізії
   ================================================================ */
const T_EMPTY = 0, T_SOLID = 1, T_PLAT = 2, T_SPIKE = 3, T_CONVR = 4, T_CONVL = 5, T_CRACK = 6;
const TILE_CODE = { '.': T_EMPTY, '#': T_SOLID, '=': T_PLAT, '^': T_SPIKE, '>': T_CONVR,
                   '<': T_CONVL, 'x': T_CRACK };
const ENEMY_CODE = {
  s: 'skreb', h: 'thug', t: 'turret', w: 'wasp', k: 'kami',
  d: 'shield', a: 'adept', f: 'phantom', p: 'spider',
  // моби-передвісники босів
  r: 'rammer',   // тарано-бот: розгін у стіну (Сервотавр)
  n: 'anvil',    // ковадло: удар об землю з низькою хвилею (Сервотавр)
  c: 'carrier',  // дрон-носій: спавнить малих (Матка-Рій)
  y: 'pylon',    // настінний вузол: щит на сусідах (Матка-Рій)
  b: 'blinker',  // блінк-щур: телепорт за спину (Хроноклинок)
  m: 'worm',     // тайл-хробак: з'їдає платформу під ногами (Гліч-Ядро)
  '1': 'arch1', '2': 'arch2', '3': 'arch3'   // конструкти-архіви (Архітектор)
};

const world = {
  idx: 0, def: null, tw: 0, th: 0, pw: 0, ph: 0, tiles: null,
  theme: 'slum', bossType: null, bossX: 0,
  spawn: { x: 32, y: 32 }, cp: { x: 32, y: 32 }, cpTaken: false, cps: [],
  exit: { x: 0, y: 0 }, exitOpen: true,
  mp: [], off: null, grav: 1, dark: false, time: 0, rng: null,
  spawnList: [], pickList: []
};

function tAt(tx, ty) {
  if (tx < 0 || tx >= world.tw) return T_SOLID;      // краї карти — стіни
  if (ty < 0 || ty >= world.th) return T_EMPTY;      // вгорі небо, внизу прірва
  const i = ty * world.tw + tx;
  if (world.off && world.off[i]) return T_EMPTY;     // «вимкнено» ГЛІТЧ-ЯДРОМ
  return world.tiles[i];
}
const isSolidCode = c => (c === T_SOLID || c === T_CONVR || c === T_CONVL || c === T_CRACK);
function solidAtPx(px, py) { return isSolidCode(tAt(Math.floor(px / TS), Math.floor(py / TS))); }

// Чи є під точкою тверда опора (для ІІ ворогів — щоб не падали з країв).
function groundAhead(x, y) { return solidAtPx(x, y) || tAt(Math.floor(x / TS), Math.floor(y / TS)) === T_PLAT; }

/* --- рух по осі X: спочатку X, потім Y (прибирає застрягання в кутах) --- */
function moveX(e, dx) {
  if (dx === 0) return false;
  const steps = Math.max(1, Math.ceil(Math.abs(dx) / 6));
  const sd = dx / steps;
  let hit = false;
  for (let s = 0; s < steps; s++) {
    e.x += sd;
    const x0 = Math.floor(e.x / TS), x1 = Math.floor((e.x + e.w - 1) / TS);
    const y0 = Math.floor(e.y / TS), y1 = Math.floor((e.y + e.h - 1) / TS);
    let col = false;
    for (let ty = y0; ty <= y1 && !col; ty++)
      for (let tx = x0; tx <= x1 && !col; tx++)
        if (isSolidCode(tAt(tx, ty))) col = true;
    if (col) {
      if (sd > 0) e.x = Math.floor((e.x + e.w - 1) / TS) * TS - e.w;
      else e.x = (Math.floor(e.x / TS) + 1) * TS;
      hit = true;
      break;
    }
  }
  return hit;
}

/* --- рух по осі Y; oneWay=true означає, що сутність зважає на платформи '=' --- */
/* Нижню грань перевіряємо з відступом EPS, а не цілим пікселем.
   З відступом 1 px коробка встигала занурюватись у підлогу майже на
   піксель, перш ніж зіткнення взагалі помічалось: тому герой, що
   спокійно стоїть, кожні три кадри «відривався» від землі (onGround
   миготів 1-0-0-1-0-0), а анімація сіпалась між IDLE і FALL 20 разів
   на секунду. EPS менший за крок гравітації за кадр (0,39 px) — тепер
   зіткнення ловиться того ж кадру. */
const EPS = 0.01;
function moveY(e, dy, oneWay) {
  if (dy === 0) return 0;
  const steps = Math.max(1, Math.ceil(Math.abs(dy) / 6));
  const sd = dy / steps;
  let res = 0;                                     // 1 = вдарився низом, -1 = стелею
  for (let s = 0; s < steps; s++) {
    const prevBottom = e.y + e.h;
    e.y += sd;
    const x0 = Math.floor(e.x / TS), x1 = Math.floor((e.x + e.w - 1) / TS);
    const y0 = Math.floor(e.y / TS), y1 = Math.floor((e.y + e.h - EPS) / TS);
    let col = false, colTy = 0;
    for (let ty = y0; ty <= y1 && !col; ty++)
      for (let tx = x0; tx <= x1 && !col; tx++)
        if (isSolidCode(tAt(tx, ty))) { col = true; colTy = ty; }
    if (col) {
      // ставимо впритул до саме того ряду, з яким зіткнулись
      if (sd > 0) { e.y = colTy * TS - e.h; res = 1; }
      else { e.y = (colTy + 1) * TS; res = -1; }
      break;
    }
    // односторонні платформи — тільки при русі вниз і якщо були вище краю
    if (sd > 0 && oneWay) {
      const ty = Math.floor((e.y + e.h - EPS) / TS);
      const top = ty * TS;
      if (prevBottom <= top + 1 && e.y + e.h > top) {
        let plat = false;
        for (let tx = x0; tx <= x1 && !plat; tx++) if (tAt(tx, ty) === T_PLAT) plat = true;
        if (plat) { e.y = top - e.h; res = 1; break; }
      }
    }
  }
  return res;
}

// Рухома платформа під сутністю (одностороння, як '=').
function mpUnder(e) {
  for (let i = 0; i < world.mp.length; i++) {
    const m = world.mp[i];
    if (e.x + e.w > m.x + 1 && e.x < m.x + m.w - 1 &&
        e.y + e.h >= m.y - 1 && e.y + e.h <= m.y + 6) return m;
  }
  return null;
}
function landOnMP(e, prevBottom) {
  for (let i = 0; i < world.mp.length; i++) {
    const m = world.mp[i];
    if (e.x + e.w > m.x + 1 && e.x < m.x + m.w - 1 &&
        prevBottom <= m.y + 1 && e.y + e.h > m.y && e.y + e.h < m.y + 10) {
      e.y = m.y - e.h; return m;
    }
  }
  return null;
}

/* --- завантаження рівня --- */
function loadLevel(idx) {
  const def = LEVELS[idx];
  world.idx = idx; world.def = def;
  world.theme = def.th; world.bossType = def.boss;
  const rows = def.rows;
  world.th = rows.length; world.tw = rows[0].length;
  world.pw = world.tw * TS; world.ph = world.th * TS;
  world.tiles = new Uint8Array(world.tw * world.th);
  world.off = null; world.grav = 1;
  world.dark = (def.th === 'metro');
  world.signDark = false;
  world.time = 0; world.rng = mulberry(1337 + idx * 7919);
  world.spawnList = []; world.pickList = [];
  world.bossX = 0; world.exitOpen = !def.boss;
  world.cpTaken = false;
  world.mp = []; world.cps = []; world.eaten = [];
  for (let i = 0; i < def.mp.length; i++) {
    const m = def.mp[i];
    const px = m[0] * TS, py = m[1] * TS, pw = m[2] * TS;
    world.mp.push({
      x: px, y: py, w: pw, h: 5, axis: m[3], sp: m[5], dir: 1,
      a: m[3] === 'h' ? px : py, b: m[3] === 'h' ? px + m[4] * TS : py + m[4] * TS,
      dx: 0, dy: 0
    });
  }
  for (let ty = 0; ty < world.th; ty++) {
    const r = rows[ty];
    for (let tx = 0; tx < world.tw; tx++) {
      const ch = r.charAt(tx);
      const code = TILE_CODE[ch];
      if (code !== undefined) { world.tiles[ty * world.tw + tx] = code; continue; }
      world.tiles[ty * world.tw + tx] = T_EMPTY;
      const px = tx * TS, py = ty * TS;
      if (ch === '@') { world.spawn.x = px + 2; world.spawn.y = py + 1;
                        world.cp.x = world.spawn.x; world.cp.y = world.spawn.y; }
      else if (ch === '$') { world.cps.push({ x: px + 2, y: py + 1, taken: false }); }
      else if (ch === 'E') { world.exit.x = px; world.exit.y = py - TS; }
      else if (ch === '+') { world.pickList.push({ x: px + 3, y: py + 4, kind: 'med' }); }
      else if (ch === '*') { world.pickList.push({ x: px + 3, y: py + 4, kind: 'frag' }); }
      else if (ch === '?') { world.pickList.push({ x: px + 3, y: py + 4, kind: 'log' }); }
      else if (ch === '!') { world.bossX = px; }
      else {
        const low = ch.toLowerCase();
        const type = ENEMY_CODE[low];
        if (type) world.spawnList.push({ t: type, x: px, y: py, elite: ch !== low });
      }
    }
  }
  // Чекпоінт просто перед ареною боса: смерть повертає одразу до боса,
  // а не в початок сектора. Плюс дві аптечки на самій арені — вони
  // відновлюються на кожній спробі разом з рештою пікапів.
  if (world.bossX > 0) {
    const gy = 12 * TS + 1;
    world.cps.push({ x: world.bossX - Si(34), y: gy, taken: false, boss: true });
    world.pickList.push({ x: world.bossX + Si(80), y: gy + Si(3), kind: 'med' });
    world.pickList.push({ x: world.bossX + Si(260), y: gy + Si(3), kind: 'med' });
  }
  if (!world.cps.length) world.cps.push({ x: world.spawn.x, y: world.spawn.y, taken: false });
  world.cpPos = world.cps[0];                       // сумісність зі старим кодом/тестами
  // Механіка й секрети вбудовуються в УЖЕ зібраний світ: тайли на
  // місці, список пікапів існує. Інакше прес ставав би посеред стіни,
  // ніша прорізалась би в порожнечу, а нагороду з неї одразу ж затерло б.
  levelFxInit(def);
  levelSecrets(def, idx);
}



/* ================================================================
   ХАРАКТЕР РІВНЯ
   Темрява в метро вийшла найцікавішою рівно тому, що це МЕХАНІКА, а
   не декорація: вона міняє те, ЯК ти граєш. Тут те саме дано кожному
   сектору — по одній головній ідеї на рівень.

   Правило для всіх десяти однакове:
     — вводиться в безпечному місці, де помилка нічого не коштує;
     — повторюється три-чотири рази, щоразу складніше;
     — бос цього (або наступного) сектора користується ТІЄЮ САМОЮ ідеєю,
       тож рівень виявляється тренуванням перед боєм.

   Механіки тримаються на вже наявних системах: ZONES ранять, TELE
   попереджає, world.dark гасить світло, mp возить платформи. Нового
   стану — мінімум, і весь він у LFX.
   ================================================================ */
const LFX = {
  on: false, kind: '', t: 0, zones: [], wind: 0, windT: 0, heat: 0,
  presses: [], trains: [], signs: [], holo: null, holoT: 0, grav: [], beat: 0,
  crumble: [], fog: 0, vista: [], vaults: [], chal: null, arcade: null
};
/**
 * Смерть не має лишати гравця в пастці: обвалена підлога повертається
 * на місце разом із респавном, а лічильники механік — у вихідний стан.
 */
function levelFxRespawn() {
  for (const c of LFX.crumble) {
    if (c.gone && c.cells && world.off) for (const i of c.cells) world.off[i] = 0;
    c.gone = 0; c.t = 0; c.cells = null;
  }
  for (const m of LFX.presses) { m.st = 'up'; m.t = m.cd; }
  for (const tr of LFX.trains) { tr.st = 'wait'; tr.t = tr.cd; }
  LFX.wind = 0; LFX.windT = 1.5;
  if (world.grav < 0) world.grav = 1;
}

/* ----------------------------------------------------------------
   СЕКРЕТИ Й ВИКЛИКИ
   Три речі, які роблять сектор вартим того, щоб у ньому озирнутись:
     — тріснута стіна, за якою ніша з нагородою: ламає тільки Тавро;
     — кімната-виклик: зайшов — 15 секунд на те, щоб вибити всіх;
     — одна пасхалка на всю гру: аркадний автомат, на якому крутиться
       демка цієї ж гри.
   Усе це вбудовується в уже завантажений світ, а не в карти: тайли
   міняються після розбору рядків, тож жодна карта не переписується.
   ---------------------------------------------------------------- */
function carveVault(tx, ty) {
  // ніша 3x2 в товщі підлоги, запечатана тріснутим тайлом
  for (let y = ty; y < ty + 2; y++)
    for (let x = tx; x < tx + 3; x++) {
      const i = y * world.tw + x;
      if (i >= 0 && i < world.tiles.length) world.tiles[i] = T_EMPTY;
    }
  for (let y = ty; y < ty + 2; y++) {
    const i = y * world.tw + (tx - 1);
    if (i >= 0 && i < world.tiles.length) world.tiles[i] = T_CRACK;
  }
  world.pickList.push({ x: (tx + 1) * TS + Si(3), y: ty * TS + Si(4),
                        kind: Math.random() < 0.5 ? 'med' : 'log' });
  LFX.vaults.push({ x: (tx - 1) * TS, y: ty * TS, open: 0 });
}
/** Знайти рівну ділянку підлоги правіше за задану точку. */
/**
 * Найближча рівна ділянка підлоги правіше за задану точку. Рядок
 * підлоги в кожному секторі свій (на дахах він вище), тож шукаємо його
 * самі, а не припускаємо 13-й. Повертає тайлову колонку або -1.
 */
function groundRow(tx) {
  for (let ty = 10; ty < world.th; ty++) if (tAt(tx, ty) === T_SOLID) return ty;
  return -1;
}
function flatSpotAfter(px0) {
  const W = world.tw;
  for (let pass = 0; pass < 2; pass++) {
    const from = pass === 0 ? Math.max(2, Math.floor(px0 / TS)) : 2;
    for (let tx = from; tx < W - 7; tx++) {
      const g = groundRow(tx);
      if (g < 10) continue;
      let ok = true;
      for (let k = 0; k < 5; k++) {
        if (groundRow(tx + k) !== g) { ok = false; break; }
        if (tAt(tx + k, g - 1) !== T_EMPTY || tAt(tx + k, g - 2) !== T_EMPTY) { ok = false; break; }
      }
      if (ok) return tx;
    }
  }
  return -1;
}
function levelSecrets(def, idx) {
  LFX.vaults.length = 0; LFX.chal = null; LFX.arcade = null;
  // дві тріснуті ніші на сектор, у першій і третій чверті
  for (const frac of [0.28, 0.66]) {
    const tx = flatSpotAfter(world.pw * frac);
    if (tx > 0) carveVault(tx + 1, groundRow(tx));
  }
  // кімната-виклик: одна на сектор, у другій половині
  const cx = flatSpotAfter(world.pw * 0.52);
  if (cx > 0) LFX.chal = { x: cx * TS, w: Si(200), gy: groundRow(cx) * TS,
                           st: 'idle', t: 0, foes: [], done: 0 };
  // пасхалка — рівно одна на гру, у метро: там темно й на неї натикаєшся
  if (idx === 4) {
    const ax = flatSpotAfter(world.pw * 0.44);
    if (ax > 0) LFX.arcade = { x: ax * TS + Si(20), y: groundRow(ax) * TS - Si(26) };
  }
}
/** Кімната-виклик: зайшов — 15 секунд, щоб вибити всіх. Нагорода за темп. */
function challengeUpdate(dt) {
  const c = LFX.chal;
  if (!c || c.done) return;
  const inRoom = P.x + P.w / 2 > c.x && P.x + P.w / 2 < c.x + c.w;
  if (c.st === 'idle') {
    if (!inRoom) return;
    c.st = 'run'; c.t = 15;
    holoHint(c.x + c.w / 2, c.gy - Si(40), 'chal');
    Sfx.charge(); cam.hit(3);
    const kinds = ['skreb', 'thug', 'wasp', 'skreb'];
    for (let i = 0; i < 4; i++) {
      const e = spawnEnemy(kinds[i], c.x + Si(30) + i * Si(42), c.gy - Si(40), i === 3);
      if (e) { e.alertSt = 'fight'; c.foes.push(e); }
    }
    return;
  }
  c.t -= dt;
  const alive = c.foes.filter(e => !e.dead).length;
  if (alive === 0) {
    c.done = 1; c.st = 'won';
    Sfx.win(); cam.hit(5); buzz(24);
    ring(P.x + P.w / 2, P.y + P.h / 2, 4, Si(60), 0.6, '#ffd23f', 3);
    PICKS.push({ x: P.x, y: P.y - Si(14), t: 0, kind: 'log' });
    PICKS.push({ x: P.x + Si(20), y: P.y - Si(14), t: 0, kind: 'med' });
  } else if (c.t <= 0) {
    c.done = 1; c.st = 'lost';                      // не встиг — просто без нагороди
    Sfx.blocked();
  }
}

/** Голограма-підказка: дві секунди анімації замість абзацу тексту. */
function holoHint(x, y, kind) { LFX.holo = { x: x, y: y, k: kind }; LFX.holoT = 2.0; }

function levelFxInit(def) {
  LFX.on = true; LFX.kind = def.th; LFX.t = 0;
  LFX.zones.length = 0; LFX.presses.length = 0; LFX.trains.length = 0;
  LFX.signs.length = 0; LFX.grav.length = 0; LFX.crumble.length = 0;
  LFX.vista.length = 0;
  LFX.wind = 0; LFX.windT = 0; LFX.heat = 0; LFX.fog = 0; LFX.beat = 0;
  LFX.holo = null; LFX.holoT = 0;
  const W = world.pw, G0 = 12 * TS;
  const R = world.rng || Math.random;
  // Точки «введення -> ускладнення x3» рівномірно по довжині сектора:
  // перша — одразу після спавну, де помилка нічого не коштує. Кожна
  // сідає на НАЙБЛИЖЧУ рівну підлогу: інакше прес опиняється в стіні,
  // а зона спеки — над прірвою.
  const at = k => {
    const want = W * (0.14 + k * 0.21);
    const tx = flatSpotAfter(want);
    return tx > 0 ? tx * TS : Math.round(want);
  };
  /** Рядок підлоги під конкретною точкою, у пікселях. */
  const gyAt = pxs => {
    const g = groundRow(Math.floor(pxs / TS) + 2);
    return (g > 0 ? g : 13) * TS;
  };
  switch (def.th) {
    case 'slum':                                   // 1. ДОЩ І ЗЛАМАНІ ВИВІСКИ
      for (let i = 0; i < 4; i++)
        LFX.signs.push({ x: at(i), w: Si(110) + i * Si(40), t: 1.5 + i * 0.4,
                         off: 0, dur: 0.5 + i * 0.35 });
      break;
    case 'docks':                                  // 2. КРАНИ Й КОНТЕЙНЕРИ
      for (let i = 0; i < 4; i++)
        LFX.presses.push({ x: at(i), gy: gyAt(at(i)), w: Si(44), h: Si(44), t: 2.2 + i * 0.5,
                           cd: 3.4 - i * 0.4, st: 'up', kind: 'crate' });
      break;
    case 'roofs':                                  // 3. ВІТЕР І ЗИПЛАЙНИ
      LFX.windT = 2.5;
      break;
    case 'factory':                                // 4. КОНВЕЄРИ Й ПРЕСИ
      for (let i = 0; i < 4; i++)
        LFX.presses.push({ x: at(i), gy: gyAt(at(i)), w: Si(52), h: Si(30), t: 1.6 + i * 0.4,
                           cd: 2.8 - i * 0.35, st: 'up', kind: 'press' });
      break;
    case 'metro':                                  // 5. ТЕМРЯВА + ПОТЯГИ
      for (let i = 0; i < 4; i++)
        LFX.trains.push({ x: 0, t: 3.5 + i * 1.1, cd: 6.5 - i * 0.8, dir: i % 2 ? 1 : -1,
                          y: G0 - Si(46), st: 'wait' });
      break;
    case 'garden':                                 // 6. ТУМАН І ДЗЕРКАЛЬНІ КАЛЮЖІ
      LFX.fog = 1;
      break;
    case 'server':                                 // 7. СПЕКА Й ХОЛОДНІ ОСТРІВЦІ
      for (let i = 0; i < 4; i++)
        LFX.zones.push({ x: at(i), w: Si(150) + i * Si(50), hot: 1 });
      for (let i = 0; i < 3; i++)
        LFX.zones.push({ x: at(i) + Si(190), w: Si(70), hot: 0 });
      break;
    case 'virtual':                                // 8. ІНВЕРСІЯ ГРАВІТАЦІЇ + РИТМ
      for (let i = 0; i < 4; i++) LFX.grav.push({ x: at(i), w: Si(130) + i * Si(30) });
      break;
    case 'spire':                                  // 9. ПІДЙОМ НА ЧАС
      LFX.windT = 3.0;
      for (let i = 0; i < 4; i++) LFX.crumble.push({ x: at(i), w: Si(160), t: 0, gone: 0 });
      break;
    case 'core':                                   // 10. УСЕ РАЗОМ, ПО ЗОНІ НА МЕХАНІКУ
      LFX.signs.push({ x: at(0), w: Si(120), t: 1.6, off: 0, dur: 0.7 });
      LFX.presses.push({ x: at(1), gy: gyAt(at(1)), w: Si(52), h: Si(30), t: 1.8,
                           cd: 2.4, st: 'up', kind: 'press' });
      LFX.trains.push({ x: 0, t: 4, cd: 6, dir: -1, y: G0 - Si(46), st: 'wait' });
      LFX.zones.push({ x: at(2), w: Si(170), hot: 1 });
      LFX.grav.push({ x: at(3), w: Si(140) });
      LFX.windT = 3.5;
      break;
  }
  // Краєвиди: одне-два місця на сектор, де камера відкриває місто.
  LFX.vista.push({ x: Math.round(W * 0.33) }, { x: Math.round(W * 0.72) });
}

/** Чи стоїть гравець у зоні [x, x+w]. */
const inSpan = (z) => P.x + P.w / 2 > z.x && P.x + P.w / 2 < z.x + z.w;

function levelFx(dt) {
  if (!LFX.on || Game.state !== 'play') return;
  LFX.t += dt;
  if (LFX.holoT > 0) LFX.holoT -= dt;
  challengeUpdate(dt);
  const G0 = 12 * TS;
  // На арені боса небезпеки СЕКТОРА мовчать. Ідею підхоплює сам бос —
  // саме тому рівень і був тренуванням перед ним; якщо ж прес далі
  // гатить під час бою, гравець отримує дві незалежні атаки одночасно,
  // і жодна модель балансу такого не витримує (перевірено: Матка-Рій
  // виходила за стелю HP рівно через це).
  if (BOSS.on) {
    for (const m of LFX.presses) { m.st = 'up'; m.t = Math.max(m.t, 1); }
    for (const tr of LFX.trains) { tr.st = 'wait'; tr.t = Math.max(tr.t, 1); }
    LFX.wind = 0;
    return;
  }

  /* --- 1/10. ВИВІСКИ: блимнули — і ділянка на мить у темряві --- */
  for (const s of LFX.signs) {
    s.t -= dt;
    if (s.t <= 0) { s.off = s.dur; s.t = 2.6 + Math.random() * 1.8; Sfx.blocked(); }
    if (s.off > 0) s.off -= dt;
    if (inSpan({ x: s.x, w: s.w }) && s.off > 0.3 && LFX.holoT <= 0 && !s.seen) {
      s.seen = 1; holoHint(s.x + s.w / 2, G0 - Si(40), 'dark');
    }
  }
  // Гасне САМЕ ДІЛЯНКА, а не весь екран: і за змістом («на мить
  // занурюючи ділянку в темряву»), і за ціною — заливка на весь кадр у
  // програмному рендері коштує більше за все інше разом.
  const dk = LFX.signs.find(s => s.off > 0 && inSpan({ x: s.x, w: s.w }));
  world.signDark = dk ? { x: dk.x, w: dk.w } : null;

  /* --- 2/4/10. ПРЕСИ Й КОНТЕЙНЕРИ: б'ють за телеграфом, ними ж давлять --- */
  for (const m of LFX.presses) {
    m.t -= dt;
    if (m.st === 'up' && m.t <= 0) {
      m.st = 'tel'; m.t = 0.9;
      telegraph(m.x, m.gy - m.h, m.w, m.h, 0.9, '#ff6b3d', 1);
      if (!m.seen) { m.seen = 1; holoHint(m.x + m.w / 2, m.gy - Si(46), m.kind); }
    } else if (m.st === 'tel' && m.t <= 0) {
      m.st = 'down'; m.t = 0.45;
      const z = zone(m.x, m.gy - m.h, m.w, m.h, 0.45, 1, m.kind === 'press' ? '#ff6b3d' : '#c9a227', 1);
      z.crush = 1;                                 // цим же можна розчавити ворога
      Sfx.explode(); cam.hit(4);
      for (let i = 0; i < 10; i++)
        part(m.x + rnd(0, m.w), m.gy - 2, rnd(-120, 120), rnd(-90, -10), rnd(0.3, 0.7), '#c9b08a', 2, 260, 1);
    } else if (m.st === 'down' && m.t <= 0) { m.st = 'up'; m.t = m.cd; }
  }

  /* --- 3/9/10. ВІТЕР: штовхає в повітрі, напрямок видно по дощу --- */
  if (LFX.windT > 0) {
    LFX.windT -= dt;
    if (LFX.windT <= 0) {
      LFX.wind = (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.6);
      LFX.windT = 2.4 + Math.random() * 2.2;
      if (LFX.kind === 'roofs' && LFX.holoT <= 0 && LFX.t < 12) holoHint(P.x, P.y - Si(30), 'wind');
    }
    // Вітер ЗНОСИТЬ, а не «підштовхує»: якщо додавати його до vx, його
    // повністю з'їдає гальмування в повітрі (450 px/с² проти 345) і на
    // екрані не відбувається нічого. Тому це прямий знос позиції —
    // як течія: керування лишається, але тебе несе.
    if (!P.onGround && LFX.wind) moveX(P, LFX.wind * S(80) * dt);
  }

  /* --- 5/10. ПОТЯГИ: проносяться по сусідній колії з попередженням --- */
  for (const tr of LFX.trains) {
    tr.t -= dt;
    if (tr.st === 'wait' && tr.t <= 0) {
      tr.st = 'tel'; tr.t = 1.4;
      const cx = P.x + P.w / 2;
      tr.x = tr.dir > 0 ? cx - Si(420) : cx + Si(420);
      telegraph(Math.min(tr.x, cx) - Si(60), tr.y, Si(900), Si(40), 1.4, '#ffd23f', 2);
      Sfx.charge();
      if (!tr.seen) { tr.seen = 1; holoHint(cx, tr.y - Si(20), 'train'); }
    } else if (tr.st === 'tel' && tr.t <= 0) {
      tr.st = 'run'; tr.t = 2.2;
      const z = zone(tr.x, tr.y, Si(260), Si(40), 2.2, 1, '#ffd23f', 2);
      z.vx = tr.dir * S(520); z.crush = 1;
      Sfx.dash(); cam.hit(6);
    } else if (tr.st === 'run' && tr.t <= 0) { tr.st = 'wait'; tr.t = tr.cd; }
  }

  /* --- 7/10. СПЕКА: у гарячій зоні зброя гріється вдвічі швидше --- */
  if (LFX.zones.length) {
    const hot = LFX.zones.some(z => z.hot && inSpan(z));
    const cold = LFX.zones.some(z => !z.hot && inSpan(z));
    LFX.heat = hot ? 1 : (cold ? -1 : 0);
    if (!hot && !cold) P.heatK = 1;
    P.heatK = hot ? 2 : 1;                          // у спеці зброя гріється ВДВІЧІ швидше
    if (hot) {
      P.heat = Math.min(140, P.heat + 14 * dt);      // і сама пашить, навіть коли мовчить
      if (Math.random() < dt * 8)
        part(P.x + rnd(0, P.w), P.y + P.h, rnd(-10, 10), rnd(-40, -10), 0.6, '#ff6b3d', 1, -30, 1);
      if (!LFX.hotSeen) { LFX.hotSeen = 1; holoHint(P.x, P.y - Si(30), 'heat'); }
    } else if (cold) {
      P.heat = Math.max(0, P.heat - 30 * dt);       // холодний острівець гасить перегрів
      if (Math.random() < dt * 5)
        part(P.x + rnd(0, P.w), P.y, rnd(-8, 8), rnd(10, 30), 0.5, '#7df9ff', 1, -10, 1);
    }
  }

  /* --- 8/10. ІНВЕРСІЯ ГРАВІТАЦІЇ + ПЛАТФОРМИ В ТАКТ --- */
  if (LFX.grav.length) {
    const inv = LFX.grav.some(z => inSpan(z));
    if (inv && world.grav > 0 && !BOSS.on) {
      world.grav = -1; Sfx.parry(); cam.hit(3);
      ring(P.x + P.w / 2, P.y + P.h / 2, 4, Si(40), 0.4, '#8f6fff', 2);
      if (!LFX.gravSeen) { LFX.gravSeen = 1; holoHint(P.x, P.y - Si(30), 'grav'); }
    } else if (!inv && world.grav < 0 && !BOSS.on) {
      world.grav = 1; Sfx.parry();
    }
    LFX.beat = (LFX.beat + dt) % 2.0;               // такт: платформи з'являються на долю
  }

  /* --- 9/10. ПІДЙОМ НА ЧАС: підлога обвалюється позаду --- */
  for (const c of LFX.crumble) {
    if (!c.gone && P.x > c.x + c.w * 0.4) {
      c.t += dt;
      if (!c.seen) { c.seen = 1; holoHint(c.x + c.w / 2, G0 - Si(40), 'fall'); }
      if (c.t > 1.2) {
        c.gone = 1; c.cells = [];
        const tx0 = Math.floor(c.x / TS), tx1 = Math.floor((c.x + c.w) / TS);
        for (let tx = tx0; tx < tx1; tx++)
          for (let ty = 12; ty < Math.min(world.th, 15); ty++) {
            const i = ty * world.tw + tx;
            if (!world.off) world.off = new Uint8Array(world.tw * world.th);
            world.off[i] = 1; c.cells.push(i);
          }
        Sfx.explode(); cam.hit(5);
        for (let i = 0; i < 24; i++)
          part(c.x + rnd(0, c.w), G0, rnd(-90, 90), rnd(-60, 40), rnd(0.5, 1.1), '#7b2fbe', 2, 300, 1);
      }
    }
  }

  /* --- 6. ТУМАН: видимість падає на середній дистанції --- */
  if (LFX.fog && !LFX.fogSeen && LFX.t > 2) { LFX.fogSeen = 1; holoHint(P.x, P.y - Si(30), 'fog'); }
}
/** Зони з crush=1 убивають і ворогів — вбивство чужими руками. */
function zoneCrush(z) {
  if (!z.crush) return;
  for (let i = 0; i < ENEM.length; i++) {
    const e = ENEM[i];
    if (e.dead) continue;
    if (!boxHit(z.x, z.y, z.w, z.h, e.x, e.y, e.w, e.h)) continue;
    e.gib = 1;
    damageEnemy(e, 999, sign(z.vx || 0) * S(200), { stun: 0.4 });
  }
}

/* ================================================================
   9. ПУЛИ СУТНОСТЕЙ (масиви з компактуванням — не течуть)
   ================================================================ */
const BULL = [];     // кулі (гравця й ворогів)
const ENEM = [];     // вороги
const PICKS = [];    // аптечки
const BEAMS = [];    // променеві постріли
const TELE = [];     // телеграфи атак (попереджувальні зони)
const BULL_MAX = 90, TELE_MAX = 40;

function shoot(x, y, vx, vy, opt) {
  if (BULL.length >= BULL_MAX) BULL.shift();
  BULL.push({
    x: x, y: y, vx: vx, vy: vy,
    // розмір кулі завжди приходить літералом, тож SCALE тут, а не в
    // кожному з двадцяти викликів; ШВИДКІСТЬ навпаки лишається на
    // совісті виклику — частина з них передає вже масштабовані числа
    w: Si(opt.w || 5), h: Si(opt.h || 4), dmg: opt.dmg || 1,
    own: opt.own || 'e', col: opt.col || '#ff6b3d',
    life: opt.life || 3, kind: opt.kind || 0, grav: S(opt.grav || 0),
    parried: false, hitSet: null
  });
  return BULL[BULL.length - 1];
}
function beam(x, y, dir, len, dmg, col) {
  BEAMS.push({ x: x, y: y, dir: dir, len: len, dmg: dmg, t: 0.16, max: 0.16,
               col: col || '#7df9ff', hitSet: [] });
}
function telegraph(x, y, w, h, t, col, kind) {
  if (TELE.length >= TELE_MAX) TELE.shift();
  TELE.push({ x: x, y: y, w: w, h: h, t: t, max: t, col: col || '#ff2e88', kind: kind || 0 });
}
function clearEntities() {
  BULL.length = 0; ENEM.length = 0; PICKS.length = 0;
  BEAMS.length = 0; TELE.length = 0; PARTS.length = 0; RINGS.length = 0;
}
// Промінь до найближчої стіни (для рейкострила й лазерів босів).
function rayLen(x, y, dir, maxLen) {
  let d = 0;
  while (d < maxLen) {
    d += 4;
    if (solidAtPx(x + dir * d, y)) return d - 4;
  }
  return maxLen;
}

/* ================================================================
   10. ГЕРОЙ «ЕХО»
   ================================================================ */
const P = {
  // 10x14 -> 13x19: хітбокс росте разом зі спрайтом, інакше «картинка
  // більша, а б'є по-старому». Найвужчий прохід у рівнях — 2 тайли (32 px).
  x: 0, y: 0, w: Si(13), h: Si(19), vx: 0, vy: 0, face: 1,
  onGround: false, coyote: 0, jbuf: 0, jumpHeld: false, ride: null,
  jumps: 0, flipT: 0, dropHold: 0, wallRestored: false,
  hp: 5, maxHp: 5, inv: 0, hurtT: 0, dead: false, deadT: 0,
  dashT: 0, dashCd: 0, dashDir: 1,
  dropT: 0,
  atkT: 0, atkIdx: 0, atkAct: false, comboT: 0, hitSet: [], clawSide: 0,
  shootT: 0, shootDur: 0, shootW: '', tpPose: 0,
  parryT: 0, bHold: 0, q: 0, dischT: 0,
  heat: 0, lock: false, lockT: 0, arA: 0.4, arB: 0.55, arUsed: false, arMark: 0,
  cHold: 0, fireCd: 0, chargeReady: false, recoil: 0,
  anim: 'idle', animT: 0, noise: 0, exiting: 0, spawnFx: 0, worn: false,
  // арсенал
  shells: 6, reloadT: 0, cores: 3, coreFrac: 0, chronoCd: 0, chronoHits: 0, scan: null, heatK: 1,
  droneCd: 0, mark: null, blinkT: 0, breath: 0,
  aState: 0, aT: 0, aFrame: 0, idleT: 0, landT: 0, wasGround: true, moveIntent: false
};

function playerReset(full) {
  P.vx = 0; P.vy = 0; P.face = 1; P.onGround = false; P.coyote = 0; P.jbuf = 0;
  P.jumps = 0; P.flipT = 0; P.dropHold = 0; P.wallRestored = false;
  P.ride = null; P.inv = 1.0; P.hurtT = 0; P.dead = false; P.deadT = 0;
  P.dashT = 0; P.dashCd = 0; P.dropT = 0; P.h = Si(19);
  P.atkT = 0; P.atkIdx = 0; P.atkAct = false; P.comboT = 0; P.hitSet.length = 0;
  P.clawSide = 0; P.shootT = 0; P.shootDur = 0; P.shootW = ''; P.tpPose = 0;
  P.parryT = 0; P.bHold = 0; P.dischT = 0;
  P.heat = 0; P.lock = false; P.lockT = 0; P.arUsed = false; P.arMark = 0;
  P.cHold = 0; P.fireCd = 0; P.chargeReady = false; P.recoil = 0;
  P.anim = 'idle'; P.animT = 0; P.noise = 0; P.exiting = 0; P.spawnFx = 0.5;
  P.aState = 0; P.aT = 0; P.aFrame = 0; P.idleT = 0; P.landT = 0;
  P.wasGround = true; P.moveIntent = false;
  setAnim(AST.IDLE);
  P.shells = 6; P.reloadT = 0; P.chronoCd = 0; P.chronoHits = 0; P.droneCd = 0; P.mark = null;
  P.scan = null;
  if (full) { P.cores = 3; P.coreFrac = 0; }
  P.maxHp = maxHearts();
  if (full) { P.hp = P.maxHp; P.q = 0; }
}
function playerSpawnAt(x, y) {
  P.x = x; P.y = y;
  playerReset(false);
  levelFxRespawn();                     // підлога, преси й потяги — у вихідний стан
  burst(P.x + P.w / 2, P.y + P.h / 2, 14, '#22e0ff', 120, 0.4, 40, 2);
}

let GOD = false;                       // використовується лише автотестами
function playerHurt(dmg, srcX, force) {
  if (GOD) return false;
  if (DEV_MODE && CH.invuln) return false;              // чит: безсмертя
  if (P.dead || (P.inv > 0 && !force)) return false;
  if (P.dashT > 0 && P.dashT > PH.DASHT - PH.DASHI) return false;   // і-фрейми ривка
  P.hp -= dmg;
  // У тренуванні парирування пропущена куля — це невдала спроба.
  // П'ять таких, і прохід відкривається сам.
  Tut.note('parryMiss');
  P.inv = 1.0 * DIFF.iframe; P.hurtT = 0.3;
  P.vx = (srcX !== undefined ? sign(P.x + P.w / 2 - srcX) || 1 : -P.face) * S(120);
  P.vy = -S(150) * world.grav;
  P.onGround = false;
  P.atkT = 0; P.atkAct = false;
  cam.hit(4);
  Sfx.hurt(); buzz(28);
  burst(P.x + P.w / 2, P.y + P.h / 2, 10, '#ff2e88', 140, 0.4, 200, 2);
  if (P.hp <= 0) { P.hp = 0; playerDie(); }
  return true;
}
function playerHeal(n) {
  if (P.hp >= P.maxHp) return false;
  P.hp = Math.min(P.maxHp, P.hp + n);
  Sfx.pickup();
  burst(P.x + P.w / 2, P.y + 4, 10, '#3dff9a', 90, 0.5, -30, 2);
  return true;
}
function playerDie() {
  if (P.dead) return;
  P.dead = true; P.deadT = 1.1; P.vy = -S(220) * world.grav; P.vx = -P.face * S(60);
  Sfx.die(); buzz([40, 60, 90]); cam.hit(6);
  burst(P.x + P.w / 2, P.y + P.h / 2, 26, '#ff2e88', 190, 0.8, 220, 2);
}

/* ---------------- зброя 1: «Арк-тесак» ---------------- */
/**
 * Коробка ближнього удару. Усі числа перераховані під новий розмір
 * героїні (x1.35): дуга не має «відставати» від того, що видно.
 */
function bladeBox() {
  const w = EQ.m, idx = P.atkIdx;
  const cx = P.x + P.w / 2, cy = P.y + P.h / 2;
  if (w.id === 'arc') {
    const W3 = Si(35), H3 = Si(27), W1 = Si(26), H1 = Si(19);
    if (idx === 2) return { x: P.face > 0 ? cx : cx - W3, y: cy - H3 / 2, w: W3, h: H3 };
    return { x: P.face > 0 ? cx : cx - W1, y: cy - H1 / 2, w: W1, h: H1 };
  }
  const r = w.id === 'chrono' ? Si(27) : w.reach;  // радіус телепорту хронорізу
  const h = w.id === 'whip' ? Si(35) : (w.id === 'brand' ? Si(27) : Si(16));
  return { x: P.face > 0 ? cx : cx - r, y: cy - h / 2, w: r, h: h };
}
function bladeStart() {
  const idx = (P.comboT > 0 && P.atkIdx < 2) ? P.atkIdx + 1 : 0;
  P.atkIdx = idx;
  P.atkT = BL.DUR[idx];
  P.atkAct = true;
  P.hitSet.length = 0;
  P.comboT = 0;
  Sfx.slash(idx);
  const b = bladeBox();
  for (let i = 0; i < (idx === 2 ? 9 : 5); i++)
    part(b.x + rnd(0, b.w), b.y + rnd(0, b.h), P.face * rnd(20, 90), rnd(-40, 40),
         rnd(0.10, 0.22), idx === 2 ? '#ffd23f' : '#7df9ff', 1, 0, 1);
}
function bladeHits() {
  if (!P.atkAct) return;
  const total = BL.DUR[P.atkIdx];
  const k = 1 - P.atkT / total;
  if (k < 0.20 || k > 0.85) return;              // активна фаза удару
  const b = bladeBox();
  const dmg = BL.DMG[P.atkIdx], kb = S(P.atkIdx === 2 ? 190 : 70);
  for (let i = 0; i < ENEM.length; i++) {
    const e = ENEM[i];
    if (e.dead || P.hitSet.indexOf(e.id) >= 0) continue;
    if (!boxHit(b.x, b.y, b.w, b.h, e.x, e.y, e.w, e.h)) continue;
    P.hitSet.push(e.id);
    damageEnemy(e, dmg, P.face * kb, { melee: true, combo: P.atkIdx });
  }
  if (BOSS.on) {
    const parts = bossHitBoxes();
    for (let i = 0; i < parts.length; i++) {
      const hb = parts[i];
      const key = 'B' + (hb.id === undefined ? 0 : hb.id);
      if (P.hitSet.indexOf(key) >= 0) continue;
      if (!boxHit(b.x, b.y, b.w, b.h, hb.x, hb.y, hb.w, hb.h)) continue;
      P.hitSet.push(key);
      bossDamage(hb, dmg, { melee: true, combo: P.atkIdx, kb: P.face * kb });
    }
  }
  // рикошет від стін теж дає іскри
  if (P.atkIdx === 2 && P.hitSet.length === 0 && Math.random() < 0.25)
    part(b.x + b.w / 2, b.y + b.h / 2, 0, 0, 0.1, '#ffd23f', 2, 0, 1);
}
function bladeCharge(n) {
  P.q = Math.min(BL.MAXQ, P.q + n);
}
function discharge() {
  P.q = 0; P.dischT = 0.35;
  Sfx.discharge(); buzz(60); cam.hit(6);
  const cx = P.x + P.w / 2, cy = P.y + P.h / 2;
  ring(cx, cy, 6, BL.RAD, 0.42, '#22e0ff', 3);
  ring(cx, cy, 2, BL.RAD * 0.7, 0.30, '#ffffff', 2);
  burst(cx, cy, 26, '#7df9ff', 220, 0.5, 30, 2);
  for (let i = 0; i < ENEM.length; i++) {
    const e = ENEM[i];
    if (e.dead) continue;
    if (dist2(cx, cy, e.x + e.w / 2, e.y + e.h / 2) <= BL.RAD * BL.RAD)
      damageEnemy(e, BL.DDMG, sign(e.x + e.w / 2 - cx) * S(150), { stun: BL.STUN, shock: true });
  }
  if (BOSS.on) {
    const parts = bossHitBoxes();
    for (let i = 0; i < parts.length; i++) {
      const hb = parts[i];
      if (dist2(cx, cy, hb.x + hb.w / 2, hb.y + hb.h / 2) <= (BL.RAD + Si(10)) * (BL.RAD + Si(10)))
        bossDamage(hb, BL.DDMG, { shock: true });
    }
  }
  // розряд збиває ворожі кулі
  for (let i = BULL.length - 1; i >= 0; i--) {
    const b = BULL[i];
    if (b.own === 'e' && dist2(cx, cy, b.x, b.y) <= BL.RAD * BL.RAD) {
      burst(b.x, b.y, 3, '#ffd23f', 70, 0.2, 0, 1);
      BULL[i] = BULL[BULL.length - 1]; BULL.pop();
    }
  }
}
/* Парирування: куля летить назад посиленою.
   На максимальному режимі вікно вужче (0,10 с проти 0,15), але відбита
   куля б'є ВТРИЧІ сильніше за штатну — ризик і нагорода ростуть разом,
   і парирування лишається вигідним, а не просто важчим. */
function tryParry(b) {
  if (P.parryT <= 0 || b.own !== 'e' || b.parried) return false;
  const px = P.x - Si(8), py = P.y - Si(6), pw = P.w + Si(16), ph = P.h + Si(12);
  if (!boxHit(px, py, pw, ph, b.x - b.w / 2, b.y - b.h / 2, b.w, b.h)) return false;
  b.own = 'p'; b.parried = true;
  b.dmg *= DIFF.parryK; b.col = '#ffd23f';
  parryCount++;
  Tut.note('parryOk');
  const sp = Math.hypot(b.vx, b.vy) * 1.7 + S(60);
  const ang = Math.atan2(b.vy, b.vx) + Math.PI;
  b.vx = Math.cos(ang) * sp; b.vy = Math.sin(ang) * sp * 0.35;
  b.life = 3;
  bladeCharge(1);
  Sfx.parry(); buzz(18); cam.hit(2.5);
  ring(b.x, b.y, 2, 16, 0.25, '#ffd23f', 2);
  burst(b.x, b.y, 8, '#ffd23f', 140, 0.3, 0, 1);
  hitStop(0.07);
  return true;
}

/* ---------------- зброя 2: «Рейкострил» ---------------- */
function railShoot() {
  const y = P.y + Si(6);
  const mx = P.x + P.w / 2 + P.face * Si(8);
  // Постріл рейкострила — не куля, а промінь: летючий снаряд лишається
  // для шкоди, але на екрані живе 0,08 с біла нитка з блакитним ореолом.
  const len = rayLen(mx, y, P.face, S(300));
  shoot(mx, y, P.face * RG.V, 0,
        { own: 'p', dmg: RG.DMG, w: 7, h: 3, col: '#7df9ff', life: 1.4, kind: 1 });
  wfx({ k: 'ray', x: mx, y: y, face: P.face, len: len, t: 0.08, wide: 0 });
  wfx({ k: 'rings', x: mx, y: y, face: P.face, t: 0.22, chg: 0 });
  railCase(mx, y);
  P.heat = Math.min(120, P.heat + RG.SHOT * (P.heatK || 1));
  if (DEV_MODE && CH.res) P.heat = 0;                   // чит: тепло не росте
  P.fireCd = RG.CD; P.recoil = 0.12; shootAnim(RG.CD);
  P.noise = 0.7;
  P.vx -= P.face * (P.onGround ? RG.RECOIL * 0.35 : RG.RECOIL);
  Sfx.wRail();
  // ударна хвиля повітря по боках ствола
  for (const d of [-1, 1])
    for (let i = 0; i < 3; i++)
      part(mx + P.face * (6 + i * 4), y + d * (2 + i), P.face * rnd(20, 60), d * rnd(30, 70),
           rnd(0.08, 0.16), '#bff4ff', 1, 0, 1);
  burst(mx + P.face * 2, y, 4, '#bff4ff', 90, 0.16, 0, 1);
  if (P.heat >= 100) overheat();
}
/** Гільза-розряд: вилітає назад-угору, падає й дзвенить. */
function railCase(mx, y) {
  part(mx - P.face * 6, y - 2, -P.face * rnd(50, 90), rnd(-120, -70), 0.55, '#ffd23f', 1, 420, 1);
  Sfx.shell();
}
function railBeam() {
  const y = P.y + Si(6);
  const sx = P.x + P.w / 2 + P.face * Si(6);
  const len = rayLen(sx, y, P.face, S(300));
  beam(sx, y, P.face, len, RG.BDMG, '#ffd23f');
  // заряджений постріл прошиває наскрізь: розрив простору по всій лінії
  wfx({ k: 'ray', x: sx, y: y, face: P.face, len: len, t: 0.14, wide: 1 });
  wfx({ k: 'rings', x: sx, y: y, face: P.face, t: 0.30, chg: 1 });
  wfx({ k: 'rift', x: sx, y: y, face: P.face, len: len, t: 0.32 });
  railCase(sx, y);
  P.heat = Math.min(130, P.heat + RG.BEAM * (P.heatK || 1));
  if (DEV_MODE && CH.res) P.heat = 0;
  P.fireCd = 0.25; P.recoil = 0.22; P.noise = 1.0; shootAnim(0.25);
  P.vx -= P.face * S(P.onGround ? 60 : 130);
  Sfx.wRail(); Sfx.beam(); buzz(22); cam.hit(3.5);
  for (let i = 0; i < 14; i++)
    part(sx + P.face * rnd(0, len), y + rnd(-3, 3), rnd(-30, 30), rnd(-60, 60),
         rnd(0.15, 0.4), '#ffd23f', 1, 10, 1);
  if (P.heat >= 100) overheat();
}
function overheat() {
  P.lock = true; P.lockT = RG.LOCK; P.arUsed = false; P.arMark = 0;
  P.arA = rnd(0.30, 0.66); P.arB = P.arA + 0.14;
  P.chargeReady = false; P.cHold = 0;
  Sfx.overheat(); buzz(14);
  for (let i = 0; i < 10; i++)
    part(P.x + P.w / 2 + P.face * 8, P.y + 6, P.face * rnd(10, 50), rnd(-50, -10),
         rnd(0.3, 0.7), '#ff6b3d', 1, -20, 1);
}
function activeReload() {
  if (P.arUsed) { Sfx.blocked(); return; }
  P.arUsed = true;
  if (P.arMark >= P.arA && P.arMark <= P.arB) {
    P.lock = false; P.lockT = 0; P.heat = 0; P.cHold = 0;
    Tut.note('cooled');
    Sfx.reload(); buzz(12);
    burst(P.x + P.w / 2, P.y + 6, 10, '#3dff9a', 120, 0.35, 0, 1);
  } else {
    Sfx.blocked();
  }
}


/* ================================================================
   10b. АРСЕНАЛ: дві активні комірки, десять зброй
   ================================================================ */
export const EQ = { m: WEAPONS.arc, r: WEAPONS.rail };
export function refreshEquip() {
  EQ.m = WEAPONS[Store.data.melee] || WEAPONS.arc;
  EQ.r = WEAPONS[Store.data.ranged] || WEAPONS.rail;
  syncDrones();
}
/** «Рій»: три дрони існують, поки зброя в руках, і кружляють поруч. */
const DRONE_COL = [0x22e0ff, 0x3dff9a, 0xff2e88];
function syncDrones() {
  if (EQ.r.id !== 'swarm') { DRONES.length = 0; P.mark = null; return; }
  while (DRONES.length < 3)
    DRONES.push({ i: DRONES.length, x: P.x, y: P.y, vx: 0, vy: 0,
                  st: 'orbit', t: 0, cd: 0, hitT: 0, tgt: null,
                  col: DRONE_COL[DRONES.length], tr: [] });
  DRONES.length = 3;
}
export function giveWeapon(id) {
  if (!id || !WEAPONS[id]) return false;
  if (Store.data.owned.indexOf(id) >= 0) return false;
  Store.data.owned.push(id);
  Store.save();
  Game.pickupName = WEAPONS[id].name;
  Game.pickupT = 3.2;
  Music.sting('weapon'); Music.duck(1.8);
  Sfx.win(); buzz(30);
  ring(P.x + P.w / 2, P.y + 7, 4, 40, 0.7, '#ffd23f', 2);
  burst(P.x + P.w / 2, P.y + 7, 20, '#ffd23f', 150, 0.7, 40, 2);
  return true;
}
/**
 * Нагорода за пройдений рівень. Викликається один раз при завершенні;
 * повертає опис для сцени на екрані «сектор зачищено» або null.
 */
export function levelReward(idx) {
  const r = LEVEL_REWARD[idx];
  if (!r) return null;
  if (r.kind === 'weapon') {
    const w = WEAPONS[r.id];
    if (Store.data.owned.indexOf(r.id) >= 0) return null;   // повторне проходження
    Store.data.owned.push(r.id); Store.save();
    return { kind: 'weapon', id: r.id, name: w.name, sprite: w.sprite,
             desc: w.desc, hint: w.hint || '', bars: w.bars, slot: w.kind };
  }
  if (r.kind === 'heart') {
    if (Store.data.bonusHp >= 1) return null;
    Store.data.bonusHp = 1; Store.save();
    P.maxHp = maxHearts(); P.hp = P.maxHp;
    return { kind: 'heart', name: r.name, sprite: r.sprite, desc: r.desc, hint: r.hint };
  }
  if (r.kind === 'key') {
    if (Store.data.ngKey) return null;
    Store.data.ngKey = 1; Store.save();
    return { kind: 'key', name: r.name, sprite: r.sprite, desc: r.desc, hint: r.hint };
  }
  return null;
}
export function maxHearts() {
  return (Store.data.easy ? 7 : 5) + (Store.data.bonusHp || 0) + (Game.assist ? 2 : 0);
}
/** Скільки фрагментів Ехо-Призми зібрано. */
export function fragCount() { return Store.data.frags.length; }
/** Зібрані всі три — призма збирається на найближчому чекпоінті. */
function tryAssemblePrism() {
  if (Store.data.frags.length < FRAG_LEVELS.length) return false;
  if (Store.data.owned.indexOf('prism') >= 0) return false;
  Store.data.owned.push('prism'); Store.save();
  Music.sting('secret'); Music.duck(2.0);
  Game.assembleT = 3.6;
  Game.pickupName = WEAPONS.prism.name;
  Game.pickupT = 3.6;
  Sfx.win(); buzz([30, 60, 30]);
  ring(P.x + P.w / 2, P.y + 7, 5, 120, 1.1, '#8fdcff', 3);
  burst(P.x + P.w / 2, P.y + 7, 30, '#8fdcff', 200, 1.0, 20, 2);
  return true;
}
/** Міняти зброю можна на чекпоінті, у паузі, перед боєм із босом. */
export function canSwapNow() {
  if (Store.data.freeSwap) return true;
  if (Game.state === 'pause' || Game.state === 'menu') return true;
  if (Game.state !== 'play') return false;
  for (let i = 0; i < world.cps.length; i++) {
    const c = world.cps[i];
    if (c.taken && Math.abs(P.x - c.x) < Si(40) && Math.abs(P.y - c.y) < Si(40)) return true;
  }
  if (world.bossX > 0 && !BOSS.on && !BOSS.done &&
      P.x > world.bossX - Si(90) && P.x < world.bossX + Si(8)) return true;
  return false;
}

let slowT = 0;                                    // сповільнення часу (Хроноріз)
let desatT = 0;                                   // знебарвлення кадру на телепорті
export const DRONES = [];                         // дрони «Рою»

/* ------------------------------------------------------- БЛИЖНІЙ БІЙ */
function meleeUpdate(dt, IN) {
  whipStep(dt);
  if (WHIP.tipHit && (WHIP.tipHit.t -= dt) <= 0) WHIP.tipHit = null;
  if (P.chronoCd > 0) P.chronoCd -= dt;
  if (IN.bP && P.dashT <= 0) {
    if (EQ.m.id === 'arc') P.parryT = DIFF.parry;  // паріює лише тесак; вікно від режиму
    if (P.atkT <= 0 && P.dischT <= 0) meleeStart();
  }
  if (IN.b) P.bHold += dt; else P.bHold = 0;
  if (EQ.m.id === 'arc' && P.q >= BL.MAXQ && P.bHold >= BL.HOLD && P.dischT <= 0) {
    discharge(); P.bHold = -1;
  }
  if (EQ.m.id === 'brand' && P.bHold >= 0.5 && P.dischT <= 0 && P.onGround) {
    brandSlam(); P.bHold = -1;
  }
  if (P.atkT > 0) {
    meleeHits();
    P.atkT -= dt;
    if (P.atkT <= 0) {
      P.atkAct = false;
      P.comboT = EQ.m.id === 'claws' ? 0.30 : BL.WIN;
    }
  }
}
/** Колір частинок у кожної зброї свій — почерк видно навіть у пилюці. */
const WCOL = { arc: '#7df9ff', whip: '#bff4ff', brand: '#b07bff', chrono: '#8f6fff',
               claws: '#00ffcc', rail: '#bff4ff', osa: '#ffd23f', swarm: '#3dff9a',
               shot: '#ffb03f', glitch: '#00ffcc', prism: '#8fdcff' };
function meleeStart() {
  const w = EQ.m;
  P.hitSet.length = 0;
  const combo = P.comboT > 0;                     // вікно продовження комбо
  P.comboT = 0;
  switch (w.id) {
    case 'arc': {
      P.atkIdx = (combo && P.atkIdx < 2) ? P.atkIdx + 1 : 0;
      P.atkT = BL.DUR[P.atkIdx];
      Sfx.slash(P.atkIdx);
      break;
    }
    case 'whip':
      P.atkIdx = 0;
      P.atkT = BL.WHIP_WIND + BL.WHIP_LASH + BL.WHIP_BACK;
      whipStart();
      Sfx.dash();                                   // свист розсікання
      break;
    case 'brand':
      P.atkIdx = 0; P.atkT = w.swing[0]; Sfx.wBrand(); cam.hit(1.5);
      // рукавиця розкладається на пластини й спалахує фіолетовим
      wfx({ k: 'plates', x: P.x + P.w / 2, y: P.y + Si(7), face: P.face, t: w.swing[0] });
      break;
    case 'claws':
      P.atkIdx = 0; P.atkT = w.swing[0]; P.clawSide ^= 1; Sfx.wClaws();
      wfx({ k: 'cut', x: P.x + P.w / 2, y: P.y + Si(7), face: P.face, t: 0.15 });
      break;
    case 'chrono':
      if (chronoStrike()) return;
      P.atkIdx = 0; P.atkT = w.swing[0]; Sfx.wChrono();
      break;
  }
  P.atkAct = true;
  const b = bladeBox();
  for (let i = 0; i < 5; i++)
    part(b.x + rnd(0, b.w), b.y + rnd(0, b.h), P.face * rnd(20, 90), rnd(-40, 40),
         rnd(0.10, 0.22), WCOL[w.id] || '#7df9ff', 1, 0, 1);
}
/* ------------------------------------------------------- ЕЛЕКТРОХЛИСТ
   Мотузка з 12 ланок на верле-інтеграції: кожна ланка тягнеться за
   попередньою з інерцією й затуханням, тому хлист провисає й
   розпрямляється по черзі, а не малюється прямою лінією.
   Хітбокс — сама крива: перевіряємо кожен сегмент, а не прямокутник. */
const WHIP = { on: false, t: 0, phase: '', pts: [], prev: [], flash: 0, tipHit: null };
const WHIP_N = 12;                                  // ланок
const WHIP_SEG = S(6.0);                            // довжина ланки, px (12 x 6 = 66 -> 99)
for (let i = 0; i < WHIP_N; i++) { WHIP.pts.push({ x: 0, y: 0 }); WHIP.prev.push({ x: 0, y: 0 }); }

function whipStart() {
  WHIP.on = true; WHIP.t = 0; WHIP.phase = 'wind'; WHIP.flash = 0;
  const ax = P.x + P.w / 2, ay = P.y + Si(6);
  for (let i = 0; i < WHIP_N; i++) {
    WHIP.pts[i].x = ax - P.face * i * 1.5; WHIP.pts[i].y = ay + i * 0.6;
    WHIP.prev[i].x = WHIP.pts[i].x; WHIP.prev[i].y = WHIP.pts[i].y;
  }
}
/**
 * Кут і виліт кінчика по стадіях. Замах іде назад через плече, викид —
 * дугою вперед, повернення — з провисанням. Ланки розпрямляються ПО
 * ЧЕРЗІ: хвиля біжить від рукояті до кінчика, тому форма дуги читається
 * на всіх трьох стадіях.
 */
const WHIP_ARC = {                                  // кут біля рукояті + «завиток»
  wind: { a0: -0.2, a1: 2.4, c0: 0.4, c1: 1.0 },   // збирається за спиною
  lash: { a0: 2.4, a1: -0.2, c0: 1.0, c1: 0.05 },  // розпрямляється дугою вперед
  back: { a0: -0.2, a1: 0.5, c0: 0.05, c1: 0.9 }   // повертається з провисанням
};
function whipStep(dt) {
  if (!WHIP.on) return;
  WHIP.t += dt;
  const D = { wind: BL.WHIP_WIND, lash: BL.WHIP_LASH, back: BL.WHIP_BACK }[WHIP.phase];
  if (WHIP.t >= D) {
    WHIP.t = 0;
    if (WHIP.phase === 'wind') { WHIP.phase = 'lash'; WHIP.flash = 0.08; Sfx.slash(2); }
    else if (WHIP.phase === 'lash') WHIP.phase = 'back';
    else { WHIP.on = false; return; }
  }
  const k = clamp(WHIP.t / D, 0, 1);
  const e = k * k * (3 - 2 * k);                    // плавний старт і кінець
  const A = WHIP_ARC[WHIP.phase];
  const ang = lerp(A.a0, A.a1, e);
  const curl = lerp(A.c0, A.c1, e);
  const ax = P.x + P.w / 2, ay = P.y + Si(6);
  // Ідеальна форма будується ЛАНКА ЗА ЛАНКОЮ від рукояті: кожна
  // наступна відхиляється на невеликий сталий кут, тому мотузка завжди
  // рівно WHIP_SEG між точками й ніколи не заплутується. Хвиля wave
  // розпрямляє ланки по черзі — від рукояті до кінчика.
  let x = ax, y = ay;
  for (let i = 0; i < WHIP_N; i++) {
    const u = i / (WHIP_N - 1);
    const wave = clamp(e * 2.0 - u * 0.4, 0, 1);   // хвиля розпрямлення від рукояті
    const aa = ang + curl * u + (1 - wave) * 0.5;
    const p = WHIP.pts[i];
    const f = 0.34 + 0.4 * (1 - u);                 // рукоять швидка, кінчик відстає
    p.x += (x - p.x) * f; p.y += (y - p.y) * f;
    x += P.face * Math.cos(aa) * WHIP_SEG;
    // вертикаль приглушена: дуга йде більше вбік, ніж над головою —
    // інакше хлист красиво свистить понад ворогами й нікого не зачіпає
    y -= Math.sin(aa) * WHIP_SEG * 0.55;
  }
  WHIP.pts[0].x = ax; WHIP.pts[0].y = ay;
  // жорстке обмеження довжини — після згладжування ланки не розтягуються
  for (let i = 1; i < WHIP_N; i++) {
    const a = WHIP.pts[i - 1], b = WHIP.pts[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const L = Math.hypot(dx, dy) || 1;
    const d = (L - WHIP_SEG) / L;
    b.x -= dx * d; b.y -= dy * d;
  }
  if (WHIP.flash > 0) WHIP.flash -= dt;
  if (WHIP.phase === 'lash') whipHits();
}
/** Хітбокс = крива: перевіряємо всі сегменти мотузки. */
function whipHits() {
  // Йдемо по кривій дрібним кроком: між вузлами 6 px, а ворог буває
  // вужчим — по самих вузлах хлист би просвистів повз.
  for (let i = 2; i < WHIP_N; i++) {
    const a = WHIP.pts[i - 1], b = WHIP.pts[i];
    for (let m = 0; m < 3; m++) whipProbe(a.x + (b.x - a.x) * m / 3, a.y + (b.y - a.y) * m / 3, b.x - a.x);
  }
}
function whipProbe(cx, cy, dir) {
  {
    for (let j = 0; j < ENEM.length; j++) {
      const e = ENEM[j];
      if (e.dead || e.charm > 0 || P.hitSet.indexOf(e.id) >= 0) continue;
      if (!boxHit(cx - Si(5), cy - Si(6), Si(10), Si(12), e.x, e.y, e.w, e.h)) continue;
      P.hitSet.push(e.id);
      damageEnemy(e, EQ.m.dmg[0], sign(dir) * S(40), { melee: true, stun: 0.5 });
      WHIP.tipHit = { x: cx, y: cy, t: 0.2 };
      Sfx.parry();                                  // електричний тріск при контакті
      chainSpark(e);
    }
    if (BOSS.on) {
      const hbs = bossHitBoxes();
      for (let j = 0; j < hbs.length; j++) {
        const hb = hbs[j], key = 'B' + (hb.id === undefined ? 0 : hb.id);
        if (P.hitSet.indexOf(key) >= 0) continue;
        if (!boxHit(cx - Si(5), cy - Si(6), Si(10), Si(12), hb.x, hb.y, hb.w, hb.h)) continue;
        P.hitSet.push(key);
        bossDamage(hb, EQ.m.dmg[0], { melee: true, kb: sign(dir) * S(40) });
        WHIP.tipHit = { x: cx, y: cy, t: 0.2 };
        Sfx.parry();
      }
    }
  }
}

/** Хроноріз: телепорт крізь ворога й удар у спину. */
function chronoStrike() {
  if (P.chronoCd > 0) return false;
  let best = null, bd = 1e9;
  const cx = P.x + P.w / 2;
  for (let i = 0; i < ENEM.length; i++) {
    const e = ENEM[i];
    if (e.dead || e.charm > 0) continue;
    const dx = (e.x + e.w / 2) - cx;
    if (dx * P.face <= 0) continue;
    const d = Math.abs(dx);
    if (d < EQ.m.reach && Math.abs((e.y + e.h / 2) - (P.y + P.h / 2)) < Si(26) && d < bd) { bd = d; best = e; }
  }
  if (!best) return false;
  const tx = clamp(best.x + (P.face > 0 ? best.w + 6 : -P.w - 6), 2, world.pw - P.w - 2);
  if (!rectSolid(tx, P.y, P.w, P.h)) {
    burst(P.x + P.w / 2, P.y + 7, 10, '#8f6fff', 130, 0.3, 0, 1);
    // три сині фантомні копії вздовж траєкторії телепорту
    for (let i = 1; i <= 3; i++)
      wfx({ k: 'phant', x: P.x + (tx - P.x) * (i / 4), y: P.y, face: P.face, t: 0.28 + i * 0.04 });
    P.x = tx;
    burst(P.x + P.w / 2, P.y + 7, 10, '#8f6fff', 130, 0.3, 0, 1);
  }
  P.tpPose = 0.22;                                 // з'являється вже в іншій позі — спиною до камери
  damageEnemy(best, EQ.m.dmg[0] * 2, -P.face * S(90), { melee: true, pierce: true, back: true });
  // удар зі спини — вертикальний розріз-спалах на ворозі
  wfx({ k: 'rip', x: best.x + best.w / 2, y: best.y + best.h / 2, h: best.h + 8, t: 0.18 });
  desatT = 0.10;                                    // світ на мить знебарвлюється
  P.chronoCd = 1.2;
  P.chronoHits++;
  Sfx.wChrono(); hitStop(0.06); cam.hit(2);
  if (P.chronoHits % 5 === 0) { slowT = 2.0; ring(P.x + 5, P.y + 7, 6, 90, 0.8, '#8f6fff', 3); }
  return true;
}
/** Тавро: заряджений удар в землю — ударна хвиля. */
function brandSlam() {
  P.dischT = 0.4;
  Sfx.wBrand(); buzz(40); cam.hit(6);
  // тріщини, що біжать підлогою в обидва боки — видно, куди йде хвиля
  for (const d of [-1, 1])
    for (let i = 1; i <= 5; i++)
      wfx({ k: 'crack', x: P.x + P.w / 2 + d * i * Si(11), y: P.y + P.h - 1,
            len: S(rnd(5, 11)), dir: d, t: 0.9, delay: i * 0.05 });
  ring(P.x + P.w / 2, P.y + P.h, 6, 54, 0.45, '#ffd23f', 3);
  for (const d of [-1, 1]) {
    shoot(P.x + P.w / 2, P.y + P.h - Si(6), d * S(165), 0,
          { own: 'p', dmg: 12.5, col: '#ffd23f', w: 12, h: 14, life: 1.6, kind: 3 });
    // хвиля пилу біжить по підлозі попереду хвилі — видно, куди вона йде
    for (let i = 0; i < 12; i++)
      part(P.x + P.w / 2 + d * i * 5, P.y + P.h - rnd(0, 3), d * rnd(30, 90), rnd(-40, -5),
           rnd(0.3, 0.7), '#c9b08a', 2, 180, 1);
  }
  for (let i = 0; i < 16; i++)
    part(P.x + rnd(-6, 16), P.y + P.h, rnd(-140, 140), rnd(-120, -20), rnd(0.3, 0.6), '#ffd23f', 2, 260, 1);
}
function meleeHits() {
  if (!P.atkAct) return;
  const w = EQ.m;
  const total = w.id === 'arc' ? BL.DUR[P.atkIdx] : w.swing[0];
  const k = 1 - P.atkT / total;
  if (k < 0.20 || k > 0.85) return;
  const b = bladeBox();
  let dmg, kb, opt;
  switch (w.id) {
    case 'arc': dmg = BL.DMG[P.atkIdx]; kb = S(P.atkIdx === 2 ? 190 : 70); opt = { melee: true, combo: P.atkIdx }; break;
    case 'whip': return;                            // хлист має власний хітбокс-криву
    case 'brand': dmg = w.dmg[0]; kb = S(260); opt = { melee: true, stun: 0.35, heavy: true }; break;
    case 'claws': dmg = w.dmg[0]; kb = S(18); opt = { melee: true, claw: true }; break;
    case 'chrono': dmg = w.dmg[0] * 0.4; kb = S(40); opt = { melee: true }; break;   // затичка між телепортами
    default: dmg = w.dmg[0]; kb = S(70); opt = { melee: true }; break;
  }
  // тріснуті блоки ламає лише Тавро
  if (w.id === 'brand') breakCracked(b);
  for (let i = 0; i < ENEM.length; i++) {
    const e = ENEM[i];
    if (e.dead || e.charm > 0 || P.hitSet.indexOf(e.id) >= 0) continue;
    if (!boxHit(b.x, b.y, b.w, b.h, e.x, e.y, e.w, e.h)) continue;
    P.hitSet.push(e.id);
    damageEnemy(e, dmg, P.face * kb, opt);
    if (w.id === 'whip') chainSpark(e);
    if (w.id === 'brand') brandThrow(e);
    if (w.id === 'claws') clawStack(e);
  }
  if (BOSS.on) {
    const parts = bossHitBoxes();
    for (let i = 0; i < parts.length; i++) {
      const hb = parts[i];
      const key = 'B' + (hb.id === undefined ? 0 : hb.id);
      if (P.hitSet.indexOf(key) >= 0) continue;
      if (!boxHit(b.x, b.y, b.w, b.h, hb.x, hb.y, hb.w, hb.h)) continue;
      P.hitSet.push(key);
      bossDamage(hb, dmg, { melee: true, combo: P.atkIdx, kb: P.face * kb, pierce: w.id === 'chrono' });
    }
  }
}
function breakCracked(b) {
  const x0 = Math.floor(b.x / TS), x1 = Math.floor((b.x + b.w) / TS);
  const y0 = Math.floor(b.y / TS), y1 = Math.floor((b.y + b.h) / TS);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (tAt(tx, ty) !== T_CRACK) continue;
    world.tiles[ty * world.tw + tx] = T_EMPTY;
    Sfx.explode(); cam.hit(2);
    for (let i = 0; i < 10; i++)
      part(tx * TS + rnd(0, TS), ty * TS + rnd(0, TS), rnd(-90, 90), rnd(-90, 20), rnd(0.3, 0.6), '#9a7fb5', 2, 240, 1);
  }
}
/** Електрохлист: розряд перестрибує на сусіда. */
function chainSpark(from) {
  const cx = from.x + from.w / 2, cy = from.y + from.h / 2;
  for (let i = 0; i < ENEM.length; i++) {
    const o = ENEM[i];
    if (o === from || o.dead || o.charm > 0 || P.hitSet.indexOf(o.id) >= 0) continue;
    if (dist2(cx, cy, o.x + o.w / 2, o.y + o.h / 2) > Si(24) * Si(24)) continue;
    P.hitSet.push(o.id);
    damageEnemy(o, 3, 0, { melee: true, stun: 0.25 });
    // видима блискавка між ураженим і наступним — механіка ланцюга
    // має пояснювати себе сама, без підказок у меню
    BEAMS.push({ x: cx, y: cy, dir: 1, len: 0, dmg: 0, t: 0.22, max: 0.22,
                 col: '#7df9ff', hitSet: [], arc: { x: o.x + o.w / 2, y: o.y + o.h / 2 } });
    for (let k = 0; k < 8; k++) {
      const t = k / 8;
      part(lerp(cx, o.x + o.w / 2, t), lerp(cy, o.y + o.h / 2, t), rnd(-30, 30), rnd(-30, 30), 0.2, '#7df9ff', 1, 0, 1);
    }
    break;
  }
}
/** Тавро кидає легких ворогів. */
function brandThrow(e) {
  if (['skreb', 'wasp', 'kami', 'blinker', 'spider'].indexOf(e.t) < 0) return;
  e.thrown = 1.1;
  e.vx = P.face * S(300); e.vy = -S(170);
  e.stun = Math.max(e.stun, 1.1);
  // захоплення видно: пульсуюче гравітаційне коло навколо ворога
  wfx({ k: 'grav', x: e.x + e.w / 2, y: e.y + e.h / 2, t: 0.5 });
}
/** Кігті: стаки перегріву, п'ятий — вибух. */
function clawStack(e) {
  e.hs = (e.hs || 0) + 1;
  if (e.hs < 5) {
    for (let i = 0; i < e.hs; i++)
      part(e.x + rnd(0, e.w), e.y - 2, rnd(-20, 20), -30, 0.3, '#ff6b3d', 1, -10, 1);
    return;
  }
  e.hs = 0;
  const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
  Sfx.explode(); cam.hit(4);
  wfx({ k: 'boom', x: cx, y: cy, r: Si(34), t: 0.35 });
  ring(cx, cy, 4, 30, 0.35, '#ff6b3d', 3);
  burst(cx, cy, 16, '#ffd23f', 180, 0.5, 150, 2);
  for (let i = 0; i < ENEM.length; i++) {
    const o = ENEM[i];
    if (o === e || o.dead) continue;
    if (dist2(cx, cy, o.x + o.w / 2, o.y + o.h / 2) < Si(30) * Si(30)) damageEnemy(o, 12.5, sign(o.x - cx) * S(90), {});
  }
  damageEnemy(e, 12.5, 0, {});
}

/* ================================================================
   10a. МАШИНА СТАНІВ АНІМАЦІЇ
   Єдина точка переходу — setAnim(). Ніде більше P.anim не присвоюється:
   кадр обирає resolveAnim() за пріоритетом станів, а лічильник кадру
   живе ВСЕРЕДИНІ стану й обнуляється на кожному переході.
   ================================================================ */
/** Пози, для яких є побита версія (решта миготіла б надто рідко). */
const HERO_DMG = ['idle', 'jump', 'fall', 'hurt',
                  'run1', 'run2', 'run3', 'run4', 'run5', 'run6', 'run7', 'run8'];
const AST = {                                     // значення = пріоритет
  IDLE: 10, RUN: 20, LAND: 30, FALL: 45, JUMP: 50,
  DASH: 60, SHOOT: 65, ATTACK: 70, HURT: 80, DEAD: 90
};
const ANIM = {
  VXDEAD: 5,        // нижче цього без вводу швидкість вважається нулем
  VXRUN: 10,        // біг лише якщо Є НАМІР і швидкість вища за це
  IDLEFPS: 6,       // спокій — не швидше шести кадрів на секунду
  LAND: 0.12,       // присідання після приземлення
  LONGIDLE: 5.0,    // через стільки секунд простою — довга анімація
  LONGDUR: 1.6      // її тривалість
};
/**
 * Кадр атаки ближньої зброї. k — частка ПРОЙДЕНОГО удару (0..1), тому
 * анімація прив'язана до реального часу зброї: кігті встигають три
 * кадри за 0,10 с, Тавро розтягує свої три на 0,45 с — і жодна не
 * «наздоганяє» дію. Межа кадру удару збігається з початком вікна
 * шкоди (k = 0,20), тож замах закінчується рівно тоді, коли зброя
 * починає ранити.
 */
function meleePose(id, k, idx, side) {
  switch (id) {
    case 'arc':                                   // рубальний замах через плече
      if (k < 0.20) return idx === 1 ? 'a_arcW2' : 'a_arcW';
      if (k < 0.72) return ['a_arc1', 'a_arc2', 'a_arc3'][idx] || 'a_arc1';
      return idx === 2 ? 'a_arcT' : 'a_arcR';     // третій удар — з розворотом корпусу
    case 'whip':                                  // межі = реальні фази хлиста
      if (k < 0.14) return 'a_whip1';             // 0,12 с: рука відводиться назад
      if (k < 0.27) return 'a_whip2';             // корпус іде в розворот
      if (k < 0.67) return 'a_whip3';             // 0,18 с: широкий викид з нахилом
      return 'a_whip2';                           // 0,15 с: повернення через розворот
    case 'brand':
      if (k < 0.20) return 'a_brand1';            // присідання з підготовкою
      if (k < 0.62) return 'a_brand2';            // удар униз усією вагою
      return 'a_brand3';                          // віддача в плече
    case 'chrono':
      if (k < 0.20) return 'a_chron1';            // низька стійка
      if (k < 0.70) return 'a_chron2';            // різкий випад уперед
      return 'a_chron4';                          // проводка
    case 'claws':                                 // по черзі лівою й правою
      if (k < 0.20) return side ? 'a_claw2' : 'a_claw1';
      if (k < 0.80) return side ? 'a_claw1' : 'a_claw2';
      return 'a_claw3';
  }
  return 'atk';
}
/** Те саме для дальньої: k міряється від реального часу між пострілами. */
function rangedPose(id, k) {
  switch (id) {
    case 'rail':                                  // упор ногою, приклад до плеча
      return k < 0.30 ? 'a_rail2' : k < 0.70 ? 'a_rail3' : 'a_rail1';
    case 'osa':                                   // легка стійка, ствол трохи гуляє
      return k < 0.35 ? 'a_osa2' : k < 0.70 ? 'a_osa1' : 'a_osa3';
    case 'shot':                                  // дві руки й важкий відкид корпусу
      return k < 0.25 ? 'a_shot1' : k < 0.60 ? 'a_shot2' : 'a_shot3';
    case 'swarm':                                 // не стріляє, а вказує рукою
      return k < 0.30 ? 'a_swrm1' : k < 0.75 ? 'a_swrm2' : 'a_swrm3';
    case 'glitch':                                // рука-протез розкривається
      return k < 0.30 ? 'a_gl1' : k < 0.70 ? 'a_gl2' : 'a_gl3';
    case 'prism':
      return k < 0.30 ? 'a_pr1' : k < 0.70 ? 'a_pr2' : 'a_pr3';
  }
  return 'atk';
}
/** Пускає кадри пострілу рівно на стільки, скільки триває сам постріл. */
function shootAnim(dur) { P.shootT = dur; P.shootDur = dur; P.shootW = EQ.r.id; }

function setAnim(st) {
  if (P.aState === st) return;
  P.aState = st;
  P.aT = 0;                                       // таймер кадру — завжди з нуля
  P.aFrame = 0;
  if (st !== AST.IDLE) P.idleT = 0;               // простій рахується лише в IDLE
}
/** Який стан має бути цього кадру. Порядок = пріоритет із ТЗ. */
function resolveAnim(g) {
  if (P.dead) return AST.DEAD;
  if (P.hurtT > 0) return AST.HURT;
  if (P.atkT > 0 || P.tpPose > 0) return AST.ATTACK;
  if (P.shootT > 0) return AST.SHOOT;
  // дробовик перезаряджається довго, і це видно: окремий кадр із цівкою
  if (EQ.r.id === 'shot' && P.reloadT > 0) return AST.SHOOT;
  // рейкострил на утриманні стоїть в упорі — це його готова стійка
  if (EQ.r.id === 'rail' && P.cHold > 0) return AST.SHOOT;
  if (P.dashT > 0) return AST.DASH;
  if (!P.onGround) return (P.vy * g < 0) ? AST.JUMP : AST.FALL;
  if (P.landT > 0) return AST.LAND;
  if (P.moveIntent && Math.abs(P.vx) > ANIM.VXRUN) return AST.RUN;
  return AST.IDLE;                                // ковзання по інерції — теж спокій
}
function stepAnim(dt, g) {
  // приземлення: короткий кадр присідання, далі стан вирішиться сам
  if (P.onGround && !P.wasGround && P.dashT <= 0 && P.atkT <= 0) P.landT = ANIM.LAND;
  P.wasGround = P.onGround;
  if (P.landT > 0) P.landT -= dt;
  if (P.shootT > 0) P.shootT -= dt;
  if (P.tpPose > 0) P.tpPose -= dt;

  setAnim(resolveAnim(g));
  P.aT += dt;
  P.animT = P.aT;                                 // сумісність: рендер дивиться на animT

  switch (P.aState) {
    case AST.RUN: {
      // Вісім кадрів замість трьох: хода береться з формули, тож цикл
      // плавний і в ньому видно перенос ваги, а не «крок-крок».
      const fps = 10 + Math.abs(P.vx) / S(16);
      P.aFrame = Math.floor(P.aT * fps) % 8;
      P.anim = 'run' + (P.aFrame + 1);
      break;
    }
    case AST.IDLE: {
      P.idleT += dt;
      P.blinkT -= dt;
      if (P.blinkT < -0.12) P.blinkT = 2.4 + Math.random() * 2.6;
      if (P.idleT > ANIM.LONGIDLE && P.idleT < ANIM.LONGIDLE + ANIM.LONGDUR) {
        // довга анімація простою: Ехо поправляє хромований протез
        P.aFrame = Math.floor((P.idleT - ANIM.LONGIDLE) * ANIM.IDLEFPS) % 4;
        P.anim = ['idle2a', 'idle2b', 'idle2b', 'idle2a'][P.aFrame];
      } else {
        if (P.idleT >= ANIM.LONGIDLE + ANIM.LONGDUR) P.idleT = 0;
        P.aFrame = Math.floor(P.aT * ANIM.IDLEFPS) % 2;
        P.anim = (P.blinkT <= 0) ? 'blink' : 'idle';
      }
      break;
    }
    case AST.LAND:   P.anim = 'land'; break;
    case AST.JUMP:   P.anim = 'jump'; break;
    case AST.FALL:   P.anim = 'fall'; break;
    case AST.DASH:   P.anim = 'jump'; break;
    case AST.ATTACK: {
      if (P.tpPose > 0) {
        // телепорт крізь ворога: випад — поява спиною до камери — стійка
        const t = 1 - P.tpPose / 0.22;
        P.anim = t < 0.25 ? 'a_chron2' : t < 0.78 ? 'a_chron3' : 'a_chron1';
        break;
      }
      const w = EQ.m;
      const total = w.id === 'arc' ? BL.DUR[P.atkIdx] : w.swing[0];
      P.anim = meleePose(w.id, clamp(1 - P.atkT / Math.max(total, 0.001), 0, 1),
                         P.atkIdx, P.clawSide);
      break;
    }
    case AST.SHOOT: {
      const id = EQ.r.id;
      if (id === 'shot' && P.reloadT > 0 && P.shootT <= 0) {
        // цівка ходить туди-сюди, поки триває перезаряджання
        P.anim = (Math.floor(P.reloadT * 4) % 2) ? 'a_shotR' : 'a_shot1';
      } else if (P.shootT <= 0) {
        P.anim = 'a_rail1';                               // упор під час заряду
      } else {
        P.anim = rangedPose(id, clamp(1 - P.shootT / Math.max(P.shootDur, 0.001), 0, 1));
      }
      break;
    }
    case AST.HURT:   P.anim = 'hurt'; break;
    case AST.DEAD:   P.anim = 'hurt'; break;
  }
  // На двох серцях і менше героїня ВИГЛЯДАЄ побитою: подряпини на
  // куртці й іскри з протеза. Стан здоров'я читається з персонажа,
  // а не тільки зі смужки вгорі — дивитись туди в бою ніколи.
  P.worn = P.hp <= 2 && !P.dead;
  if (P.worn && HERO_DMG.indexOf(P.anim) >= 0) P.anim = 'dmg_' + P.anim;
  // дихання: у спокої повільне, у русі частіше
  P.breath += dt * (P.aState === AST.IDLE ? 2.2 : 4.4);
}

/* -------------------------------------------------------- ДАЛЬНІЙ БІЙ */
function rangedUpdate(dt, IN) {
  const w = EQ.r;
  if (P.reloadT > 0) {
    P.reloadT -= dt;
    if (P.reloadT <= 0) { P.shells = 6; Sfx.reload(); }
  }
  switch (w.id) {
    case 'rail': railUpdate(dt, IN); break;
    case 'osa':
      osaScan();
      if (IN.c && P.fireCd <= 0 && P.dashT <= 0) osaShoot();
      break;
    case 'shot':
      if (IN.cP && P.fireCd <= 0 && P.dashT <= 0) {
        if (P.shells > 0) shotFire();
        else if (P.reloadT <= 0) { P.reloadT = SH.RELOAD; Sfx.blocked(); }
      }
      break;
    case 'swarm':
      if (P.droneCd > 0) P.droneCd -= dt;
      if (IN.cP && P.dashT <= 0 && P.droneCd <= 0) launchDrone();
      break;
    case 'glitch':
      if (IN.cP && P.fireCd <= 0 && P.dashT <= 0) glitchFire();
      break;
    case 'prism':
      if (IN.cP && P.fireCd <= 0 && P.dashT <= 0) prismFire();
      break;
  }
}
/** Ехо-Призма: один постріл коштує ядро, далі все робить рикошет. */
function prismFire() {
  if (P.cores < 1 && !(DEV_MODE && CH.res)) { Sfx.blocked(); return; }
  P.cores--;
  if (DEV_MODE && CH.res) P.cores = 3;                   // чит: ядра не витрачаються
  const y = P.y + Si(6);
  const b = shoot(P.x + P.w / 2 + P.face * Si(8), y, P.face * S(300), 0,
    { own: 'p', dmg: EQ.r.dmg, w: 5, h: 5, col: '#8fdcff', life: 2.4, kind: 6 });
  b.bounce = 5;
  b.gx = P.x + P.w / 2 + P.face * Si(8); b.gy = y;      // початок геометричної сітки
  P.fireCd = 0.34; P.noise = 0.8; shootAnim(0.34);
  Sfx.wPrism(); buzz(12);
  ring(P.x + P.w / 2 + P.face * Si(8), y, 2, 16, 0.25, '#8fdcff', 2);
}
/** Рейкострил — поведінка з версії 1.x, без змін. */
function railUpdate(dt, IN) {
  if (P.lock) {
    P.lockT -= dt;
    P.arMark = clamp(1 - P.lockT / RG.LOCK, 0, 1);
    if (IN.cP) activeReload();
    if (P.lockT <= 0) { P.lock = false; P.heat = 0; P.cHold = 0; }
    return;
  }
  if (IN.cP && P.fireCd <= 0 && P.dashT <= 0) railShoot();
  if (IN.c && !P.lock) {
    P.cHold += dt;
    if (P.cHold >= RG.CHARGE && !P.chargeReady) { P.chargeReady = true; Sfx.charge(); P.noise = 1.2; }
    if (P.chargeReady && Math.random() < 0.5)
      part(P.x + P.w / 2 + P.face * 9, P.y + 6, rnd(-25, 25), rnd(-25, 25), 0.2, '#ffd23f', 1, 0, 1);
  } else P.cHold = 0;
  if (IN.cR) {
    if (P.chargeReady && !P.lock) railBeam();
    P.chargeReady = false; P.cHold = 0;
  }
  // у гарячій зоні охолодження не встигає за нагрівом
  if (P.fireCd <= -RG.DELAY + RG.CD)
    P.heat = Math.max(0, P.heat - RG.COOL * dt / (P.heatK || 1));
}
/** «Оса»: самонавідна куля, слабка, зате нескінченна. */
function osaShoot() {
  const y = P.y + Si(6);
  const b = shoot(P.x + P.w / 2 + P.face * Si(8), y, P.face * 300, 0,
    { own: 'p', dmg: EQ.r.dmg, w: 5, h: 3, col: '#ffd23f', life: 1.1, kind: 1 });
  b.home = 1;
  b.tr = [];                                       // трасер: саме по ньому видно доводку
  P.fireCd = 0.115; shootAnim(0.115);
  P.noise = 0.4;
  Sfx.wOsa();
  part(P.x + P.w / 2 + P.face * 10, y, P.face * 60, 0, 0.12, '#ffd23f', 1, 0, 1);
}
/** Сканер на стволі: «клацає» на цілі за мить до пострілу. */
function osaScan() {
  const t = pickTarget(P.x + P.w / 2, P.y + Si(6), P.face, 0, S(160), 0.35);
  // сканер підсвічує рівно ту коробку, в яку піде куля — разом із босом
  P.scan = t ? { x: t.x, y: t.y, w: t.w, h: t.h, kind: t.kind } : null;
}
/** Дробовик: конус із шести дробин, сильна віддача. */
function shotFire() {
  const y = P.y + Si(6);
  P.shells--;
  if (DEV_MODE && CH.res) { P.shells = 6; P.reloadT = 0; }
  // Конус РОЗКРИВАЄТЬСЯ З ВІДСТАННЮ, а не одразу від ствола. Раніше
  // дробини розліталися на 45° просто з дула, тож упритул у ворога
  // потрапляли одна-дві з шести — і дробовик бив слабше за пістолет.
  // Тепер бічна швидкість наростає лінійно до SH.OPEN: до 30 px розліт
  // ~3 px (влучають усі шість), на 100 px конус виходить на свої 45°.
  for (let i = 0; i < 6; i++) {
    const a = (i - 2.5) / 5 * (45 * Math.PI / 180);
    const sp = S(420 + rnd(-30, 30));
    const b = shoot(P.x + P.w / 2 + P.face * Si(8), y, P.face * sp, 0,
      { own: 'p', dmg: EQ.r.dmg, w: 4, h: 3, col: '#ffb03f', life: 0.26, kind: 1 });
    b.falloff = 1;
    b.spreadV = Math.tan(a) * sp * 2;               // куди дробина розійдеться
  }
  P.fireCd = 0.36; shootAnim(0.36);
  P.noise = 1.0;
  P.vx -= P.face * S(P.onGround ? 110 : 285);       // віддача: у повітрі — як другий стрибок
  if (!P.onGround && P.vy > -S(60)) P.vy -= S(70);
  wfx({ k: 'muzzle', x: P.x + P.w / 2 + P.face * Si(10), y: y, face: P.face, t: 0.40 });
  // гільза, що падає й дзвенить
  part(P.x + P.w / 2 - P.face * 5, y - 3, -P.face * rnd(60, 110), rnd(-150, -90), 0.7, '#ffb03f', 2, 460, 1);
  // ВІДЧУТТЯ ПОСТРІЛУ. Шкода вже була, а пострілу — ні: 6,75 одиниць
  // проходили без жодного сліду на екрані. Тепер удар читається до того,
  // як гравець побачить смужку HP: спалах на пів кадру, стоп-кадр 90 мс,
  // сильна тряска й низький гуркіт у звуці.
  wfx({ k: 'blast', x: P.x + P.w / 2 + P.face * Si(14), y: y, face: P.face, t: 0.22 });
  Sfx.wShot(); Sfx.shell(); buzz([30, 20, 60]); cam.hit(9); hitStop(0.09);
  for (let i = 0; i < 8; i++)
    part(P.x + P.w / 2 + P.face * 12, y, P.face * rnd(60, 200), rnd(-70, 70), rnd(0.15, 0.3), '#ffd23f', 1, 40, 1);
  for (let i = 0; i < 10; i++)                     // дим із дула — повільний і сірий
    part(P.x + P.w / 2 + P.face * rnd(10, 22), y + rnd(-3, 3), P.face * rnd(10, 45), rnd(-25, 5),
         rnd(0.4, 0.8), '#8a7fa0', 2, -12, 1);
  if (P.shells <= 0) P.reloadT = SH.RELOAD;
}
/** «Рій»: тап позначає ціль, вільний дрон відривається від строю.
    Ціль шукається в єдиному списку, тож дрони вміють брати й боса. */
function launchDrone() {
  const best = pickTarget(P.x + P.w / 2, P.y + Si(7), P.face, 0, S(220), 0);
  P.mark = best || null;
  const d = DRONES.find(q => q.st === 'orbit' && q.cd <= 0);
  if (!d) { Sfx.blocked(); return; }
  d.st = 'strike'; d.t = DRONE_LIFE; d.tgt = best; d.tr.length = 0;
  P.droneCd = (DEV_MODE && CH.res) ? 0 : 3;               // чит: дрони без перезарядки
  shootAnim(0.45);
  Sfx.wSwarm();
}
const DRONE_LIFE = 7;                               // скільки дрон працює по цілі
const DRONE_RECHARGE = 2;                           // і скільки потім тьмяніє знизу
/** Точка в строю: три висоти, легке погойдування. */
function orbitPos(d, t) {
  const a = t * 1.4 + d.i * (Math.PI * 2 / 3);
  const low = d.cd > 0 ? 8 : 0;                     // порожній дрон опускається нижче
  return { x: P.x + P.w / 2 + Math.cos(a) * Si(17),
           y: P.y + Si(1 - 8 + d.i * 5) + low + Math.sin(t * 3 + d.i) * Si(2) };
}
function updateDrones(dt) {
  if (EQ.r.id !== 'swarm') { if (DRONES.length) DRONES.length = 0; return; }
  if (DRONES.length !== 3) syncDrones();
  const time = world.time;
  for (let i = 0; i < DRONES.length; i++) {
    const d = DRONES[i];
    if (d.cd > 0) d.cd -= dt;
    if (d.hitT > 0) d.hitT -= dt;

    if (d.st === 'strike') {
      d.t -= dt;
      let tg = d.tgt;
      if (!tg || !tgtAlive(tg)) {                   // ціль впала — шукаємо наступну
        tg = pickTarget(d.x, d.y, P.face, 0, S(400), 0);
        d.tgt = tg;
      }
      const box = tg ? tgtBox(tg) : null;
      if (!tg) d.t = Math.min(d.t, 0.3);
      const tx = box ? box.x + box.w / 2 : P.x + P.w / 2;
      const ty = box ? box.y + box.h / 2 : P.y - Si(12);
      const dx = tx - d.x, dy = ty - d.y, L = Math.max(1, Math.hypot(dx, dy));
      d.vx = lerp(d.vx, dx / L * S(190), dt * 4);
      d.vy = lerp(d.vy, dy / L * S(190), dt * 4);
      d.x += d.vx * dt; d.y += d.vy * dt;
      d.tr.push(d.x, d.y); if (d.tr.length > 30) { d.tr.shift(); d.tr.shift(); }
      if (tg && box && d.hitT <= 0 &&
          boxHit(d.x - 3, d.y - 3, 6, 6, box.x, box.y, box.w, box.h)) {
        // одна точка удару на всі типи цілей: ворог, частина боса, сам бос
        if (tg.e) damageEnemy(tg.e, EQ.r.dmg, sign(d.vx) * S(30), {});
        else bossDamage(tg.hb || { x: box.x, y: box.y, w: box.w, h: box.h, part: tg.part || null },
                        EQ.r.dmg, {});
        d.hitT = 0.5;
        // короткий промінь від дрона до цілі — видно, хто саме вдарив
        wfx({ k: 'dbeam', x: d.x, y: d.y, x2: box.x + box.w / 2, y2: box.y + box.h / 2,
              col: d.col, t: 0.12 });
        burst(d.x, d.y, 4, '#22e0ff', 90, 0.2, 0, 1);
      }
      if (d.t <= 0) {
        d.st = 'back'; d.tgt = null;
        d.cd = (DEV_MODE && CH.res) ? 0 : DRONE_RECHARGE;   // чит: дрони без перезарядки
      }
      continue;
    }

    // 'orbit' і 'back' — повернення в стрій
    const o = orbitPos(d, time);
    const dx = o.x - d.x, dy = o.y - d.y;
    d.vx = lerp(d.vx, dx * 7, dt * 8);
    d.vy = lerp(d.vy, dy * 7, dt * 8);
    d.x += d.vx * dt; d.y += d.vy * dt;
    if (d.tr.length) { d.tr.shift(); d.tr.shift(); }
    if (d.st === 'back' && Math.hypot(dx, dy) < 4) { d.st = 'orbit'; d.tgt = null; }
  }
}
/** Гліч-Код: перехоплює ворога або глушить боса. */
function glitchFire() {
  if (P.cores < 1 && !(DEV_MODE && CH.res)) { Sfx.blocked(); return; }
  P.cores--;
  if (DEV_MODE && CH.res) P.cores = 3;
  const y = P.y + Si(6);
  const g = shoot(P.x + P.w / 2 + P.face * Si(8), y, P.face * S(240), 0,
    { own: 'p', dmg: 0, w: 7, h: 7, col: '#00ffcc', life: 2, kind: 5 });
  g.pix = [];                                       // постріл летить як розсип пікселів
  for (let i = 0; i < 7; i++) g.pix.push({ ox: rnd(-5, 5), oy: rnd(-5, 5), sp: rnd(0.6, 1.8) });
  P.fireCd = 0.3; shootAnim(0.3);
  Sfx.wGlitch();
}
export function glitchHit(e) {
  e.charm = 6; e.charmMax = 6; e.stun = 0;
  Sfx.wGlitch();
  ring(e.x + e.w / 2, e.y + e.h / 2, 3, 26, 0.4, '#00ffcc', 2);
  burst(e.x + e.w / 2, e.y + e.h / 2, 12, '#00ffcc', 120, 0.4, 0, 1);
}
export function addCore(n) {
  P.coreFrac += n;
  while (P.coreFrac >= 1 && P.cores < 3) { P.coreFrac -= 1; P.cores++; }
  if (P.cores >= 3) P.coreFrac = 0;
}
export function timeScale() { return slowT > 0 ? 0.45 : 1; }
export function tickSlow(dt) { if (slowT > 0) slowT -= dt; if (desatT > 0) desatT -= dt; }
export function getDesat() { return desatT > 0 ? desatT / 0.10 : 0; }
export function getSlow() { return slowT; }
/** Таймінги циклу Гліч-Ядра — потрібні HUD'у (смужка) і перевіркам. */
export const GLITCH = {
  get OPEN_H() { return GL_OPEN_H; },
  get WARN() { return GL_WARN; },
  get FLY() { return GL_FLY; },
  get WIN() { return GL_WIN; },
  get FOLD() { return GL_FOLD; },
  get DETACH() { return GL_DETACH; },
  get CEIL() { return GL_CEIL; },
  get DOCKS() { return GL_DOCKS; },
  dockPos: i => glitchDockPos(i),
  nodesLeft: () => glitchNodesLeft()
};

/* ---------------- допоміжне ---------------- */
function rectSolid(x, y, w, h) {
  const x0 = Math.floor(x / TS), x1 = Math.floor((x + w - 1) / TS);
  const y0 = Math.floor(y / TS), y1 = Math.floor((y + h - 1) / TS);
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++)
      if (isSolidCode(tAt(tx, ty))) return true;
  return false;
}
let hitStopT = 0;
function hitStop(t) { hitStopT = Math.max(hitStopT, t); }

/* ---------------- головне оновлення героя ---------------- */
function updatePlayer(dt) {
  const IN = Input.S, g = world.grav;   // знімок вводу; S() — це масштаб

  // ---- таймери ----
  if (P.inv > 0) P.inv -= dt;
  if (P.hurtT > 0) P.hurtT -= dt;
  if (P.dashCd > 0) P.dashCd -= dt;
  if (P.comboT > 0) P.comboT -= dt;
  if (P.parryT > 0) P.parryT -= dt;
  P.fireCd -= dt; if (P.fireCd < -1) P.fireCd = -1;
  if (P.recoil > 0) P.recoil -= dt;
  if (P.noise > 0) P.noise -= dt;
  if (P.dropT > 0) P.dropT -= dt;
  if (P.dischT > 0) P.dischT -= dt;
  if (P.spawnFx > 0) P.spawnFx -= dt;
  if (P.flipT > 0) P.flipT -= dt;

  // ---- смерть ----
  if (P.dead) {
    P.vy += PH.GRAV * g * dt;
    moveX(P, P.vx * dt); moveY(P, P.vy * dt, false);
    P.vx *= 0.94;
    P.deadT -= dt;
    if (P.deadT <= 0) Game.onDeath();
    return;
  }

  // ---- вихід із рівня ----
  if (P.exiting > 0) {
    P.exiting -= dt;
    P.vx *= 0.86;
    moveX(P, P.vx * dt);
    P.vy += PH.GRAV * g * dt;
    if (moveY(P, P.vy * dt, true) === g) P.vy = 0;
    if (P.exiting <= 0) Game.levelClear();
    return;
  }

  // ---- ЧИТ: політ і noclip ----
  // Повністю обходить фізику й колізії: ← → ведуть убік, утримання A —
  // вгору, без A — повільно вниз. Нічого з гри не переписує: вимкнув —
  // і наступний кадр рахується звичайним кодом нижче.
  if (DEV_MODE && CH.fly) {
    const FLYV = S(210);                            // швидкість польоту в масштабі світу
    P.vx = 0; P.vy = 0; P.dropHold = 0; P.dashT = 0;
    P.x = clamp(P.x + IN.ax * FLYV * dt, 0, world.pw - P.w);
    P.y += (IN.a ? -FLYV : FLYV * 0.35) * dt;
    P.y = clamp(P.y, -Si(32), world.th * TS + Si(32));
    P.onGround = false; P.ride = null; P.jumps = 0; P.coyote = 0;
    P.moveIntent = Math.abs(IN.ax) > 0.12;
    if (Math.abs(IN.ax) > 0.12) P.face = IN.ax > 0 ? 1 : -1;
    meleeUpdate(dt, IN);                            // зброя в польоті працює
    rangedUpdate(dt, IN);
    stepAnim(dt, world.grav);
    return;
  }

  // ---- спуск крізь тонку платформу: утримання A 0,4 с ----
  // Лічильник іде лише поки героїня стоїть на тонкій платформі й кнопка
  // вже була натиснута до приземлення (свіже натискання = стрибок, і воно
  // миттєво відриває від землі, тож лічильник обнуляється сам).
  const onThin = P.onGround && P.dashT <= 0 && g > 0 &&
                 (!!P.ride ||                       // рухомі платформи теж односторонні
                  tAt(Math.floor((P.x + P.w / 2) / TS),
                      Math.floor((P.y + P.h + 2) / TS)) === T_PLAT);
  if (IN.a && onThin) {
    P.dropHold += dt;
    // натяк: за 0,15 с до спуску з-під ніг сиплеться пил
    if (P.dropHold > PH.DROP_HOLD - 0.15 && Math.random() < 0.4)
      part(P.x + P.w / 2 + rnd(-5, 5), P.y + P.h, rnd(-14, 14), 26, 0.22, '#9a7fb5', 1, 0, 1);
  } else P.dropHold = 0;
  if (P.dropHold >= PH.DROP_HOLD) {
    P.dropHold = 0;
    P.dropT = 0.26; P.onGround = false; P.ride = null; P.y += 3;
    burst(P.x + P.w / 2, P.y + P.h, 4, '#9a7fb5', 60, 0.2, 40, 1);
  }

  // ---- горизонтальний рух ----
  if (P.dashT <= 0) {
    const acc = P.onGround ? PH.ACC : PH.ACC * PH.AIRCTRL;
    const target = Math.abs(IN.ax) > 0.12 ? IN.ax * PH.RUN : 0;
    if (target !== 0) {
      if (P.vx < target) P.vx = Math.min(target, P.vx + acc * dt);
      else if (P.vx > target) P.vx = Math.max(target, P.vx - acc * dt * (P.vx * target < 0 ? 1.7 : 0.55));
      if (P.atkT <= 0) P.face = target > 0 ? 1 : -1;
    } else {
      const fr = (P.onGround ? PH.DEC : PH.AIRDEC) * dt;
      if (Math.abs(P.vx) <= fr) P.vx = 0; else P.vx -= sign(P.vx) * fr;
      // мертва зона: без вводу залишок швидкості нижче 5 px/с — це нуль,
      // а не «дуже повільний біг», який ганяв би анімацію вічно
      if (Math.abs(P.vx) < ANIM.VXDEAD) P.vx = 0;
    }
  }
  P.moveIntent = Math.abs(IN.ax) > 0.12;            // намір, а не швидкість

  // ---- стрибок: буфер + coyote + змінна висота ----
  if (IN.aP) P.jbuf = PH.BUFFER;
  if (P.onGround) { P.coyote = PH.COYOTE; P.jumps = 0; P.wallRestored = false; }
  else if (P.coyote <= 0 && P.jumps === 0) P.jumps = 1;   // зійшов із краю, не стрибаючи
  const groundJump = P.jbuf > 0 && P.coyote > 0 && P.jumps === 0 && P.dashT <= 0;
  const airJump = !groundJump && P.jbuf > 0 && P.dashT <= 0 &&
                  !P.onGround && P.coyote <= 0 &&
                  P.jumps <= PH.AIRJUMPS + (DEV_MODE && CH.jump3 ? 1 : 0);
  if (!groundJump && !airJump) {                   // таймери спливають лише поки стрибок неможливий
    if (P.jbuf > 0) P.jbuf -= dt;
    if (!P.onGround && P.coyote > 0) P.coyote -= dt;
  } else {
    P.vy = -(groundJump ? PH.JUMP : PH.JUMP2) * g;
    P.onGround = false; P.coyote = 0; P.jbuf = 0; P.jumpHeld = true; P.ride = null;
    P.jumps = groundJump ? 1 : P.jumps + 1;
    Tut.note(groundJump ? 'jumped' : 'djumped');
    Sfx.jump();
    if (airJump) {                                 // подвійний стрибок: сальто + кільце частинок
      P.flipT = 0.40;
      Sfx.dash();
      ring(P.x + P.w / 2, P.y + P.h / 2, 3, 22, 0.32, '#22e0ff', 2);
      for (let i = 0; i < 10; i++) {
        const a = i / 10 * Math.PI * 2;
        part(P.x + P.w / 2 + Math.cos(a) * 6, P.y + P.h / 2 + Math.sin(a) * 6,
             Math.cos(a) * 70, Math.sin(a) * 70, 0.3, '#7df9ff', 1, 20, 1);
      }
    } else {
      for (let i = 0; i < 4; i++)
        part(P.x + P.w / 2 + rnd(-4, 4), P.y + P.h, rnd(-40, 40), 30 * g, 0.2, '#7b2fbe', 1, 0, 1);
    }
  }
  if (P.jumpHeld && !IN.a) {
    P.jumpHeld = false;
    if (P.vy * g < 0) P.vy *= PH.CUT;              // змінна висота стрибка
  }

  // ---- ривок ----
  if (IN.dashP && P.dashCd <= 0 && P.dashT <= 0) {
    P.dashT = PH.DASHT; P.dashCd = (DEV_MODE && CH.dash) ? 0 : PH.DASHCD;
    Tut.note('dashed');
    P.dashDir = IN.dashDir !== 0 ? IN.dashDir : (Math.abs(IN.ax) > 0.3 ? sign(IN.ax) : P.face);
    P.face = P.dashDir; P.noise = 0.5;
    Sfx.dash(); buzz(10);
  }
  if (P.dashT > 0) {
    P.dashT -= dt;
    P.vx = P.dashDir * PH.DASHV;
    P.vy = 0;
    part(P.x + P.w / 2 - P.dashDir * 4, P.y + rnd(2, 12), -P.dashDir * rnd(20, 70), rnd(-20, 20),
         0.22, '#22e0ff', 2, 0, 1);
  } else {
    // ---- гравітація: біля вершини слабша, на падінні сильніша ----
    let gr = PH.GRAV;
    if (Math.abs(P.vy) < PH.APEX_V) gr *= PH.APEX;
    else if (P.vy * g > 0) gr *= PH.FALL;
    P.vy += gr * g * dt;
    if (P.vy * g > PH.MAXFALL) P.vy = PH.MAXFALL * g;
  }

  // ---- рух: рухома платформа, потім X, потім Y ----
  if (P.ride) {
    if (P.ride.dx) moveX(P, P.ride.dx);
    if (P.ride.dy) P.y += P.ride.dy;
  }
  if (moveX(P, P.vx * dt)) {
    P.vx = 0;
    // чіпнув стіну в повітрі — повертаємо один повітряний стрибок (щоб не було
    // нескінченного «залізання» по стіні, лише раз за політ)
    if (!P.onGround && !P.wallRestored && P.jumps > 1) {
      P.jumps = 1; P.wallRestored = true;
      part(P.x + (P.face > 0 ? P.w : 0), P.y + 6, -P.face * 40, -20, 0.25, '#22e0ff', 1, 0, 1);
    }
  }
  P.x = clamp(P.x, 0, world.pw - P.w);

  const prevBottom = P.y + P.h;
  const r = moveY(P, P.vy * dt, P.dropT <= 0 && g > 0);
  let grounded = (r === g);
  let ride = null;
  if (g > 0 && !grounded && P.vy > 0 && P.dropT <= 0) {
    const m = landOnMP(P, prevBottom);
    if (m) { grounded = true; ride = m; }
  }
  if (grounded) {
    if (!P.onGround && Math.abs(P.vy) > S(150)) {
      Sfx.land(); P.noise = 0.35;
      for (let i = 0; i < 5; i++)
        part(P.x + P.w / 2 + rnd(-5, 5), P.y + (g > 0 ? P.h : 0), rnd(-60, 60), -20 * g, 0.22, '#9a7fb5', 1, 60 * g, 1);
    }
    P.onGround = true; P.vy = 0; P.jumpHeld = false;
    P.ride = ride || (P.ride && mpUnder(P) === P.ride ? P.ride : null);
  } else {
    if (r === -g) P.vy = 0;
    P.onGround = false; P.ride = null;
  }

  // ---- конвеєри ----
  if (P.onGround && !P.ride) {
    const c = tAt(Math.floor((P.x + P.w / 2) / TS), Math.floor((P.y + P.h + 1) / TS));
    if (c === T_CONVR) moveX(P, PH.CONV * dt);
    else if (c === T_CONVL) moveX(P, -PH.CONV * dt);
  }

  // ---- шипи ----
  {
    const x0 = Math.floor((P.x + 1) / TS), x1 = Math.floor((P.x + P.w - 2) / TS);
    const y0 = Math.floor((P.y + 2) / TS), y1 = Math.floor((P.y + P.h - 1) / TS);
    let sp = false;
    for (let ty = y0; ty <= y1 && !sp; ty++)
      for (let tx = x0; tx <= x1 && !sp; tx++)
        if (tAt(tx, ty) === T_SPIKE) sp = true;
    if (sp) playerHurt(1, P.x + P.w / 2 - P.face * Si(10));
  }

  // ---- падіння за межі карти ----
  if (P.y > world.ph + Si(24) || P.y < -Si(80)) {
    if (!GOD && !(DEV_MODE && CH.invuln)) P.hp -= 1;
    if (P.hp <= 0) { P.hp = 0; P.x = world.cp.x; P.y = world.cp.y; playerDie(); }
    else {
      Sfx.hurt(); buzz(30); cam.hit(3);
      playerSpawnAt(world.cp.x, world.cp.y);
      P.inv = 1.4;
    }
    return;
  }

  levelFx(dt);                                    // характер сектора: своя механіка
  Tut.update(dt);                                 // навчання: контекстні підказки
  rangeUpdate(dt);                                // тренувальна кімната
  if (TUTFX.sayT > 0) TUTFX.sayT -= dt;
  // Ворота тренування парирування: далі не йдемо, поки не паріювала
  // двічі. М'яко — стіною, а не смертю, і з пропуском після п'яти невдач.
  if (TUTFX.gate && P.x + P.w > TUTFX.gate) {
    P.x = TUTFX.gate - P.w;
    if (P.vx > 0) P.vx = 0;
  }

  meleeUpdate(dt, IN);

  rangedUpdate(dt, IN);

  // ---- підбирання аптечок ----
  for (let i = PICKS.length - 1; i >= 0; i--) {
    const pk = PICKS[i];
    pk.t += dt;
    if (pk.off) continue;                            // ще відроджується
    if (!boxHit(P.x, P.y, P.w, P.h, pk.x, pk.y, Si(10), Si(9))) continue;
    let taken = false;
    if (pk.kind === 'frag') {
      taken = true;
      if (Store.data.frags.indexOf(world.idx) < 0) {
        Store.data.frags.push(world.idx); Store.save();
        Music.sting('secret'); Music.duck(1.6);
        Game.pickupName = 'ФРАГМЕНТ ПРИЗМИ ' + Store.data.frags.length + '/3';
      } else { Game.pickupName = 'ФРАГМЕНТ УЖЕ ЗІБРАНО'; playerHeal(1); }
      Game.pickupT = 3.0;
      Sfx.win(); buzz(24);
      ring(pk.x + 5, pk.y + 4, 4, 42, 0.7, '#8fdcff', 3);
      burst(pk.x + 5, pk.y + 4, 18, '#8fdcff', 160, 0.7, 30, 2);
    } else if (pk.kind === 'log') {
      taken = true;
      if (Store.data.logs.indexOf(world.idx) < 0) { Store.data.logs.push(world.idx); Store.save(); }
      Game.pickupName = 'ДАТА-ЛОГ ' + (world.idx + 1); Game.pickupT = 2.6;
      Sfx.pickup(); playerHeal(1);
      ring(pk.x + 5, pk.y + 4, 3, 26, 0.5, '#22e0ff', 2);
    } else {
      taken = playerHeal(1);
    }
    if (taken) {
      // ЛЕГКИЙ: аптечка на арені боса відроджується кожні 30 с — бій
      // перестає бути «одна помилка в третій фазі = все спочатку».
      if (DIFF.medkit && BOSS.on && pk.kind === 'med')
        PICKS.push({ x: pk.x, y: pk.y, t: 0, kind: 'med', back: DIFF.medkit, off: 1 });
      PICKS[i] = PICKS[PICKS.length - 1]; PICKS.pop();
    }
  }
  // Аптечка, що відроджується: поки `off` — її не видно й не підібрати.
  for (let i = 0; i < PICKS.length; i++) {
    const pk = PICKS[i];
    if (!pk.off) continue;
    pk.back -= dt;
    if (pk.back <= 0) { pk.off = 0; ring(pk.x + 5, pk.y + 4, 2, 20, 0.4, '#ff2e88', 2); }
  }

  // ---- чекпоінти (їх на рівні два) ----
  for (let i = 0; i < world.cps.length; i++) {
    const c = world.cps[i];
    if (c.taken || Math.abs(P.x - c.x) > Si(14) || Math.abs(P.y - c.y) > Si(30)) continue;
    c.taken = true;
    world.cpTaken = true;
    Game.cpTaken = true;
    Game.cpIndex = i;                             // з якого саме перезапускатись
    world.cp.x = c.x; world.cp.y = c.y;
    Sfx.checkpoint();
    ring(c.x + 5, c.y + 7, 4, 26, 0.5, '#3dff9a', 2);
    for (let k = 0; k < 12; k++)
      part(c.x + 5, c.y + 12, rnd(-40, 40), rnd(-90, -20), rnd(0.3, 0.7), '#3dff9a', 1, 90, 1);
    tryAssemblePrism();                           // три фрагменти = призма збирається тут
  }

  // ---- тригер боса ----
  if (world.bossX > 0 && !BOSS.on && !BOSS.done && !Game.cutT && P.x + P.w > world.bossX + 8) {
    Game.cutT = true;                               // тригер спрацьовує рівно раз
    playCut('pre', () => { Game.cutT = false; startBoss(); });
  }

  // ---- вихід ----
  if (world.exitOpen && boxHit(P.x, P.y, P.w, P.h, world.exit.x + Si(2), world.exit.y, Si(14), Si(32))) {
    P.exiting = 0.8;
    Sfx.win();
    ring(world.exit.x + 9, world.exit.y + 16, 4, 30, 0.6, '#ffd23f', 2);
  }

  // ---- анімація ----
  stepAnim(dt, g);
}

/* ================================================================
   11. ВОРОГИ — 9 типів, у кожного власна поведінка.
        Велика літера в карті = елітна версія (міцніша, швидша,
        з додатковим прийомом).
   ================================================================ */
// Розміри ворогів збільшено рівно на SPR (x1.35) разом зі спрайтами.
// Розмір і швидкість — у світових пікселях, тож ідуть через SCALE.
// HP і шкода — одиниці балансу, їх масштаб не чіпає.
const ETYPE = {
  skreb:  { w: Si(16), h: Si(12),  hp: 10, sp: S(30),  dmg: 1, fly: false },
  thug:   { w: Si(16), h: Si(20), hp: 20, sp: S(52),  dmg: 1, fly: false },
  turret: { w: Si(19), h: Si(19), hp: 25, sp: S(0),   dmg: 1, fly: false },
  wasp:   { w: Si(16), h: Si(14), hp: 15, sp: S(46),  dmg: 1, fly: true },
  kami:   { w: Si(15), h: Si(15), hp: 10, sp: S(96),  dmg: 2, fly: true },
  shield: { w: Si(19), h: Si(22), hp: 40, sp: S(32),  dmg: 1, fly: false },
  adept:  { w: Si(16), h: Si(20), hp: 30, sp: S(60),  dmg: 1, fly: false },
  phantom:{ w: Si(16), h: Si(20), hp: 25, sp: S(90),  dmg: 1, fly: true },
  spider: { w: Si(16), h: Si(14), hp: 15, sp: S(40),  dmg: 1, fly: false },
  // --- моби-передвісники босів ---
  rammer:  { w: Si(19), h: Si(16), hp: 20,  sp: S(40), dmg: 1, fly: false },
  anvil:   { w: Si(22), h: Si(22), hp: 30,  sp: S(26), dmg: 1, fly: false },
  carrier: { w: Si(24), h: Si(19), hp: 30,  sp: S(34), dmg: 1, fly: true },
  pylon:   { w: Si(16), h: Si(27), hp: 40,  sp: S(0),  dmg: 1, fly: false },
  blinker: { w: Si(16), h: Si(14), hp: 15,  sp: S(70), dmg: 1, fly: false },
  worm:    { w: Si(19), h: Si(14), hp: 25,  sp: S(32), dmg: 1, fly: false },
  arch1:   { w: Si(22), h: Si(27), hp: 40,  sp: S(52), dmg: 1, fly: false },
  arch2:   { w: Si(22), h: Si(27), hp: 45,  sp: S(40), dmg: 1, fly: false },
  arch3:   { w: Si(22), h: Si(27), hp: 50, sp: S(60), dmg: 1, fly: false }
};

/* ================================================================
   11a. СПІЛЬНИЙ ШІ: краї, стани тривоги, токени атаки, чесність
   ================================================================ */
const AI_DIR = { tokens: [], eBullets: 0 };
const REACT = 0.25;                                 // час реакції ворога, с
const SEP = Si(14);                                     // мінімальна дистанція між ворогами
const MAX_ATTACKERS = 2;                            // одночасно атакують максимум двоє
/* Дробовик «Картеч»: на якій відстані конус виходить на повні 45°
   і де шкода вже майже нульова. */
/* Дробовик «Картеч» — числа з таблиці зброї, в абсолютних одиницях
   (один удар Арк-тесака = 10):
     до NEAR  — усі шість дробин по 8 = 48 за постріл, гармата;
     на 60 px — конус уже розійшовся, доходить половина: ~24;
     на RANGE і далі — майже нічого, 6 і менше.
   NEAR існує саме тому, що впритул падіння шкоди не має бути взагалі:
   інакше «упритул» нічим не відрізняється від «близько». */
// RELOAD 1,8 -> 1,2 с: саме перезаряджання, а не шкода, тримало сумарний
// DPS нижче за пістолет учетверо — шість пострілів по 48 і так сильні.
const SH = { OPEN: 62, RANGE: 215, NEAR: 30, GIB: 46, RELOAD: 1.0 };
const MAX_E_BULLETS = 6;                            // не більше шести ворожих куль у польоті

/** Скільки ворожих куль зараз у польоті. */
function enemyBulletCount() {
  let n = 0;
  for (let i = 0; i < BULL.length; i++) if (BULL[i].own === 'e') n++;
  return n;
}
/** Чи можна ворогові стріляти: ліміт куль + не стріляти з-за спини поза екраном. */
export function mayShoot(e) {
  if (enemyBulletCount() >= MAX_E_BULLETS) return false;
  if (!onScreen(e)) return false;
  if (e.grace > 0) return false;
  return true;
}
function onScreen(e) {
  return e.x + e.w > cam.x - 8 && e.x < cam.x + view.w + 8;
}
/** Важкі не стрибають від зарядженого пострілу — вони на те й важкі. */
const HEAVY = { shield: 1, anvil: 1, turret: 1, pylon: 1, spider: 1 };
/** Токен атаки: одночасно б'ють не більше двох. */
function takeToken(e) {
  if (e.token) return true;
  for (let i = AI_DIR.tokens.length - 1; i >= 0; i--) {
    const o = AI_DIR.tokens[i];
    if (!o || o.dead || o.alertSt !== 'fight') { o && (o.token = 0); AI_DIR.tokens.splice(i, 1); }
  }
  if (AI_DIR.tokens.length >= MAX_ATTACKERS) return false;
  AI_DIR.tokens.push(e); e.token = 1;
  // МАКСИМАЛЬНИЙ: другий ближник не чекає своєї черги, а заходить з
  // протилежного боку ОДНОЧАСНО з першим (фланг йому вже призначено
  // нижче). Штатно він витримує паузу — і з ними можна розібратись по
  // одному; тут доводиться вирішувати, кого пускати першим.
  if (DIFF.mobTrait && AI_DIR.tokens.length === 2) {
    const first = AI_DIR.tokens[0];
    if (first && !first.dead) { e.grace = 0; e.react = Math.min(e.react, first.react); }
  }
  return true;
}
function dropToken(e) {
  if (!e.token) return;
  e.token = 0;
  const i = AI_DIR.tokens.indexOf(e);
  if (i >= 0) AI_DIR.tokens.splice(i, 1);
}
/** Край попереду: промінь униз на 20 px. */
function edgeAhead(e, dir) {
  const x = dir > 0 ? e.x + e.w + 4 : e.x - 4;
  const y = e.y + e.h + 6;
  return !(solidAtPx(x, y) || tAt(Math.floor(x / TS), Math.floor(y / TS)) === T_PLAT);
}
/** Чи є куди приземлитись у межах трьох тайлів. */
function gapJumpable(e, dir) {
  for (let i = 1; i <= 3; i++) {
    const x = e.x + e.w / 2 + dir * i * TS;
    for (let dy = 0; dy <= 2; dy++) {
      const y = e.y + e.h + 6 + dy * TS;
      if (solidAtPx(x, y) || tAt(Math.floor(x / TS), Math.floor(y / TS)) === T_PLAT) return true;
    }
  }
  return false;
}
/** Хода до точки з повагою до країв — ніхто не падає в прірву випадково. */
function walkTo(e, tx, sp) {
  const cx = e.x + e.w / 2;
  const dir = Math.abs(tx - cx) < 4 ? 0 : sign(tx - cx);
  if (dir === 0) { e.vx *= 0.7; return; }
  e.face = dir;
  if (e.onGround && edgeAhead(e, dir)) {
    if (gapJumpable(e, dir)) { e.vy = -S(330); e.vx = dir * sp; return; }
    e.vx = 0; return;                                // стоїмо на краю, а не падаємо
  }
  if (e.hitWall && e.onGround && gapJumpable(e, dir)) e.vy = -S(300);
  e.vx = dir * sp;
}
/** Спільний крок ШІ: стани, реакція, фланг, ухиляння, реакція на зброю. */
function aiCommon(e, dt) {
  if (e.react > 0) e.react -= dt;
  if (e.dodgeCd > 0) e.dodgeCd -= dt;
  if (e.grace > 0) e.grace -= dt;
  if (e.alertT > 0) e.alertT -= dt;

  const dx = (P.x + P.w / 2) - (e.x + e.w / 2);
  const dist = Math.abs(dx);
  const seeR = S(e.elite ? 220 : 185);
  const heard = P.noise > 0 && dist < S(260);
  const canSee = (!e.blind && dist < seeR && Math.abs(P.y - e.y) < Si(90)) || heard || dist < S(34);

  switch (e.alertSt) {
    case 'calm':
      if (canSee) { e.alertSt = 'suspect'; e.alertT = 0.6; }
      break;
    case 'suspect':
      if (!canSee) { if (e.alertT <= 0) e.alertSt = 'calm'; }
      else if (e.alertT <= 0) { e.alertSt = 'fight'; e.react = REACT; e.lastSeen = P.x; }
      break;
    case 'fight':
      if (canSee) e.lastSeen = P.x;
      else { e.alertSt = 'lost'; e.alertT = 3; dropToken(e); }
      break;
    case 'lost':
      if (canSee) { e.alertSt = 'fight'; e.react = REACT * 0.6; }
      else if (e.alertT <= 0) { e.alertSt = 'calm'; }
      break;
  }
  e.canAtk = e.alertSt === 'fight' && e.react <= 0 && e.grace <= 0;

  // --- фланг: другий і далі заходять з іншого боку ---
  e.flank = 0;
  if (e.alertSt === 'fight' && AI_DIR.tokens.length > 0 && AI_DIR.tokens[0] !== e) e.flank = -sign(dx) || 1;

  // --- реакція на заряджений постріл ---
  // Кидок монети РІВНО ОДИН РАЗ на кожне заряджання, і лише для тих, хто
  // справді стоїть на лінії променя. Інакше «розумний» ШІ перетворює
  // заряджений постріл на нікчемний: усі 100% відскакують щоразу.
  if (P.chargeReady && !e.sawCharge) {
    e.sawCharge = 1;
    const inLine = dist < S(170) && sign(dx) === P.face &&
                   Math.abs((P.y + Si(6)) - (e.y + e.h / 2)) < Si(12);
    if (inLine && !HEAVY[e.t] && e.onGround && !ETYPE[e.t].fly && e.dodgeCd <= 0 &&
        Math.random() < DODGE(e)) {
      e.vy = -S(300); e.dodgeCd = 1.4;                             // зійти з лінії пострілу
    }
  } else if (!P.chargeReady) e.sawCharge = 0;
  e.keepAway = (EQ.r.id === 'shot' && dist < S(60)) ? 1 : 0;

  // --- ухиляння від замаху ближньої зброї ---
  if (P.atkT > 0 && dist < S(34) && e.dodgeCd <= 0 && e.onGround && !ETYPE[e.t].fly) {
    if (Math.random() < DODGE(e) * dt * 60 / 12) {
        e.vx = -sign(dx) * S(150); e.vy = -S(260); e.dodgeCd = 1.2;
    }
  }
}
/* МАКСИМАЛЬНИЙ: звичайний моб отримує +1 поведінкову рису — ухиляється
   так само часто, як елітний (55 % проти 30 %). Це не «більше HP»: ворог
   не стає товстішим, він стає уважнішим. */
function DODGE(e) { return e.elite ? 0.55 : (DIFF.mobTrait ? 0.55 : 0.30); }

/** Розділення: вороги не злипаються в купу. */
function separate() {
  for (let i = 0; i < ENEM.length; i++) {
    const a = ENEM[i];
    if (a.dead || ETYPE[a.t].fly) continue;
    for (let j = i + 1; j < ENEM.length; j++) {
      const b = ENEM[j];
      if (b.dead || ETYPE[b.t].fly) continue;
      const d = (a.x + a.w / 2) - (b.x + b.w / 2);
      if (Math.abs(d) > SEP || Math.abs(a.y - b.y) > Si(16)) continue;
      const push = (SEP - Math.abs(d)) * 0.25 * (d >= 0 ? 1 : -1);
      moveX(a, push); moveX(b, -push);
    }
  }
}
let enemyId = 1;
const TRAIL = [];                       // слід гравця для фантомів (1 с = 60 кроків)
const TRAIL_MAX = 70;

function spawnEnemy(type, px, py, elite) {
  const d = ETYPE[type];
  if (!d) return null;
  if (Store.data.ng) elite = true;                 // НОВА ГРА+: усі вороги елітні
  const e = {
    id: enemyId++, t: type, elite: !!elite,
    w: d.w, h: d.h, x: px + (TS - d.w) / 2, y: d.fly ? py + 2 : py + TS - d.h,
    hx: px, hy: py,                       // «домашня» точка
    vx: 0, vy: 0, face: -1, hp: 0, maxHp: 0, dmg: d.dmg, sp: d.sp,
    st: 'idle', tm: 0, tm2: 0, stun: 0, flash: 0, dead: false, onGround: false,
    anim: 0, guard: 0, guardT: 0, parryCd: 0, stagger: 0, broken: false,
    charm: 0, thrown: 0, hs: 0, sawCharge: 0, alertSt: 'calm', alertT: 0, react: 0, lastSeen: 0,
    token: 0, dodgeCd: 0, grace: 0.5, wasOff: 0, canAtk: false, flank: 0,
    keepAway: 0, kids: 0, warded: 0, wards: 0, parent: null, hitWall: false,
    tx: 0, ty: 0, mount: 'floor', blind: false, shots: 0, alert: 0
  };
  e.hp = e.maxHp = elite ? Math.round(d.hp * 1.75) : d.hp;
  if (elite) { e.sp = d.sp * 1.22; e.dmg = d.dmg; }
  if (type === 'turret') {
    const tx = Math.floor(px / TS), ty = Math.floor(py / TS);
    if (isSolidCode(tAt(tx, ty + 1))) e.mount = 'floor';
    else if (isSolidCode(tAt(tx, ty - 1))) e.mount = 'ceil';
    else if (isSolidCode(tAt(tx - 1, ty))) e.mount = 'wallL';
    else if (isSolidCode(tAt(tx + 1, ty))) e.mount = 'wallR';
    e.y = py + (TS - e.h) / 2;
    if (e.mount === 'floor') e.y = py + TS - e.h;
    if (e.mount === 'ceil') e.y = py;
  }
  if (type === 'spider') { e.y = py; e.st = 'hang'; }
  if (type === 'thug' && world.theme === 'metro') e.blind = true;   // сліпі мутанти
  if (type === 'phantom') { e.ofs = rnd(-26, 26); }
  ENEM.push(e);
  return e;
}
function spawnAllEnemies() {
  for (let i = 0; i < world.spawnList.length; i++) {
    const s = world.spawnList[i];
    spawnEnemy(s.t, s.x, s.y, s.elite);
  }
  for (let i = 0; i < world.pickList.length; i++) {
    const p = world.pickList[i];
    PICKS.push({ x: p.x, y: p.y, kind: p.kind || 'med', t: rnd(0, 3) });
  }
}

function killEnemy(e) {
  if (e.dead) return;
  e.dead = true;
  const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
  Sfx.hitEnemy();
  if (e.gib) {
    // Дробовик упритул. Легкий ворог не «зникає з хмаркою», а РОЗЛІТАЄТЬСЯ:
    // уламки корпусу летять по дузі й лишаються на секунду на підлозі.
    Sfx.explode(); cam.hit(5);
    for (let i = 0; i < 16; i++)
      part(cx + rnd(-e.w / 2, e.w / 2), cy + rnd(-e.h / 2, e.h / 2),
           rnd(-180, 180), rnd(-220, -40), rnd(0.5, 1.1), i % 3 ? '#c7d3e0' : '#ff6b3d',
           rnd(1, 3), 320, 2);
    ring(cx, cy, 2, 26, 0.3, '#ffb03f', 2);
    wfx({ k: 'boom', x: cx, y: cy, r: Si(22), t: 0.28 });
  }
  burst(cx, cy, 12, e.elite ? '#ffd23f' : '#ff6b3d', 150, 0.5, 240, 2);
  burst(cx, cy, 6, '#ffffff', 90, 0.25, 120, 1);
  if (e.t === 'kami') kamiBoom(e);
  if (Math.random() < 0.11 && P.hp < P.maxHp) PICKS.push({ x: cx - 5, y: cy - 4, t: 0, kind: 'med' });
  addCore(0.25);                                   // ядра «Гліч-Коду» поповнюються з убитих
  if (BOSS.on && BOSS.type === 'queen' && e.fromBoss) BOSS.spawned = Math.max(0, BOSS.spawned - 1);
}

function damageEnemy(e, dmg, kb, opt) {
  opt = opt || {};
  if (e.dead || dmg <= 0) return false;
  if (opt.melee) Tut.note('hitMelee'); else Tut.note('shot');
  // Манекен — це вимірювач шкоди, а не ворог: він рахує влучання й не
  // гине навіть від найсильнішого удару, інакше тренування закінчується
  // після першого ж пострілу з дробовика.
  if (e.dummy) {
    rangeHit(dmg);
    if (e.dummy === 'target') {
      e.hp = Math.max(1, e.hp - dmg); e.flash = 0.12;
      Sfx.hitEnemy();
      burst(e.x + e.w / 2, e.y + e.h / 2, 4, '#ffd23f', 110, 0.25, 60, 1);
      return true;
    }
    return false;                                  // манекен-стрілець невразливий
  }
  // Чит-множник накладається поверх: базові числа зброї не міняються.
  if (DEV_MODE) dmg = CH.oneShot ? 1e6 : dmg * CH.dmgK;
  // Щитоносець: фронтальний щит тримає все, крім зарядженого пострілу й ударів у спину.
  if (e.t === 'shield' && !opt.pierce && !opt.shock && !e.open) {
    const fromFront = ((P.x + P.w / 2) - (e.x + e.w / 2)) * e.face > 0;
    const srcFront = opt.srcX !== undefined ? (opt.srcX - (e.x + e.w / 2)) * e.face > 0 : fromFront;
    if (srcFront) {
      Sfx.blocked();
      burst(e.x + e.w / 2 + e.face * 8, e.y + 6, 5, '#22e0ff', 90, 0.2, 0, 1);
      return false;
    }
  }
  // Клинковий адепт паріює ближній бій, поки не зламана серія.
  if (e.t === 'adept' && opt.melee && e.parryCd <= 0 && e.stagger <= 0 && e.stun <= 0) {
    e.guard++; e.guardT = 1.2; e.parryCd = 0.5;
    Sfx.blocked();
    burst(e.x + e.w / 2, e.y + 6, 6, '#22e0ff', 110, 0.25, 0, 1);
    P.vx = -P.face * S(90);
    if (e.guard >= 3) { e.stagger = 1.4; e.guard = 0; e.st = 'stagger'; e.tm = 1.4; }
    return false;
  }
  if (e.warded > 0 && !opt.pierce) dmg *= 0.4;      // щит настінного вузла
  e.hp -= dmg;
  e.flash = 0.12;
  e.alert = 3;
  if (e.alertSt === 'calm' || e.alertSt === 'suspect') { e.alertSt = 'fight'; e.react = 0.15; }
  if (kb) e.vx = kb;
  if (opt.stun) e.stun = Math.max(e.stun, opt.stun);
  if (opt.blast) e.gib = 1;                         // впритул із дробовика — на уламки
  if (opt.melee) { bladeCharge(1); hitStop(0.045); cam.hit(1.6); buzz(10); }
  Sfx.hitEnemy();
  const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
  burst(cx, cy, opt.melee ? 7 : 4, '#ffd23f', 130, 0.3, 120, 1);
  if (e.hp <= 0) killEnemy(e);
  return true;
}

function kamiBoom(e) {
  const R = S(e.elite ? 40 : 32);
  const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
  Sfx.explode(); cam.hit(5); buzz(24);
  ring(cx, cy, 4, R, 0.4, '#ff6b3d', 3);
  burst(cx, cy, 22, '#ffd23f', 210, 0.55, 180, 2);
  if (dist2(cx, cy, P.x + P.w / 2, P.y + P.h / 2) < R * R) playerHurt(2, cx);
  for (let i = 0; i < ENEM.length; i++) {
    const o = ENEM[i];
    if (o === e || o.dead) continue;
    if (dist2(cx, cy, o.x + o.w / 2, o.y + o.h / 2) < R * R) damageEnemy(o, 10, sign(o.x - cx) * S(90), {});
  }
}

// Фізика «наземного» ворога.
function groundPhys(e, dt) {
  e.vy += PH.GRAV * dt;
  if (e.vy > PH.MAXFALL) e.vy = PH.MAXFALL;
  if (moveX(e, e.vx * dt)) { e.vx = 0; e.hitWall = true; } else e.hitWall = false;
  const pb = e.y + e.h;
  const r = moveY(e, e.vy * dt, true);
  if (r === 1) { e.onGround = true; e.vy = 0; }
  else {
    if (r === -1) e.vy = 0;
    e.onGround = false;
    const m = (e.vy > 0) ? landOnMP(e, pb) : null;
    if (m) { e.onGround = true; e.vy = 0; }
  }
  if (e.y > world.ph + Si(40)) e.dead = true;      // випав із карти
}
const eSeesPlayer = (e, r) => dist2(e.x + e.w / 2, e.y + e.h / 2, P.x + P.w / 2, P.y + P.h / 2) < r * r;
const toPlayer = e => sign((P.x + P.w / 2) - (e.x + e.w / 2)) || 1;

/* ---- 1. Скребок: повзе, падає з платформ, слабкий ---- */
function aiSkreb(e, dt) {
  if (e.st === 'idle') { e.st = 'crawl'; e.face = -1; }
  e.vx = e.face * e.sp;
  if (e.hitWall) e.face = -e.face;
  if (e.onGround && edgeAhead(e, e.face) && !gapJumpable(e, e.face)) e.face = -e.face;
  if (e.elite) {
    e.tm -= dt;
    if (e.tm <= 0 && eSeesPlayer(e, S(130)) && Math.abs((P.y + P.h) - (e.y + e.h)) < Si(26)) {
      e.tm = 2.4;
      const d = toPlayer(e); e.face = d;
      shoot(e.x + e.w / 2 + d * Si(6), e.y + Si(3), d * S(105), -S(20),
            { own: 'e', dmg: 1, col: '#8cff5a', w: 5, h: 5, grav: 130, life: 2.5 });
    }
  }
  groundPhys(e, dt);
}

/* ---- 2. Хуліган: біжить на гравця, замахується 0.4 с ---- */
function aiThug(e, dt) {
  const canSee = e.blind ? (P.noise > 0 && eSeesPlayer(e, S(200))) || eSeesPlayer(e, S(34))
                         : eSeesPlayer(e, S(165));
  if (e.st === 'idle' || e.st === 'walk') {
    e.st = 'walk';
    e.vx = e.face * e.sp * 0.42;
    if (e.hitWall) e.face = -e.face;
    e.tm -= dt;
    if (e.tm <= 0) { e.tm = rnd(1.4, 3); if (!canSee) e.face = -e.face; }
    if (canSee) { e.st = 'chase'; e.tm = 3.5; }
  } else if (e.st === 'chase') {
    // фланг: другий ворог заходить з іншого боку, а не стає в чергу
    const goal = P.x + P.w / 2 + (e.flank ? e.flank * Si(26) : 0) + (e.keepAway ? -sign(P.x - e.x) * Si(40) : 0);
    walkTo(e, goal, e.sp);
    e.tm -= dt;
    if (e.canAtk && takeToken(e) &&
        Math.abs((P.x + P.w / 2) - (e.x + e.w / 2)) < Si(22) && Math.abs(P.y - e.y) < Si(20)) {
      e.st = 'wind'; e.tm = 0.4; e.vx = 0; e.swings = e.elite ? 2 : 1;
    } else if (e.tm <= 0 && !canSee) { e.st = 'walk'; e.tm = 1.5; dropToken(e); }
  } else if (e.st === 'wind' || e.st === 'wind2') {            // ЗАМАХ — телеграф 0.4 с
    e.vx *= 0.8; e.tm -= dt;
    if (e.tm <= 0) { e.st = 'swing'; e.tm = 0.22; e.hitDone = false; }
  } else if (e.st === 'swing') {
    e.tm -= dt;
    if (!e.hitDone) {
      const bx = e.face > 0 ? e.x + e.w : e.x - Si(18);
      if (boxHit(bx, e.y + Si(1), Si(18), Si(13), P.x, P.y, P.w, P.h)) { e.hitDone = playerHurt(e.dmg, e.x + e.w / 2); }
    }
    if (e.tm <= 0) {
      e.swings = (e.swings || 1) - 1;
      if (e.swings > 0) { e.st = 'wind2'; e.tm = 0.32; }
      else { e.st = 'rest'; e.tm = 0.55; }
    }
  } else if (e.st === 'rest') {
    e.vx *= 0.7; e.tm -= dt;
    if (e.tm <= 0) { e.st = 'chase'; dropToken(e); }
  }
  groundPhys(e, dt);
}

/* ---- 3. Турель: черга з 3 пострілів і пауза для парирування ---- */
function aiTurret(e, dt) {
  e.vx = 0;
  const seeR = S(e.elite ? 260 : 215);
  if (e.st === 'idle') {
    e.tm -= dt;
    if (e.canAtk && eSeesPlayer(e, seeR) && Math.abs((P.y + P.h / 2) - (e.y + e.h / 2)) < Si(46) && e.tm <= 0) {
      e.st = 'aim'; e.tm = 0.5; e.face = toPlayer(e);
    }
  } else if (e.st === 'aim') {
    e.tm -= dt;
    if (e.tm <= 0) { e.st = 'fire'; e.tm = 0; e.shots = e.elite ? 5 : 3; }
  } else if (e.st === 'fire') {
    e.tm -= dt;
    if (e.tm <= 0 && !mayShoot(e)) e.tm = 0.2;
    else if (e.tm <= 0) {
      e.shots--;
      const sx = e.x + e.w / 2 + e.face * 8, sy = e.y + e.h / 2 - 1;
      let vy = 0;
      if (e.elite || DIFF.mobTrait) vy = clamp(((P.y + P.h / 2) - sy) * 0.55, -S(60), S(60));
      // МАКСИМАЛЬНИЙ: стрілець бере упередження — цілиться не туди, де
      // героїня є, а туди, де вона буде за час польоту кулі.
      let lead = 0;
      if (DIFF.mobTrait) {
        const t = Math.abs((P.x + P.w / 2) - sx) / S(128);
        lead = clamp(P.vx * t * 0.55, -S(70), S(70));
        vy = clamp(vy + P.vy * t * 0.25, -S(90), S(90));
      }
      shoot(sx, sy, e.face * S(128) + lead, vy, { own: 'e', dmg: 1, col: '#ff6b3d', w: 6, h: 4, life: 3 });
      Sfx.shoot();
      e.tm = 0.18;
      if (e.shots <= 0) { e.st = 'rest'; e.tm = 1.25; }
    }
  } else if (e.st === 'rest') {
    e.tm -= dt;
    if (e.tm <= 0) { e.st = 'idle'; e.tm = 0.2; }
  }
}

/* ---- 4. Дрон-оса: синусоїда + пікірування ---- */
function aiWasp(e, dt) {
  e.anim += dt;
  if (e.st === 'idle' || e.st === 'fly') {
    e.st = 'fly';
    // У зв'язці одна оса заходить спереду, друга — ззаду: вони тримають
    // свій бік від гравця, а не збиваються обидві в одну точку.
    const d = e.pairSide
      ? (((P.x + P.w / 2) + e.pairSide * Si(46) > e.x + e.w / 2) ? 1 : -1)
      : toPlayer(e);
    e.face = d;
    e.vx = lerp(e.vx, d * e.sp * (eSeesPlayer(e, S(220)) ? 1 : 0.5), dt * 2);
    e.y = e.hy + Si(2) + Math.sin(e.anim * 3.1) * Si(12);
    e.x += e.vx * dt;
    if (rectSolid(e.x, e.y, e.w, e.h)) { e.x -= e.vx * dt; e.vx = -e.vx; e.hx = e.x; }
    e.tm -= dt;
    if (eSeesPlayer(e, S(135)) && P.y > e.y && e.tm <= 0) {
      e.st = 'tele'; e.tm = 0.35; e.tx = P.x + P.w / 2; e.ty = P.y + P.h / 2;
    }
  } else if (e.st === 'tele') {                       // телеграф пікірування
    e.tm -= dt; e.vx *= 0.85; e.x += e.vx * dt;
    if (e.tm <= 0) {
      e.st = 'dive';
      const dx = e.tx - (e.x + e.w / 2), dy = e.ty - (e.y + e.h / 2);
      const L = Math.max(1, Math.hypot(dx, dy));
      e.vx = dx / L * S(240); e.vy = dy / L * S(240);
      e.tm = 0.75;
      if (e.elite) shoot(e.x + e.w / 2, e.y + e.h, e.vx * 0.5, S(120),
                         { own: 'e', dmg: 1, col: '#ffd23f', w: 5, h: 5, life: 2 });
    }
  } else if (e.st === 'dive') {
    e.tm -= dt;
    e.x += e.vx * dt; e.y += e.vy * dt;
    if (e.tm <= 0 || rectSolid(e.x, e.y, e.w, e.h)) {
      if (rectSolid(e.x, e.y, e.w, e.h)) { e.x -= e.vx * dt; e.y -= e.vy * dt; }
        e.st = 'back'; e.tm = 1.0; e.vx *= -0.2; e.vy = -S(70);
    }
  } else if (e.st === 'back') {
    e.tm -= dt;
    e.y += e.vy * dt; e.x += e.vx * dt;
    if (e.y <= e.hy + 2 || e.tm <= 0) { e.st = 'fly'; e.vy = 0; e.hy = Math.min(e.hy, e.y); e.tm = 1.4; }
  }
  e.x = clamp(e.x, 4, world.pw - e.w - 4);
  e.y = clamp(e.y, 4, world.ph - e.h - 4);
}

/* ---- 5. Камікадзе: летить і вибухає ---- */
function aiKami(e, dt) {
  e.anim += dt;
  if (e.st === 'idle') {
    e.vx *= 0.9; e.vy = lerp(e.vy, Math.sin(e.anim * 2) * S(20), dt * 2);
    e.x += e.vx * dt; e.y += e.vy * dt;
    const busy = P.atkT > 0 || P.lock || P.reloadT > 0 || !P.onGround;
    if (e.canAtk && (busy || e.anim > 6)) e.st = 'seek';
    return;
  }
  if (e.st === 'seek') {
    const dx = (P.x + P.w / 2) - (e.x + e.w / 2), dy = (P.y + P.h / 2) - (e.y + e.h / 2);
    const L = Math.max(1, Math.hypot(dx, dy));
    const sp = e.sp;
    e.vx = lerp(e.vx, dx / L * sp, dt * 2.2);
    e.vy = lerp(e.vy, dy / L * sp, dt * 2.2);
    e.face = sign(e.vx) || e.face;
    const nx = e.x + e.vx * dt, ny = e.y + e.vy * dt;
    if (rectSolid(nx, e.y, e.w, e.h)) e.vx = -e.vx * 0.4; else e.x = nx;
    if (rectSolid(e.x, ny, e.w, e.h)) e.vy = -e.vy * 0.4; else e.y = ny;
    if (L < Si(26)) { e.st = 'beep'; e.tm = 0.36; }
    if (e.anim > 14) { e.st = 'beep'; e.tm = 0.36; }      // не літає вічно
  } else if (e.st === 'beep') {
    e.tm -= dt;
    e.vx *= 0.9; e.vy *= 0.9;
    e.x += e.vx * dt; e.y += e.vy * dt;
    if (e.tm <= 0) { kamiBoom(e); e.dead = true; }
  }
  e.y = clamp(e.y, 4, world.ph - e.h - 4);
}

/* ---- 6. Щитоносець: фронтальний щит ---- */
function aiShield(e, dt) {
  if (e.st === 'idle') { e.st = 'walk'; e.tm = 0; }
  if (e.st === 'walk') {
    if (eSeesPlayer(e, S(200))) e.face = toPlayer(e);
    e.vx = e.face * e.sp;
    if (e.hitWall) e.face = -e.face;
    if (e.canAtk && takeToken(e) &&
        Math.abs((P.x + P.w / 2) - (e.x + e.w / 2)) < Si(26) && Math.abs(P.y - e.y) < Si(22)) {
      e.st = 'wind'; e.tm = 0.5; e.vx = 0;
    }
  } else if (e.st === 'wind') {
    e.tm -= dt; e.vx = 0;
      if (e.tm <= 0) { e.st = 'bash'; e.tm = 0.3; e.hitDone = false; e.vx = e.face * S(e.elite ? 150 : 90); }
  } else if (e.st === 'bash') {
    e.tm -= dt;
    if (!e.hitDone) {
      const bx = e.face > 0 ? e.x + e.w - Si(2) : e.x - Si(14);
      if (boxHit(bx, e.y + Si(2), Si(16), Si(14), P.x, P.y, P.w, P.h)) e.hitDone = playerHurt(e.dmg, e.x + e.w / 2);
    }
    if (e.tm <= 0) { e.st = 'rest'; e.tm = 0.7; }
  } else if (e.st === 'rest') {
    e.vx *= 0.8; e.tm -= dt;
    e.open = 1;                                      // 0,7 с відкритий після власного удару
    if (e.tm <= 0) { e.st = 'walk'; e.open = 0; dropToken(e); }
  }
  if (e.st !== 'rest') e.open = 0;
  groundPhys(e, dt);
}

/* ---- 7. Клинковий адепт: паріює удари, ламається серією ---- */
function aiAdept(e, dt) {
  if (e.parryCd > 0) e.parryCd -= dt;
  if (e.guardT > 0) { e.guardT -= dt; if (e.guardT <= 0) e.guard = 0; }
  if (e.stagger > 0) e.stagger -= dt;
  if (e.st === 'stagger') {
    e.vx *= 0.85; e.tm -= dt;
    if (e.tm <= 0) e.st = 'idle';
    groundPhys(e, dt); return;
  }
  if (e.st === 'idle') {
    e.vx *= 0.85; e.tm -= dt;
    if (eSeesPlayer(e, S(170))) {
      e.face = toPlayer(e);
      const dx = Math.abs((P.x + P.w / 2) - (e.x + e.w / 2));
      if (e.elite && dx > Si(60) && e.tm <= 0) {
        e.st = 'throw'; e.tm = 0.45;
      } else if (e.tm <= 0) { e.st = 'wind'; e.tm = 0.42; }
    }
  } else if (e.st === 'throw') {
    e.tm -= dt; e.vx = 0;
    if (e.tm <= 0) {
      const d = toPlayer(e); e.face = d;
      shoot(e.x + e.w / 2 + d * Si(7), e.y + Si(6), d * S(140), 0,
            { own: 'e', dmg: 1, col: '#e0f7ff', w: 6, h: 6, life: 2.4, kind: 2 });
      Sfx.shoot();
      e.st = 'idle'; e.tm = 1.1;
    }
  } else if (e.st === 'wind') {                    // телеграф випаду
    e.tm -= dt; e.vx *= 0.8;
    if (e.tm <= 0) {
      e.st = 'lunge'; e.tm = 0.28; e.hitDone = false;
      e.vx = e.face * S(210);
    }
  } else if (e.st === 'lunge') {
    e.tm -= dt;
    if (!e.hitDone) {
      const bx = e.face > 0 ? e.x + e.w - Si(4) : e.x - Si(16);
      if (boxHit(bx, e.y + Si(2), Si(20), Si(13), P.x, P.y, P.w, P.h)) e.hitDone = playerHurt(e.dmg, e.x + e.w / 2);
    }
    if (e.tm <= 0) { e.st = 'idle'; e.tm = e.elite ? 0.55 : 0.8; e.vx *= 0.3; }
  }
  groundPhys(e, dt);
}

/* ---- 8. Фантом: телепорт + повтор рухів гравця із затримкою 1 с ---- */
function aiPhantom(e, dt) {
  e.anim += dt;
  const idx = Math.min(TRAIL.length - 1, 60);
  const t = TRAIL.length ? TRAIL[idx] : { x: P.x, y: P.y };
  const tx = clamp(t.x + e.ofs, 4, world.pw - e.w - 4), ty = t.y;
  const dx = tx - e.x, dy = ty - e.y;
  if (Math.hypot(dx, dy) > Si(150) || e.tm2 > 3.4) {        // телепорт
    e.tm2 = 0;
    burst(e.x + e.w / 2, e.y + e.h / 2, 10, '#6ef7d8', 110, 0.35, 0, 1);
    if (!rectSolid(tx, ty, e.w, e.h)) { e.x = tx; e.y = ty; }
    burst(e.x + e.w / 2, e.y + e.h / 2, 10, '#6ef7d8', 110, 0.35, 0, 1);
  } else {
    e.tm2 += dt;
    const nx = e.x + clamp(dx, -e.sp * dt * 2.4, e.sp * dt * 2.4);
    const ny = e.y + clamp(dy, -e.sp * dt * 2.4, e.sp * dt * 2.4);
    if (!rectSolid(nx, e.y, e.w, e.h)) e.x = nx;
    if (!rectSolid(e.x, ny, e.w, e.h)) e.y = ny;
  }
  e.face = sign(P.x - e.x) || e.face;
  e.tm -= dt;
  if (e.tm <= 0 && eSeesPlayer(e, S(190)) && mayShoot(e)) {
    e.tm = e.elite ? 1.5 : 2.3;
    const d = toPlayer(e);
    shoot(e.x + e.w / 2 + d * Si(7), e.y + Si(7), d * S(120), 0,
          { own: 'e', dmg: 1, col: '#6ef7d8', w: 5, h: 5, life: 2.4 });
    if (e.elite) shoot(e.x + e.w / 2 + d * Si(7), e.y + Si(7), d * S(120), -S(55),
                       { own: 'e', dmg: 1, col: '#6ef7d8', w: 5, h: 5, life: 2.4 });
    Sfx.shoot();
  }
}

/* ---- 9. Павук: висить на стелі, падає на гравця ---- */
function aiSpider(e, dt) {
  if (e.st === 'hang') {
    e.vy = 0;
    e.anim += dt;
    if (Math.abs((P.x + P.w / 2) - (e.x + e.w / 2)) < Si(30) && P.y > e.y) {
      e.st = 'drop'; e.tm = 0.28;
    } else if (e.elite) {
      e.tm -= dt;
      if (e.tm <= 0 && eSeesPlayer(e, S(150))) {
        e.tm = 2.2;
        shoot(e.x + e.w / 2, e.y + e.h, 0, S(130), { own: 'e', dmg: 1, col: '#c98cff', w: 5, h: 5, life: 2.2 });
      }
    }
    return;                                   // висить нерухомо, гравітація не діє
  } else if (e.st === 'drop') {
    e.tm -= dt;
      if (e.tm <= 0) { e.st = 'crawl'; e.vy = S(80); }
  } else {
    if (e.onGround) {
      e.face = eSeesPlayer(e, S(190)) ? toPlayer(e) : e.face;
      e.vx = e.face * e.sp;
      if (e.hitWall) e.face = -e.face;
    }
    groundPhys(e, dt);
    return;
  }
  groundPhys(e, dt);
}


/* ---- 10. Тарано-бот: розганяється й глушиться об стіну (вчить Сервотавра) ---- */
function aiRammer(e, dt) {
  switch (e.st) {
    case 'idle': case '':
      walkTo(e, e.alertSt === 'fight' ? P.x : e.hx, e.sp * 0.6);
      e.tm -= dt;
      if (e.canAtk && takeToken(e) && Math.abs(P.x - e.x) < Si(150) && Math.abs(P.y - e.y) < Si(24) && e.tm <= 0) {
        e.st = 'wind'; e.tm = 0.5; e.face = toPlayer(e);
      }
      break;
    case 'wind':                                     // ТЕЛЕГРАФ 0,5 с
      e.vx *= 0.7; e.tm -= dt;
      if (Math.random() < 0.5)
        part(e.x + (e.face > 0 ? e.w : 0), e.y + e.h - 2, -e.face * rnd(30, 90), rnd(-40, 0), 0.3, '#ff6b3d', 1, 200, 1);
      if (e.tm <= 0) { e.st = 'ram'; e.tm = 1.6; e.vx = e.face * S(240); Sfx.dash(); }
      break;
    case 'ram':
      e.tm -= dt;
      e.vx = e.face * S(240);
      if (e.hitWall || e.tm <= 0 || (e.onGround && edgeAhead(e, e.face) && !gapJumpable(e, e.face))) {
        e.st = 'stun2'; e.tm = 1.5; e.vx = 0; e.stun = 0;
        cam.hit(3); Sfx.explode(); dropToken(e);
        burst(e.x + e.w / 2, e.y + e.h / 2, 10, '#ffd23f', 150, 0.5, 200, 2);
      }
      break;
    case 'stun2':                                    // ВІКНО ШКОДИ
      e.vx *= 0.8; e.tm -= dt;
      if (Math.random() < 0.25)
        part(e.x + rnd(0, e.w), e.y, rnd(-20, 20), -30, 0.4, '#22e0ff', 1, -10, 1);
      if (e.tm <= 0) { e.st = 'idle'; e.tm = 1.2; }
      break;
  }
  groundPhys(e, dt);
}
/* ---- 11. Ковадло: удар об землю з низькою хвилею (вчить Сервотавра) ---- */
function aiAnvil(e, dt) {
  switch (e.st) {
    case 'idle': case '':
      walkTo(e, e.alertSt === 'fight' ? P.x : e.hx, e.sp);
      e.tm -= dt;
      if (e.canAtk && takeToken(e) && Math.abs(P.x - e.x) < Si(90) && e.tm <= 0) { e.st = 'wind'; e.tm = 0.55; }
      break;
    case 'wind':                                     // ТЕЛЕГРАФ: присідає
      e.vx = 0; e.tm -= dt;
      if (e.tm <= 0) { e.st = 'slam'; e.tm = 0.25; }
      break;
    case 'slam':
      e.vx = 0; e.tm -= dt;
      if (e.tm <= 0) {
        e.st = 'rest'; e.tm = 1.1; dropToken(e);
        cam.hit(4); Sfx.explode(); buzz(16);
        for (const d of [-1, 1])
          shoot(e.x + e.w / 2, e.y + e.h - Si(8), d * S(140), 0,
            { own: 'e', dmg: 1, col: '#ffd23f', w: 10, h: 12, life: 2.2, kind: 3 });
        for (let i = 0; i < 10; i++)
          part(e.x + rnd(0, e.w), e.y + e.h, rnd(-120, 120), rnd(-90, -20), rnd(0.3, 0.6), '#ffd23f', 2, 240, 1);
      }
      break;
    case 'rest':
      e.vx *= 0.8; e.tm -= dt;
      if (e.tm <= 0) e.st = 'idle';
      break;
  }
  groundPhys(e, dt);
}
/* ---- 12. Дрон-носій: спавнить малих; убий носія — малі гинуть ---- */
function aiCarrier(e, dt) {
  e.anim += dt;
  e.y = e.hy + 2 + Math.sin(e.anim * 1.6) * 8;
  const d = e.alertSt === 'fight' ? toPlayer(e) : (e.hitWall ? -e.face : e.face);
  e.face = d;
  e.vx = lerp(e.vx, d * e.sp * (e.alertSt === 'fight' ? 1 : 0.4), dt * 2);
  const nx = e.x + e.vx * dt;
  if (!rectSolid(nx, e.y, e.w, e.h)) e.x = nx; else e.vx = -e.vx;
  e.tm -= dt;
  if (e.tm <= 0 && e.canAtk && e.kids < 2) {
    e.tm = 4;
    const k = spawnEnemy('wasp', e.x + e.w / 2 - 6, e.y + e.h, false);
    if (k) { k.parent = e; k.hy = e.y + Si(20); e.kids++; Sfx.shoot(); }
  }
  e.x = clamp(e.x, 4, world.pw - e.w - 4);
}
/* ---- 13. Настінний вузол: тримає щит на сусідах (вчить Матку-Рій) ---- */
function aiPylon(e, dt) {
  e.vx = 0; e.anim += dt;
  let n = 0;
  for (let i = 0; i < ENEM.length; i++) {
    const o = ENEM[i];
    if (o === e || o.dead || o.t === 'pylon') continue;
    if (dist2(e.x, e.y, o.x, o.y) < Si(90) * Si(90)) { o.warded = 0.2; n++; }
  }
  e.wards = n;
  if (Math.random() < 0.1)
    part(e.x + rnd(0, e.w), e.y + rnd(0, e.h), rnd(-15, 15), rnd(-25, 0), 0.4, '#22e0ff', 1, -20, 1);
}
/* ---- 14. Блінк-щур: телепорт за спину (вчить Хроноклинка) ---- */
function aiBlinker(e, dt) {
  switch (e.st) {
    case 'idle': case '':
      walkTo(e, e.alertSt === 'fight' ? P.x - sign(P.x - e.x) * Si(30) : e.hx, e.sp * 0.7);
      e.tm -= dt;
      if (e.canAtk && takeToken(e) && e.tm <= 0 && Math.abs(P.x - e.x) < Si(170)) {
        e.st = 'blink'; e.tm = 0.35;
        e.tx = clamp(P.x - P.face * Si(22), Si(6), world.pw - e.w - Si(6));
        e.ty = P.y + P.h - e.h;
      }
      break;
    case 'blink':                                    // ТЕЛЕГРАФ: привид у точці появи
      e.vx *= 0.8; e.tm -= dt;
      if (Math.random() < 0.6)
        part(e.tx + rnd(0, e.w), e.ty + rnd(0, e.h), 0, -20, 0.3, '#6ef7d8', 1, 0, 1);
      if (e.tm <= 0) {
        burst(e.x + e.w / 2, e.y + e.h / 2, 8, '#6ef7d8', 110, 0.3, 0, 1);
        if (!rectSolid(e.tx, e.ty, e.w, e.h)) { e.x = e.tx; e.y = e.ty; }
        burst(e.x + e.w / 2, e.y + e.h / 2, 8, '#6ef7d8', 110, 0.3, 0, 1);
        e.st = 'bite'; e.tm = 0.28; e.hitDone = false;
        e.face = toPlayer(e);
      }
      break;
    case 'bite':
    e.tm -= dt; e.vx = e.face * S(90);
      if (!e.hitDone && boxHit(e.x - 2, e.y, e.w + 4, e.h, P.x, P.y, P.w, P.h))
        e.hitDone = playerHurt(e.dmg, e.x + e.w / 2);
      if (e.tm <= 0) { e.st = 'idle'; e.tm = 2.2; dropToken(e); }
      break;
  }
  groundPhys(e, dt);
}
/* ---- 15. Тайл-хробак: з'їдає платформу під гравцем (вчить Гліч-Ядро) ---- */
function aiWorm(e, dt) {
  walkTo(e, e.alertSt === 'fight' ? P.x : e.hx, e.sp);
  e.tm -= dt;
  if (e.canAtk && e.tm <= 0 && Math.abs(P.x - e.x) < Si(130)) {
    e.tm = 3.2;
    const tx = Math.floor((P.x + P.w / 2) / TS), ty = Math.floor((P.y + P.h + 3) / TS);
    if (tAt(tx, ty) === T_PLAT) {                    // тільки тонкі платформи, не підлогу
      const idx = ty * world.tw + tx;
      world.tiles[idx] = T_EMPTY;
      world.eaten.push({ i: idx, t: 6, code: T_PLAT });
      Sfx.blocked(); cam.hit(2);
      for (let i = 0; i < 8; i++)
        part(tx * TS + rnd(0, TS), ty * TS, rnd(-60, 60), rnd(-60, 0), 0.4, '#c98cff', 2, 200, 1);
    }
  }
  groundPhys(e, dt);
}
/* ---- 16-18. Конструкти-архіви: по одній ослабленій атаці кожного боса ---- */
function aiArch(e, dt) {
  const kind = e.t;                                  // arch1 таран, arch2 бомба, arch3 випад
  switch (e.st) {
    case 'idle': case '':
      walkTo(e, e.alertSt === 'fight' ? P.x - sign(P.x - e.x) * Si(kind === 'arch2' ? 90 : 20) : e.hx, e.sp * 0.7);
      e.tm -= dt;
      if (e.canAtk && takeToken(e) && e.tm <= 0) {
        e.st = 'wind'; e.tm = kind === 'arch3' ? 0.42 : 0.5; e.face = toPlayer(e);
      }
      break;
    case 'wind':
      e.vx *= 0.7; e.tm -= dt;
      if (e.tm <= 0) {
        if (kind === 'arch1') { e.st = 'ram'; e.tm = 1.1; e.vx = e.face * S(210); Sfx.dash(); }
        else if (kind === 'arch2') {
          e.st = 'idle'; e.tm = 2.4; dropToken(e);
          if (mayShoot(e)) {
            const dx = (P.x + P.w / 2) - (e.x + e.w / 2);
            shoot(e.x + e.w / 2, e.y + Si(4), clamp(dx * 0.8, -S(150), S(150)), -S(60),
              { own: 'e', dmg: 1, col: '#ff6b3d', w: 7, h: 7, life: 3, grav: 300, kind: 4 });
            Sfx.shoot();
          }
        } else { e.st = 'lunge'; e.tm = 0.3; e.hitDone = false; e.vx = e.face * S(220); Sfx.slash(1); }
      }
      break;
    case 'ram':
      e.tm -= dt; e.vx = e.face * S(210);
      if (boxHit(e.x, e.y, e.w, e.h, P.x, P.y, P.w, P.h)) playerHurt(1, e.x + e.w / 2);
      if (e.hitWall || e.tm <= 0) { e.st = 'rest'; e.tm = 1.1; e.vx = 0; dropToken(e); cam.hit(2); }
      break;
    case 'lunge': {
      e.tm -= dt;
      const bx = e.face > 0 ? e.x + e.w - Si(4) : e.x - Si(16);
      if (!e.hitDone && boxHit(bx, e.y + Si(2), Si(20), Si(16), P.x - Si(6), P.y - Si(4), P.w + Si(12), P.h + Si(8))) {
        if (P.parryT > 0) {                          // випад можна парирувати
          e.hitDone = true; e.stun = 1.3; e.st = 'rest'; e.tm = 1.3;
          Sfx.parry(); cam.hit(3); hitStop(0.07); bladeCharge(1); dropToken(e);
        } else if (boxHit(bx, e.y + Si(2), Si(20), Si(16), P.x, P.y, P.w, P.h)) {
          e.hitDone = playerHurt(e.dmg, e.x + e.w / 2);
        }
      }
      if (e.tm <= 0) { e.st = 'rest'; e.tm = 0.8; e.vx *= 0.3; dropToken(e); }
      break;
    }
    case 'rest':
      e.vx *= 0.8; e.tm -= dt;
      if (e.tm <= 0) e.st = 'idle';
      break;
  }
  groundPhys(e, dt);
}
/* ---- перехоплений Гліч-Кодом: б'ється за гравця ---- */
function aiCharmed(e, dt) {
  e.charm -= dt;
  if (e.charm <= 0) {
    burst(e.x + e.w / 2, e.y + e.h / 2, 12, '#00ffcc', 130, 0.5, 60, 2);
    e.dead = true; return;
  }
  let best = null, bd = 1e9;
  for (let i = 0; i < ENEM.length; i++) {
    const o = ENEM[i];
    if (o === e || o.dead || o.charm > 0) continue;
    const d = dist2(e.x, e.y, o.x, o.y);
    if (d < bd) { bd = d; best = o; }
  }
  if (best) {
    if (ETYPE[e.t].fly) {
      const dx = best.x - e.x, dy = best.y - e.y, L = Math.max(1, Math.hypot(dx, dy));
      e.x += dx / L * S(70) * dt; e.y += dy / L * S(70) * dt;
    } else walkTo(e, best.x + best.w / 2, e.sp);
    if (aabb(e, best)) damageEnemy(best, 12 * dt, 0, {});
  } else if (!ETYPE[e.t].fly) e.vx *= 0.8;
  if (!ETYPE[e.t].fly) groundPhys(e, dt);
  if (Math.random() < 0.3)
    part(e.x + rnd(0, e.w), e.y + rnd(0, e.h), rnd(-20, 20), rnd(-20, 20), 0.3, '#00ffcc', 1, 0, 1);
}
/* ---- кинутий Тавром ворог летить і б'є інших ---- */
function updateThrown(e, dt) {
  e.thrown -= dt;
  e.vy += PH.GRAV * dt;
  const hit = moveX(e, e.vx * dt);
  const land = moveY(e, e.vy * dt, false);
  if (hit || land) { e.thrown = 0; damageEnemy(e, 7.5, 0, {}); }
  for (let i = 0; i < ENEM.length; i++) {
    const o = ENEM[i];
    if (o === e || o.dead) continue;
    if (aabb(e, o)) { damageEnemy(o, 10, sign(e.vx) * S(120), {}); e.thrown = 0; damageEnemy(e, 7.5, 0, {}); break; }
  }
  if (e.thrown <= 0) e.vx *= 0.2;
}

const AI = { skreb: aiSkreb, thug: aiThug, turret: aiTurret, wasp: aiWasp, kami: aiKami,
             shield: aiShield, adept: aiAdept, phantom: aiPhantom, spider: aiSpider,
             rammer: aiRammer, anvil: aiAnvil, carrier: aiCarrier, pylon: aiPylon,
             blinker: aiBlinker, worm: aiWorm, arch1: aiArch, arch2: aiArch, arch3: aiArch };

function updateEnemies(dt) {
  // слід гравця для фантомів
  TRAIL.unshift({ x: P.x, y: P.y });
  if (TRAIL.length > TRAIL_MAX) TRAIL.pop();

  const viewC = cam.x + view.w / 2;
  for (let i = ENEM.length - 1; i >= 0; i--) {
    const e = ENEM[i];
    if (e.dead) {
      dropToken(e);
      if (e.parent) e.parent.kids = Math.max(0, e.parent.kids - 1);
      if (e.t === 'carrier') for (let j = 0; j < ENEM.length; j++)   // носій гине — малі теж
        if (ENEM[j].parent === e) ENEM[j].dead = true;
      ENEM[i] = ENEM[ENEM.length - 1]; ENEM.pop(); continue;
    }
    if (e.flash > 0) e.flash -= dt;
    if (e.warded > 0) e.warded -= dt;
    if (Math.abs((e.x + e.w / 2) - viewC) > Si(360)) { e.wasOff = 1; continue; }
    if (e.wasOff) { e.wasOff = 0; e.grace = 0.5; }   // 0,5 с без атаки після появи на екрані
    // Манекени (навчання й тренувальна кімната) живуть за своїми
    // правилами: не ходять, не переслідують, контактом не б'ють.
    if (e.dummy) { dummyUpdate(e, dt); continue; }
    if (e.charm > 0) { aiCharmed(e, dt); continue; }
    if (e.thrown > 0) { updateThrown(e, dt); continue; }
    if (e.stun > 0) {
      e.stun -= dt;
      e.vx *= 0.85;
      if (!ETYPE[e.t].fly) groundPhys(e, dt);
      continue;
    }
    aiCommon(e, dt);
    const fn = AI[e.t];
    if (fn) fn(e, dt);
    // контактна шкода
    if (!e.dead && P.inv <= 0 && !P.dead && aabb(P, e)) playerHurt(1, e.x + e.w / 2);
  }
  separate();
}

/* ================================================================
   12. КУЛІ ТА ПРОМЕНІ
   ================================================================ */
/**
 * Ехо-Призма: промінь відбивається від стіни й на кожному відбитті
 * роздвоюється, не втрачаючи шкоди. До п'яти відбиттів на промінь;
 * друга половина пари успадковує решту відбиттів, тож у коридорі
 * заповнює його, а на відкритому місці просто вилітає за екран.
 */
function prismBounce(b) {
  // куди саме впёрлись: пробуємо відкотити по осях і дивимось, що звільняє
  const bx = b.x - b.vx * (1 / 60), by = b.y - b.vy * (1 / 60);
  const hitX = solidAtPx(b.x, by), hitY = solidAtPx(bx, b.y);
  b.x = bx; b.y = by;
  if (hitX || (!hitX && !hitY)) b.vx = -b.vx;
  if (hitY) b.vy = -b.vy;
  b.bounce--;
  b.life = Math.max(b.life, 0.55);
  Sfx.wPrism();
  burst(b.x, b.y, 4, b.col, 90, 0.22, 0, 1);
  ring(b.x, b.y, 2, 14, 0.22, b.col, 2);
  // кут рикошету підсвічено, а лінія «звідки прийшов» лишається в повітрі
  wfx({ k: 'node', x: b.x, y: b.y, t: 0.5,
        a0: Math.atan2(-b.vy, -b.vx), a1: Math.atan2(b.vy, b.vx) });
  if (b.gx !== undefined) wfx({ k: 'grid', x: b.gx, y: b.gy, x2: b.x, y2: b.y, t: 0.85 });
  b.gx = b.x; b.gy = b.y;
  if (b.bounce > 0 && BULL.length < 60) {           // роздвоєння під кутом
    const sp = Math.hypot(b.vx, b.vy) || 1;
    const a = Math.atan2(b.vy, b.vx);
    const spread = 0.5;
    const mk = (ang) => {
      const c = shoot(b.x, b.y, Math.cos(ang) * sp, Math.sin(ang) * sp,
        { own: 'p', dmg: b.dmg, col: b.col, w: b.w, h: b.h, life: b.life, kind: 6 });
      c.bounce = b.bounce;
      c.gx = b.x; c.gy = b.y;
      return c;
    };
    mk(a + spread);
    b.vx = Math.cos(a - spread) * sp; b.vy = Math.sin(a - spread) * sp;
  }
}
/** Падіння шкоди дробини: до NEAR — ніякого, далі лінійно до нуля. */
function shotFalloff(dist) {
  if (dist <= SH.NEAR) return 1;
  return clamp(1 - (dist - SH.NEAR) / (SH.RANGE - SH.NEAR), 0.04, 1);
}
function updateBullets(dt) {
  for (let i = BULL.length - 1; i >= 0; i--) {
    const b = BULL[i];
    b.life -= dt;
    if (b.grav) b.vy += b.grav * dt;
    if (b.home) homeBullet(b, dt);
    if (b.falloff) {
      b.dist = (b.dist || 0) + Math.hypot(b.vx, b.vy) * dt;
      // розкриття конуса: біля ствола дробини йдуть купно, далі розходяться
      if (b.spreadV !== undefined) b.vy = b.spreadV * clamp(b.dist / SH.OPEN, 0, 1);
    }
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.tr) { b.tr.push(b.x, b.y); if (b.tr.length > 24) { b.tr.shift(); b.tr.shift(); } }
    let kill = b.life <= 0;

    if (!kill && solidAtPx(b.x, b.y)) {
      if (b.bounce > 0) prismBounce(b);              // Ехо-Призма: відбити й роздвоїти
      else { kill = true; burst(b.x, b.y, 3, b.col, 60, 0.18, 0, 1); }
    }
    if (!kill && b.own === 'e') {
      tryParry(b);                                   // може змінити власника кулі
    }
    if (!kill && b.own === 'e') {
      if (boxHit(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, P.x, P.y, P.w, P.h)) {
        if (playerHurt(b.dmg, b.x)) kill = true;
      }
    } else if (!kill && b.own === 'p') {
      for (let j = 0; j < ENEM.length && !kill; j++) {
        const e = ENEM[j];
        if (e.dead) continue;
        if (e.charm > 0) continue;
        if (!boxHit(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, e.x, e.y, e.w, e.h)) continue;
        if (b.kind === 5) { glitchHit(e); kill = true; break; }
        let dm = b.dmg;
        if (b.falloff) dm *= shotFalloff(b.dist || 0);
        if (b.home && e.elite) dm *= 0.5;              // «Оса» слабка проти броні
        // Дробовик упритул не «завдає шкоди», а ВІДКИДАЄ: 40 px назад.
        const blast = !!b.falloff && (b.dist || 0) < SH.GIB;
        // Без короткого приголомшення відкидання не видно взагалі: ворог
        // перебиває собі vx власним ШІ вже в наступному кадрі.
        damageEnemy(e, dm, sign(b.vx) * S(blast ? 400 : 40),
                    { srcX: b.x - b.vx * 0.05, blast: blast, stun: blast ? 0.25 : 0 });
        kill = true;
      }
      if (!kill && BOSS.on) {
        const hbs = bossHitBoxes();
        for (let j = 0; j < hbs.length && !kill; j++) {
          const hb = hbs[j];
          if (!boxHit(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, hb.x, hb.y, hb.w, hb.h)) continue;
          if (b.kind === 5) { BOSS.silence = 1.5; Sfx.parry(); ring(BOSS.x + BOSS.w / 2, BOSS.y + BOSS.h / 2, 4, 50, 0.5, '#00ffcc', 2); kill = true; break; }
          let dm = b.dmg;
          if (b.falloff) dm *= shotFalloff(b.dist || 0);
          bossDamage(hb, dm, { srcX: b.x, parried: b.parried });
          kill = true;
        }
      }
    }
    if (kill) { BULL[i] = BULL[BULL.length - 1]; BULL.pop(); }
  }
}
/** Самонаведення «Оси»: доводить кулю до цілі в конусі 40°. */
/* ================================================================
   ЄДИНИЙ СПИСОК ЦІЛЕЙ

   Наведення («Оса», дрони «Рою», сканер) раніше ходило тільки по ENEM.
   Боси живуть в окремому BOSS зі своїми хітбоксами, тож автоприціл їх
   просто НЕ БАЧИВ — саме там, де він потрібен найбільше.

   Тепер усе, у що можна цілитись, описується однаково, і пошук іде по
   одному списку. Ціль — це не «ворог», а коробка з пріоритетом:

     weak   5  відкрита вразлива зона боса (розкрита оболонка, ядро)
     boss   4  сам бос, коли він вразливий
     enemy  3  звичайний ворог
     node   2  генератор Матки / вузол даних Гліч-Ядра
     armor  1  бос під бронею

   Порядок — з ТЗ, з однією поправкою: невразливий бос опускається НИЖЧЕ
   вузлів і ворогів. Інакше «Оса» всаджувала б усю обойму в броню, поки
   поруч стоїть генератор, який і треба збити. Наводитись на нього вона
   все одно вміє — просто в останню чергу, і тоді гравець бачить
   індикатор «броня» й чує глухий звук замість влучання.
   ================================================================ */
const TGT = [];                                     // буфер: нуль алокацій щокадру
function targets() {
  TGT.length = 0;
  if (BOSS.on && BOSS.st !== 'die' && BOSS.intro <= 0) {
    const inv = bossInvulnerable() || BOSS.inv > 0;
    const hbs = bossHitBoxes();
    for (let i = 0; i < hbs.length; i++) {
      const hb = hbs[i];
      if (hb.part) {
        TGT.push({ x: hb.x, y: hb.y, w: hb.w, h: hb.h, kind: 'node', prio: 2,
                   part: hb.part, hb: hb });
      } else {
        // «розкрита оболонка» — це той самий бокс, але бос у ньому вразливий
        const weak = !inv && (BOSS.type === 'glitch' || BOSS.type === 'chrono');
        TGT.push({ x: hb.x, y: hb.y, w: hb.w, h: hb.h,
                   kind: inv ? 'armor' : (weak ? 'weak' : 'boss'),
                   prio: inv ? 1 : (weak ? 5 : 4), boss: true, hb: hb });
      }
    }
  }
  for (let i = 0; i < ENEM.length; i++) {
    const e = ENEM[i];
    if (e.dead || e.charm > 0) continue;
    TGT.push({ x: e.x, y: e.y, w: e.w, h: e.h, kind: 'enemy', prio: 3, e: e });
  }
  return TGT;
}
/** Жива коробка цілі: бос і його частини рухаються, тож читаємо щокадру. */
function tgtBox(t) {
  if (t.e) return t.e;
  if (t.part) return t.part;
  return BOSS;
}
function tgtAlive(t) {
  if (t.e) return !t.e.dead && t.e.charm <= 0;
  if (t.part) return !!t.part.alive;
  return BOSS.on && BOSS.st !== 'die';
}
/**
 * Найкраща ціль у конусі. Спершу за пріоритетом, а вже потім за
 * відстанню — тому відкрита вразлива зона завжди виграє в ворога,
 * що стоїть ближче.
 */
function pickTarget(cx, cy, dirX, dirY, maxD, cone) {
  const list = targets();
  let best = null, bestPrio = -1, bestD = 0;
  const dir = Math.atan2(dirY, dirX);
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    const dx = t.x + t.w / 2 - cx, dy = t.y + t.h / 2 - cy;
    const d = Math.hypot(dx, dy);
    if (d > maxD) continue;
    if (cone > 0) {
      let a = Math.atan2(dy, dx) - dir;
      while (a > Math.PI) a -= Math.PI * 2;
      while (a < -Math.PI) a += Math.PI * 2;
      if (Math.abs(a) > cone) continue;
    }
    if (t.prio > bestPrio || (t.prio === bestPrio && d < bestD)) {
      best = t; bestPrio = t.prio; bestD = d;
    }
  }
  return best;
}

function homeBullet(b, dt) {
  const best = pickTarget(b.x, b.y, b.vx, b.vy, S(160), 0.35);   // конус 40°
  if (!best) return;
  const dx = best.x + best.w / 2 - b.x, dy = best.y + best.h / 2 - b.y;
  const L = Math.max(1, Math.hypot(dx, dy)), sp = Math.hypot(b.vx, b.vy);
  b.vx = lerp(b.vx, dx / L * sp, dt * 7);
  b.vy = lerp(b.vy, dy / L * sp, dt * 7);
}
function updateBeams(dt) {
  for (let i = BEAMS.length - 1; i >= 0; i--) {
    const bm = BEAMS[i];
    if (bm.arc) { bm.t -= dt; if (bm.t <= 0) { BEAMS[i] = BEAMS[BEAMS.length - 1]; BEAMS.pop(); } continue; }
    if (bm.t === bm.max) {                            // перший кадр — рахуємо влучання
      const x0 = bm.dir > 0 ? bm.x : bm.x - bm.len;
      for (let j = 0; j < ENEM.length; j++) {
        const e = ENEM[j];
        if (e.dead) continue;
        if (boxHit(x0, bm.y - 3, bm.len, 6, e.x, e.y, e.w, e.h))
          damageEnemy(e, bm.dmg, bm.dir * S(60), { pierce: true });
      }
      if (BOSS.on) {
        const hbs = bossHitBoxes();
        for (let j = 0; j < hbs.length; j++) {
          const hb = hbs[j];
          if (boxHit(x0, bm.y - 3, bm.len, 6, hb.x, hb.y, hb.w, hb.h))
            bossDamage(hb, bm.dmg, { pierce: true });
        }
      }
      for (let j = BULL.length - 1; j >= 0; j--) {    // промінь випалює ворожі кулі
        const b = BULL[j];
        if (b.own === 'e' && boxHit(x0, bm.y - 4, bm.len, 8, b.x - 2, b.y - 2, 4, 4)) {
          burst(b.x, b.y, 3, '#ffd23f', 60, 0.2, 0, 1);
          BULL[j] = BULL[BULL.length - 1]; BULL.pop();
        }
      }
    }
    bm.t -= dt;
    if (bm.t <= 0) { BEAMS[i] = BEAMS[BEAMS.length - 1]; BEAMS.pop(); }
  }
}
function updateTele(dt) {
  for (let i = TELE.length - 1; i >= 0; i--) {
    TELE[i].t -= dt;
    if (TELE[i].t <= 0) { TELE[i] = TELE[TELE.length - 1]; TELE.pop(); }
  }
}

/* ================================================================
   13. БОСИ — 5 штук, у кожного 2-3 фази й читані телеграфи атак
   ================================================================ */
// Боси збільшено на BSPR (x1.5) разом зі спрайтами.
/** Скільки разів гравець паріював за сеанс — для навчання й тренувальної кімнати. */
let parryCount = 0;
export function parries() { return parryCount; }

const BOSSDEF = {
  servotaur: { name: 'СЕРВОТАВР',   hp: 275,  w: Si(60), h: Si(45), sub: 'МЕХ-БИК ДОКІВ',       tel: 0.70, phases: 2 },
  queen:     { name: 'МАТКА-РІЙ',   hp: 375,  w: Si(54), h: Si(36), sub: 'ІНКУБАТОР ФАБРИКИ',   tel: 0.65, phases: 2 },
  // HP -20 % (95 -> 76): складність перенесено з тривалості в патерни
  chrono:    { name: 'ХРОНОКЛИНОК', hp: 380,  w: Si(21), h: Si(33), sub: 'ДУЕЛЯНТ САДУ',        tel: 0.60, phases: 3 },
  // HP 95 -> 60: бій тепер гейтований вікнами, і саме дальня зброя
  // впирається в стелю «не більше 6 вікон» (див. tests/glitch.mjs)
  glitch:    { name: 'ГЛІТЧ-ЯДРО',  hp: 300,  w: Si(39), h: Si(39), sub: 'ЗБІЙ У МЕРЕЖІ',       tel: 0.55, phases: 3 },
  architect: { name: 'АРХІТЕКТОР',  hp: 750, w: Si(33), h: Si(45), sub: 'ЯДРО КАЙЗЕН-ВОЛЬТ',   tel: 0.50, phases: 3 }
};
/** Телеграф атаки: режим складності × разова допомога після трьох смертей. */
function TEL(k) {
  const assist = (Store.data.easy || Game.assist) ? 1.25 : 1;
  return (BOSS.def ? BOSS.def.tel : 0.5) * (k || 1) * assist * DIFF.tel;
}
/** Вікно вразливості: на легкому довше в півтора раза, на максимальному — на чверть коротше. */
function WIN(t) { return t * DIFF.win; }
/** Чи прибрано цей патерн полегшеним режимом. */
function dropped(name) { return DIFF.dropHardest && HARDEST[BOSS.type] === name; }
/* Режим люті — м'який. Після 120 с бою бос прискорює атаки на 15 %,
   але телеграфи лишаються тими самими: реакція гравця не страждає.
   Вмикається один раз і далі не росте. У «Полегшеному режимі» й після
   адаптивної допомоги (3 смерті) не вмикається взагалі. */
const RAGE_AT = 120;                                // секунд бою до люті
const RAGE_K = 1.15;                                // темп атак +15 %
function RT() { return BOSS.rage ? 1 / RAGE_K : 1; }
function rageCheck() {
  if (BOSS.rage) return;                            // не стакається
  if (Store.data.easy || Game.assist) return;       // легким і тим, кому вже помагаємо, — ні
  if (!DIFF.rageAt) return;                         // на легкому люті немає зовсім
  if (BOSS.fightT < DIFF.rageAt) return;            // 120 с штатно, 90 на максимальному
  BOSS.rage = 1;
  Sfx.bossIn(); cam.hit(5); buzz(30);
  Music.layer(3);                                   // той самий double-time шар, що у фінальній фазі
  ring(BOSS.x + BOSS.w / 2, BOSS.y + BOSS.h / 2, 6, 90, 0.8, '#ff3355', 3);
  burst(BOSS.x + BOSS.w / 2, BOSS.y + BOSS.h / 2, 22, '#ff3355', 190, 0.7, 20, 2);
}
const BOSS = {
  on: false, done: false, type: null, def: null,
  hp: 0, maxHp: 0, phase: 1, x: 0, y: 0, w: 0, h: 0, vx: 0, vy: 0,
  st: 'idle', tm: 0, tm2: 0, tm3: 0, flash: 0, face: -1, anim: 0,
  parts: [], intro: 0, nameT: 0, dieT: 0, spawned: 0, inv: 0,
  a0: 0, a1: 0, cx: 0, gravT: 0, offT: 0, dupT: 0, shadow: null, ground: Si(208),
  silence: 0, rage: 0, fightT: 0, lowT: 0, nodesLeft: undefined,
  dockI: -1, foldT: 0, nodesDone: false, colX: 0, dockBack: 0, lowCd: 0,
  tpCd: 0, tpSpot: -1, punish: 0, trailT: 0, lastSeries: null
};

function bossReset() {
  BOSS.on = false; BOSS.done = false; BOSS.type = null; BOSS.def = null;
  BOSS.parts.length = 0; BOSS.intro = 0; BOSS.nameT = 0; BOSS.dieT = 0;
  BOSS.spawned = 0; BOSS.inv = 0; BOSS.phase = 1; BOSS.st = 'idle';
  BOSS.tm = BOSS.tm2 = BOSS.tm3 = 0; BOSS.flash = 0; BOSS.anim = 0;
  BOSS.gravT = 0; BOSS.offT = 0; BOSS.dupT = 0; BOSS.shadow = null;
  BOSS.silence = 0; BOSS.rage = 0; BOSS.fightT = 0;
  BOSS.lowT = 0; BOSS.nodesLeft = undefined;
  BOSS.dockI = -1; BOSS.foldT = 0; BOSS.nodesDone = false; BOSS.colX = 0; BOSS.dockBack = 0;
  BOSS.lowCd = 0;
  BOSS.tpCd = 0; BOSS.tpSpot = -1; BOSS.punish = 0; BOSS.trailT = 0; BOSS.lastSeries = null;
  twinReset();
  world.grav = 1; world.off = null;
}
/**
 * Програти катсцену за тригером ('pre' — перед босом, 'post' — після
 * його смерті, 'lvl' — на початку рівня). `onDone` викликається завжди:
 * і після перегляду, і після пропуску, і якщо сценарію взагалі нема,
 * тож гра не може зависнути на порожньому тригері.
 */
function playCut(kind, onDone) {
  const sc = cutScript(kind, Game.level);
  const back = Game.state;
  if (!sc) { onDone(); return false; }
  Game.state = 'cut';
  Input.enable(false);                              // керування ховається
  Music.duck(2.2);                                  // і приглушується музика
  const ok = Cut.play(sc, () => {
    Game.state = back;
    Input.enable(back === 'play');
    Input.clearEdges();
    onDone();
  });
  if (!ok) { Game.state = back; Input.enable(back === 'play'); }
  return ok;
}
Cut.hooks.shake = n => cam.hit(n);
Cut.hooks.sfx = n => { if (Sfx[n]) Sfx[n](); };
Cut.hooks.music = m => {
  if (m.track) Music.set(m.track);
  if (m.layer !== undefined) Music.layer(m.layer);
  if (m.duck) Music.duck(m.duck);
  if (m.sting) Music.sting(m.sting);
};
Cut.hooks.camGet = () => ({ x: cam.x, y: cam.y });
Cut.hooks.camSet = (x, y) => { cam.x = x; cam.y = y; };

function startBoss() {
  const type = world.bossType;
  if (!type) return;
  const d = BOSSDEF[type];
  bossReset();
  BOSS.on = true; BOSS.type = type; BOSS.def = d;
  BOSS.hp = BOSS.maxHp = d.hp; BOSS.w = d.w; BOSS.h = d.h;
  BOSS.a0 = world.bossX; BOSS.a1 = world.pw;
  BOSS.cx = (BOSS.a0 + BOSS.a1) / 2;
  BOSS.ground = 13 * TS;                      // рівень підлоги на аренах
  BOSS.x = BOSS.a1 - Si(90); BOSS.y = BOSS.ground - d.h;
  BOSS.face = -1; BOSS.intro = 1.9; BOSS.nameT = 3.2;
  cam.lockX0 = BOSS.a0; cam.lockX1 = BOSS.a1;
  Music.set('boss' + (world.idx + 1));            // у кожного боса власний трек
  Music.layer(3); Music.duck(2.6);                // поява боса: -25% на час репліки
  Sfx.bossIn(); cam.hit(5);
  if (type === 'queen') {
    BOSS.y = Si(104);
    // дві опори стоять на підлозі, дві — над галереями (стріляти з платформи)
    // дві опори на підлозі, дві — просто на галереях (стрибок із підлоги 32 px)
    const pos = [[BOSS.a0 + Si(18), Si(192)], [BOSS.a1 - Si(44), Si(192)],
                 [BOSS.a0 + Si(80), Si(160)], [BOSS.a1 - Si(90), Si(160)]];
    for (let i = 0; i < 4; i++)
      BOSS.parts.push({ id: i + 1, x: pos[i][0], y: pos[i][1], w: Si(14), h: Si(14),
                        hp: 50, maxHp: 50, alive: true, flash: 0, kind: 'node' });
  }
  if (type === 'glitch') {
    BOSS.x = BOSS.cx - Si(13); BOSS.y = Si(96); BOSS.inv = 1;
    BOSS.st = 'fly'; BOSS.tm = GL_FLY; BOSS.tm2 = 1.2; BOSS.tm3 = 3.0;
    // центр колони шукаємо в самій карті, а не хардкодимо: колона — це
    // єдиний стовпчик суцільних тайлів посеред арени, що не дістає стелі
    BOSS.colX = BOSS.cx;
    for (let tx = Math.floor(BOSS.a0 / TS) + 4; tx < world.tw - 4; tx++) {
      const top = Math.floor((BOSS.ground - GL_DOCKS[1].up) / TS);
      if (isSolidCode(tAt(tx, top)) && !isSolidCode(tAt(tx, top - 1)) &&
          isSolidCode(tAt(tx, top + 1))) { BOSS.colX = tx * TS + TS / 2; break; }
    }
    glitchSpawnNodes();
  }
  if (type === 'architect') { BOSS.y = BOSS.ground - d.h - Si(10); }
}
function bossInvulnerable() {
  if (BOSS.type === 'queen') {
    for (let i = 0; i < BOSS.parts.length; i++) if (BOSS.parts[i].alive) return true;
    return false;
  }
  if (BOSS.type === 'glitch') return BOSS.st !== 'dock';
  // Фаза 3: щит падає зовсім — бити можна чим завгодно й коли завгодно.
  // Поки часова копія доспівує серію, оригінал розсинхронізований і теж
  // відкритий: «часова копія» стає вибором (гнатись за копією чи бити його),
  // а не просто паузою, у яку нічого не зробиш.
  if (BOSS.type === 'chrono')
    return BOSS.phase < 3 && BOSS.st !== 'stagger' && BOSS.st !== 'echo';
  if (BOSS.type === 'architect') return BOSS.phase === 2;      // б'ються тільки ядра
  return false;
}
function bossHitBoxes() {
  const out = [];
  if (!BOSS.on || BOSS.st === 'die') return out;
  if (BOSS.type === 'queen' || BOSS.type === 'architect' || BOSS.type === 'glitch') {
    for (let i = 0; i < BOSS.parts.length; i++) {
      const p = BOSS.parts[i];
      if (p.alive) out.push({ x: p.x, y: p.y, w: p.w, h: p.h, id: p.id, part: p });
    }
  }
  if (!(BOSS.type === 'architect' && BOSS.phase === 2))
    out.push({ x: BOSS.x, y: BOSS.y, w: BOSS.w, h: BOSS.h, id: 0, part: null });
  return out;
}
function bossDamage(hb, dmg, opt) {
  opt = opt || {};
  if (!BOSS.on || BOSS.st === 'die' || BOSS.intro > 0) return false;
  // Влучив у Хроноклинка в момент появи — подвійна шкода: нагорода
  // за те, що встиг розвернутись і вдарити, а не просто відскочив.
  if (BOSS.punish > 0 && BOSS.type === 'chrono' && !hb.part) {
    dmg *= 2; BOSS.punish = 0;
    Sfx.parry(); cam.hit(3); hitStop(0.06);
    ring(BOSS.x + BOSS.w / 2, BOSS.y + BOSS.h / 2, 3, 40, 0.45, '#ffd23f', 3);
    wfx({ k: 'rip', x: BOSS.x + BOSS.w / 2, y: BOSS.y + BOSS.h / 2, h: BOSS.h + Si(10), t: 0.22 });
  }
  // Чит лягає ПОВЕРХ уже порахованої шкоди й нічого в ній не переписує.
  if (DEV_MODE) dmg = CH.oneShot ? 1e6 : dmg * CH.dmgK;
  const part = hb.part;
  if (part) {
    if (!part.alive) return false;
    part.hp -= dmg; part.flash = 0.12;
    Sfx.hitEnemy();
    burst(part.x + part.w / 2, part.y + part.h / 2, 5, '#ffd23f', 120, 0.3, 60, 1);
    if (opt.melee) { bladeCharge(1); hitStop(0.05); }
    if (part.hp <= 0) {
      part.alive = false;
      Sfx.explode(); cam.hit(4);
      burst(part.x + part.w / 2, part.y + part.h / 2, 18, '#ff6b3d', 180, 0.6, 120, 2);
      ring(part.x + part.w / 2, part.y + part.h / 2, 3, 30, 0.4, '#ffd23f', 2);
      if (BOSS.type === 'architect') { BOSS.hp -= 70; bossCheckPhase(); }
      if (BOSS.type === 'glitch') {                 // збив вузол даних
        ring(part.x + part.w / 2, part.y + part.h / 2, 2, 22, 0.3, '#00ffcc', 2);
        Sfx.parry();
        // МАКСИМАЛЬНИЙ: вузол відроджується (таймер веде сам цикл боса
        // — див. стан 'dock'), тож зняти всі три треба за одне вікно.
      }
      // МАКСИМАЛЬНИЙ: збитий генератор вибухає хвилею по підлозі. Стояти
      // під вузлом, який ось-ось впаде, більше не безкоштовно.
      if (BOSS.type === 'queen' && DIFF.extra) {
        const gx = part.x + part.w / 2;
        telegraph(gx - Si(46), BOSS.ground - Si(10), Si(92), Si(10), 0.55, '#ff6b3d', 1);
        PENDING.push({ x: gx - Si(46), y: BOSS.ground - Si(10), w: Si(92), h: Si(10),
                       t: 0.55, dur: 0.5, dmg: 1 });
        for (const d of [-1, 1])
          shoot(gx, BOSS.ground - Si(12), d * S(190), 0,
                { own: 'e', dmg: 1, col: '#ff6b3d', w: 10, h: 14, life: 2.4, kind: 3 });
        cam.hit(5);
      }
    }
    return true;
  }
  if (bossInvulnerable() || BOSS.inv > 0) {
    // Наведення працює й по броні — саме тому тут потрібен ЯВНИЙ знак,
    // що шкода не проходить: інакше здається, що зброя зламана.
    wfx({ k: 'armor', x: hb.x + hb.w / 2, y: hb.y + hb.h / 2, t: 0.30 });
    Sfx.blocked();
    burst(BOSS.x + BOSS.w / 2, BOSS.y + BOSS.h / 2, 4, '#22e0ff', 90, 0.22, 0, 1);
    return false;
  }
  BOSS.hp -= dmg; BOSS.flash = 0.12;
  Sfx.bossHurt();
  if (opt.melee) { bladeCharge(1); hitStop(0.05); cam.hit(2); buzz(10); }
  burst(BOSS.x + BOSS.w / 2 + rnd(-8, 8), BOSS.y + BOSS.h / 2 + rnd(-8, 8), 6, '#ffd23f', 140, 0.35, 90, 1);
  if (BOSS.hp <= 0) { BOSS.hp = 0; bossDie(); } else bossCheckPhase();
  return true;
}
function bossCheckPhase() {
  const f = BOSS.hp / BOSS.maxHp;
  if (BOSS.type === 'architect') {
    if (BOSS.phase === 1 && f <= 0.66) bossArchPhase2();
    else if (BOSS.phase === 2 && f <= 0.33) bossArchPhase3();
    return;
  }
  // Хроноклинку третя фаза належить рівно на 1/3 HP, решті — на 28 %
  const p3 = BOSS.type === 'chrono' ? 0.34 : 0.28;
  if (BOSS.phase === 2 && f <= p3 && (BOSS.def.phases || 3) >= 3) {
    BOSS.phase = 3; BOSS.inv = 0.9; BOSS.st = 'phase'; BOSS.tm = 0.9;
    Sfx.bossIn(); cam.hit(7);
    ring(BOSS.x + BOSS.w / 2, BOSS.y + BOSS.h / 2, 6, 90, 0.8, '#ffd23f', 3);
    burst(BOSS.x + BOSS.w / 2, BOSS.y + BOSS.h / 2, 28, '#ffd23f', 220, 0.8, 40, 2);
    return;
  }
  if (BOSS.phase === 1 && f <= 0.6) {
    BOSS.phase = 2; BOSS.inv = 0.9; BOSS.st = 'phase'; BOSS.tm = 0.9;
    // МАКСИМАЛЬНИЙ: з другої фази поряд із Хроноклинком з'являється
    // часова копія — і більше не зникає до кінця бою.
    if (BOSS.type === 'chrono' && DIFF.extra) {
      TWIN.on = 1; TWIN.x = BOSS.x; TWIN.y = BOSS.y; TWIN.face = BOSS.face; TWIN.hist.length = 0;
      ring(BOSS.x + BOSS.w / 2, BOSS.y + BOSS.h / 2, 4, 46, 0.6, '#8f6fff', 3);
      Sfx.wChrono();
    }
    Sfx.bossIn(); cam.hit(6);
    ring(BOSS.x + BOSS.w / 2, BOSS.y + BOSS.h / 2, 6, 70, 0.7, '#ff2e88', 3);
    burst(BOSS.x + BOSS.w / 2, BOSS.y + BOSS.h / 2, 24, '#ff2e88', 200, 0.7, 40, 2);
    // Генератори більше не відроджуються: збив — назавжди.
  }
}
function bossDie() {
  if (BOSS.st === 'die') return;                 // смерть програється лише раз
  Music.sting('boss');
  BOSS.st = 'die'; BOSS.dieT = 2.6; BOSS.inv = 99;
  Sfx.bossDie(); buzz([60, 40, 120]); cam.hit(8);
  world.grav = 1; world.off = null;
}
function bossContact(dmg) {
  if (BOSS.st === 'die' || BOSS.intro > 0) return;
  if (boxHit(BOSS.x, BOSS.y, BOSS.w, BOSS.h, P.x, P.y, P.w, P.h))
    playerHurt(dmg || 1, BOSS.x + BOSS.w / 2);
}

/* ---- зони шкоди (лазери, ударні хвилі, промені босів) ---- */
const ZONES = [];
function zone(x, y, w, h, t, dmg, col, kind) {
  if (ZONES.length > 30) ZONES.shift();
  const z = { x: x, y: y, w: w, h: h, t: t, max: t, dmg: dmg, col: col || '#ff2e88',
              kind: kind || 0, hit: false, vx: 0 };
  ZONES.push(z);
  return z;
}
function updateZones(dt) {
  for (let i = ZONES.length - 1; i >= 0; i--) {
    const z = ZONES[i];
    z.t -= dt;
    if (z.vx) z.x += z.vx * dt;
    zoneCrush(z);                                   // прес, потяг і контейнер б'ють обидві сторони
    if (!z.hit && boxHit(z.x, z.y, z.w, z.h, P.x, P.y, P.w, P.h)) {
      if (playerHurt(z.dmg, z.x + z.w / 2)) z.hit = true;
    }
    if (z.t <= 0) { ZONES[i] = ZONES[ZONES.length - 1]; ZONES.pop(); }
  }
}
/* ---- «тіні» ХРОНОКЛИНКА ---- */
const GHOSTS = [];

/* МАКСИМАЛЬНИЙ: часова копія не зникає після серії, а лишається до
   кінця бою. Вона йде слідом із відставанням рівно на секунду й
   повторює кожен його випад. У фазі 3 телепортується РАЗОМ із ним —
   тоді на екрані два фіолетові силуети-передвісники, і треба читати
   обидва. Копія — це не другий бос: у неї немає HP і власних рішень,
   вона рівно на секунду пізніше робить те, що він уже зробив. */
const TWIN = { on: 0, x: 0, y: 0, face: -1, hist: [], tel: 0, tx: 0, ty: 0 };
const TWIN_LAG = 1.0;                               // затримка копії, с
function twinReset() { TWIN.on = 0; TWIN.hist.length = 0; TWIN.tel = 0; }
export function twin() { return TWIN; }
function twinUpdate(dt) {
  if (!TWIN.on) return;
  TWIN.hist.push({ t: world.time, x: BOSS.x, y: BOSS.y, f: BOSS.face });
  // Історія коротка: секунда при 60 к/с — це 60 записів, не більше.
  while (TWIN.hist.length > 2 && world.time - TWIN.hist[1].t > TWIN_LAG) TWIN.hist.shift();
  if (TWIN.tel > 0) {                               // телепорт разом із оригіналом
    TWIN.tel -= dt;
    if (TWIN.tel <= 0) {
      TWIN.x = TWIN.tx; TWIN.y = TWIN.ty; TWIN.hist.length = 0;
      burst(TWIN.x + BOSS.w / 2, TWIN.y + BOSS.h / 2, 10, '#8f6fff', 120, 0.3, 0, 1);
    }
    return;
  }
  const h = TWIN.hist[0];
  if (h) { TWIN.x = h.x; TWIN.y = h.y; TWIN.face = h.f; }
  if (Math.random() < 0.25)
    part(TWIN.x + rnd(0, BOSS.w), TWIN.y + rnd(0, BOSS.h), 0, -16, 0.3, '#8f6fff', 1, 0, 1);
}
/** Копія повторює випад — з місця, де вона БУДЕ через секунду. */
function twinEcho() {
  if (!TWIN.on) return;
  GHOSTS.push({ x: 0, y: 0, vx: 0, t: 0.30, delay: TWIN_LAG, hit: false, twin: 1 });
}
function updateGhosts(dt) {
  for (let i = GHOSTS.length - 1; i >= 0; i--) {
    const g = GHOSTS[i];
    if (g.delay > 0) {
      g.delay -= dt;
      if (g.delay <= 0) {
        // Копія б'є з того місця, де стоїть САМЕ ЗАРАЗ, а не де стояла
        // секунду тому: інакше удар прилітав би в порожнечу.
        if (g.twin) { g.x = TWIN.x; g.y = TWIN.y; g.vx = TWIN.face * S(250); }
        Sfx.slash(0);
      }
      continue;
    }
    g.t -= dt;
    g.x += g.vx * dt;
    if (!g.hit && boxHit(g.x - Si(8), g.y, Si(20), Si(16), P.x, P.y, P.w, P.h)) g.hit = playerHurt(1, g.x);
    if (Math.random() < 0.5) part(g.x + rnd(-6, 6), g.y + rnd(0, 16), 0, 0, 0.2, '#8f6fff', 1, 0, 1);
    if (g.t <= 0) { GHOSTS[i] = GHOSTS[GHOSTS.length - 1]; GHOSTS.pop(); }
  }
}
function explosion(x, y, r, dmg, col) {
  Sfx.explode(); cam.hit(4);
  ring(x, y, 3, r, 0.4, col || '#ff6b3d', 3);
  burst(x, y, 18, col || '#ffd23f', 190, 0.5, 160, 2);
  if (dist2(x, y, P.x + P.w / 2, P.y + P.h / 2) < r * r) playerHurt(dmg, x);
}

/* Уламки зі стелі: телеграф на підлозі, потім падіння. Використовує
   штатні зони шкоди, тож нічого нового в рендер додавати не треба. */
function ceilingDebris(n) {
  const x0 = Math.max(BOSS.a0 + Si(10), P.x - Si(70));
  const x1 = Math.min(BOSS.a1 - Si(10), P.x + Si(70));
  for (let i = 0; i < n; i++) {
    const x = rnd(x0, x1);
    const t = TEL(1.0) + i * 0.18;
    PENDING.push({ x: x, y: BOSS.ground - Si(118), w: 0, h: 0, t: t, dur: 0,
                   shootVX: 0, shootVY: S(300), debris: 1 });
    // Попередження на підлозі: атаки без телеграфа заборонені на всіх режимах.
    ring(x, BOSS.ground - Si(3), Si(2), Si(13), t, '#ff3355', 2);
  }
  cam.hit(3);
}

/* ---------------- БОС 1: СЕРВОТАВР ---------------- */
function bossServotaur(dt) {
  const gy = BOSS.ground - BOSS.h;
  BOSS.vy += PH.GRAV * dt;
  BOSS.y += BOSS.vy * dt;
  if (BOSS.y >= gy) {
    if (BOSS.st === 'air') {                       // приземлення з ударною хвилею
      BOSS.st = 'landed'; BOSS.tm = 0.8;
      cam.hit(7); Sfx.explode(); buzz(30);
      for (const d of [-1, 1])
        shoot(BOSS.x + BOSS.w / 2, BOSS.ground - Si(9), d * S(150), 0,
              { own: 'e', dmg: 1, col: '#ffd23f', w: 12, h: 16, life: 3.2, kind: 3 });
      for (let i = 0; i < 16; i++)
        part(BOSS.x + rnd(0, BOSS.w), BOSS.ground - 2, rnd(-160, 160), rnd(-140, -30),
             rnd(0.3, 0.7), '#ffd23f', 2, 300, 1);
    }
    BOSS.y = gy; BOSS.vy = 0;
  }
  switch (BOSS.st) {
    case 'phase': case 'landed':
      BOSS.vx *= 0.8; BOSS.tm -= dt;
      if (BOSS.tm <= 0) { BOSS.st = 'idle'; BOSS.tm = 0.7 * RT(); }
      break;
    case 'idle': {
      BOSS.face = sign((P.x + P.w / 2) - (BOSS.x + BOSS.w / 2)) || BOSS.face;
      BOSS.vx = BOSS.face * S(26);
      moveX(BOSS, BOSS.vx * dt);
      BOSS.tm -= dt;
      if (BOSS.tm <= 0) {
        if (BOSS.phase >= 2 && !dropped('jump') && Math.random() < 0.45) { BOSS.st = 'jumpTel'; BOSS.tm = TEL(); }
        else { BOSS.st = 'paw'; BOSS.tm = TEL(1.1); BOSS.chain = BOSS.phase >= 3 ? 2 : 1; }
      }
      break;
    }
    case 'paw':                                     // ТЕЛЕГРАФ: риє копитом
      BOSS.vx = 0; BOSS.tm -= dt;
      if (Math.random() < 0.6)
        part(BOSS.x + (BOSS.face > 0 ? BOSS.w : 0), BOSS.ground - 2,
             -BOSS.face * rnd(40, 130), rnd(-90, -20), 0.4, '#ff6b3d', 2, 260, 1);
      if (BOSS.tm <= 0) { BOSS.st = 'charge'; BOSS.tm = 2.4; BOSS.vx = BOSS.face * S(235); Sfx.dash(); }
      break;
    case 'charge': {
      BOSS.tm -= dt;
      const hit = moveX(BOSS, BOSS.vx * dt);
      if (BOSS.x <= BOSS.a0 + 4) { BOSS.x = BOSS.a0 + 4; }
      if (BOSS.x + BOSS.w >= BOSS.a1 - 4) { BOSS.x = BOSS.a1 - 4 - BOSS.w; }
      const atWall = hit || BOSS.x <= BOSS.a0 + 5 || BOSS.x + BOSS.w >= BOSS.a1 - 5;
      if (boxHit(BOSS.x, BOSS.y, BOSS.w, BOSS.h, P.x, P.y, P.w, P.h)) playerHurt(1, BOSS.x + BOSS.w / 2);
      if (atWall && BOSS.chain > 1) {               // фаза 3: розворот і другий ривок
        BOSS.chain--;
        BOSS.face = -BOSS.face;
        BOSS.st = 'paw'; BOSS.tm = TEL(0.8);
        cam.hit(4); Sfx.explode();
      } else if (atWall) {
        BOSS.st = 'stun'; BOSS.tm = WIN(2.0); BOSS.vx = 0;   // вікно шкоди лють не коротшає
        cam.hit(6); Sfx.explode(); buzz(26);
        burst(BOSS.x + (BOSS.face > 0 ? BOSS.w : 0), BOSS.y + BOSS.h / 2, 18, '#ffd23f', 200, 0.6, 240, 2);
        // МАКСИМАЛЬНИЙ: удар у стіну трусить стелю, і в вікно шкоди
        // падають уламки. Бити можна — але спершу треба стати так, щоб
        // не отримати по голові. Вікно доводиться заслужити.
        if (DIFF.extra) ceilingDebris(3);
      } else if (BOSS.tm <= 0) { BOSS.st = 'idle'; BOSS.tm = 0.6; }
      break;
    }
    case 'stun':                                    // ВІКНО ШКОДИ
      BOSS.tm -= dt;
      if (Math.random() < 0.3)
        part(BOSS.x + rnd(0, BOSS.w), BOSS.y, rnd(-20, 20), -30, 0.5, '#22e0ff', 1, -10, 1);
      if (BOSS.tm <= 0) { BOSS.st = 'idle'; BOSS.tm = 0.35; }
      break;
    case 'jumpTel':                                 // ТЕЛЕГРАФ стрибка
      BOSS.vx = 0; BOSS.tm -= dt;
      if (BOSS.tm <= 0) {
        BOSS.st = 'air'; BOSS.vy = -S(450);
        BOSS.face = sign((P.x + P.w / 2) - (BOSS.x + BOSS.w / 2)) || BOSS.face;
        BOSS.vx = BOSS.face * S(105); Sfx.jump();
      }
      break;
    case 'air':
      moveX(BOSS, BOSS.vx * dt);
      BOSS.x = clamp(BOSS.x, BOSS.a0 + 4, BOSS.a1 - 4 - BOSS.w);
      break;
  }
  if (BOSS.st !== 'charge') bossContact(1);
}

/* ---------------- БОС 2: МАТКА-РІЙ ---------------- */
const QUEEN_GEN = 4.0;                              // одна оса на 4 с з кожного живого вузла
const QUEEN_WASPS = 4;                              // і не більше чотирьох на екрані
function bossQueen(dt) {
  const span = (BOSS.a1 - BOSS.a0) / 2 - Si(74);
  if (BOSS.st !== 'dive' && BOSS.st !== 'diveTel' && BOSS.lowT <= 0) {
    BOSS.x = BOSS.cx - BOSS.w / 2 + Math.sin(BOSS.anim * 0.55) * span;
    BOSS.y = Si(104) + Math.sin(BOSS.anim * 1.25) * Si(10); // висота, куди дістає стрибок із галереї
  }
  BOSS.face = sign((P.x + P.w / 2) - (BOSS.x + BOSS.w / 2)) || BOSS.face;
  const p2 = BOSS.phase >= 2;
  // ---- оси: кожен генератор — окреме джерело ----
  // Матка сама не спавнить нікого. Живий вузол випускає осу раз на 4 с;
  // збитий не випускає більше ніколи. Тож потік ос — це прямий наслідок
  // того, скільки генераторів гравець уже зняв.
  let live = 0;
  for (let i = 0; i < ENEM.length; i++) if (ENEM[i].fromBoss && !ENEM[i].dead) live++;
  for (let i = 0; i < BOSS.parts.length; i++) {
    const nd = BOSS.parts[i];
    if (!nd.alive) continue;
    nd.tm = (nd.tm === undefined ? QUEEN_GEN * (0.4 + i * 0.2) : nd.tm) - dt;
    if (nd.tm > 0) continue;
    nd.tm = QUEEN_GEN;
    if (live >= QUEEN_WASPS) continue;              // більше чотирьох на екрані не буває
    const e = spawnEnemy('wasp', nd.x + nd.w / 2 - Si(8), nd.y - Si(12), false);
    if (e) {
      e.fromBoss = true; e.hy = nd.y - Si(22); live++;
      nd.pulse = 0.35;                              // вузол здригається на випуску
      Sfx.shoot();
      ring(nd.x + nd.w / 2, nd.y + nd.h / 2, 2, 14, 0.3, '#22e0ff', 2);
      // МАКСИМАЛЬНИЙ: оси виходять ЗВ'ЯЗКОЮ по дві й заходять з різних
      // боків — відступити «за спину» від однієї більше не рятує.
      if (DIFF.extra && live < QUEEN_WASPS) {
        const e2 = spawnEnemy('wasp', nd.x + nd.w / 2 - Si(8), nd.y - Si(12), false);
        if (e2) {
          e2.fromBoss = true; e2.hy = nd.y - Si(30); e2.pairSide = -1; e.pairSide = 1;
          live++;
        }
      }
    }
  }
  // бомби з телеграфом
  BOSS.tm2 -= dt;
  if (BOSS.tm2 <= 0) {
    BOSS.tm2 = (p2 ? 1.9 : 2.8) * RT();
    if (BOSS.phase >= 3 && !dropped('dive') && Math.random() < 0.4) {   // ФАЗА 3: пікірування
      BOSS.st = 'diveTel'; BOSS.tm3 = TEL(1.1);
      telegraph(P.x - Si(16), P.y - Si(10), P.w + Si(32), P.h + Si(20), TEL(1.1), '#ff2e88', 1);
    } else {
      // тінь під бомбою на землі рівно за 0,8 с до падіння
      BOSS.st = 'bombTel'; BOSS.tm3 = Math.max(0.8, TEL());
      telegraph(P.x - Si(12), BOSS.ground - Si(4), P.w + Si(24), Si(4), BOSS.tm3, '#ff6b3d', 1);
      telegraph(P.x - Si(12), BOSS.ground - Si(26), P.w + Si(24), Si(26), BOSS.tm3, '#ff6b3d', 1);
    }
  }
  if (BOSS.st === 'diveTel') {
    BOSS.tm3 -= dt;
    if (BOSS.tm3 <= 0) { BOSS.st = 'dive'; BOSS.tm3 = 0.8; BOSS.tx = P.x; BOSS.ty = P.y; }
  } else if (BOSS.st === 'dive') {
    BOSS.tm3 -= dt;
    const dx = BOSS.tx - BOSS.x, dy = BOSS.ty - BOSS.y, L = Math.max(1, Math.hypot(dx, dy));
    BOSS.x += dx / L * S(260) * dt; BOSS.y += dy / L * S(260) * dt;
    if (BOSS.tm3 <= 0) BOSS.st = 'fly';
  }
  if (BOSS.st === 'bombTel') {
    BOSS.tm3 -= dt;
    if (BOSS.tm3 <= 0) {
      BOSS.st = 'fly';
      const dx = (P.x + P.w / 2) - (BOSS.x + BOSS.w / 2);
      shoot(BOSS.x + BOSS.w / 2, BOSS.y + BOSS.h, clamp(dx * 0.85, -S(150), S(150)), S(30),
            { own: 'e', dmg: 1, col: '#ff6b3d', w: 8, h: 8, life: 4, grav: 300, kind: 4 });
      Sfx.shoot();
    }
  }
  // вузли-генератори живлять щит матки
  let alive = 0;
  for (let i = 0; i < BOSS.parts.length; i++) {
    const nd = BOSS.parts[i];
    if (nd.flash > 0) nd.flash -= dt;
    if (nd.pulse > 0) nd.pulse -= dt;
    if (!nd.alive) continue;
    alive++;
    if (Math.random() < 0.06)
      part(nd.x + rnd(0, nd.w), nd.y + rnd(0, nd.h), rnd(-20, 20), rnd(-30, 0), 0.4, '#22e0ff', 1, -20, 1);
  }
  if (BOSS.nodesLeft === undefined) BOSS.nodesLeft = alive;
  if (alive < BOSS.nodesLeft) {                     // щойно збили генератор
    BOSS.nodesLeft = alive;
    BOSS.lowT = 3.0;                                // матка опускається — вікно для клинка
    Sfx.bossHurt(); cam.hit(4);
    ring(BOSS.x + BOSS.w / 2, BOSS.y + BOSS.h, 5, 70, 0.7, '#ffd23f', 3);
  }
  // Коли генераторів не лишилось, щита немає — і матка більше не має
  // права висіти недосяжно для клинка. Раз на 6 с вона сама сідає у
  // зону ураження на 2,5 с: гравець із ближньою зброєю не впирається.
  if (alive === 0 && BOSS.st !== 'dive' && BOSS.st !== 'diveTel') {
    BOSS.lowCd -= dt;
    if (BOSS.lowCd <= 0 && BOSS.lowT <= 0) {
      BOSS.lowCd = 6.0; BOSS.lowT = 2.5;
      Sfx.charge(); cam.hit(2);
      ring(BOSS.x + BOSS.w / 2, BOSS.y + BOSS.h, 4, 46, 0.45, '#ffd23f', 2);
    }
  }
  if (BOSS.lowT > 0) {                              // вікно, коли її дістає навіть клинок
    BOSS.lowT -= dt;
    BOSS.y = BOSS.ground - BOSS.h - Si(26) + Math.sin(BOSS.anim * 3) * Si(3);
  }
  BOSS.shielded = alive > 0;
  bossContact(1);
}

/* ---------------- БОС 3: ХРОНОКЛИНОК ---------------- */
/* ================================================================
   ХРОНОКЛИНОК: три фази

   Раніше він був важкий лише запасом HP: один патерн (телепорт ->
   випад), який після пари спроб контриться парируванням, і далі дві
   хвилини повторення. HP зрізано на 20 % (95 -> 76), а складність
   перенесено в патерни.

   ФАЗА 1  телепорт збоку -> серія з трьох випадів. Пробити захист
           можна тільки парируванням (як і було).
   ФАЗА 2  + два нових патерни:
           «РИВОК» через усю арену зі слідом, що ранить — перестрибується;
           «ЧАСОВА КОПІЯ» — повторює його попередню серію із затримкою 1 с.
   ФАЗА 3  (1/3 HP) щит падає зовсім: бити можна чим завгодно й коли
           завгодно. Натомість він телепортується ЗА СПИНУ, але за 0,5 с
           до появи в тій точці стоїть фіолетовий силует і чути звук.
           Влучив у момент появи — подвійна шкода.
   ================================================================ */
const CH_TP_CD = 2.5;        // не частіше ніж раз на 2,5 с
const CH_TEL = 0.5;          // силует-передвісник
const CH_PUNISH = 0.45;      // вікно подвійної шкоди за реакцію
const CH_OPEN = 2.3;         // вікно шкоди за парирування
const CH_RUSH_OPEN = 1.4;    // вікно шкоди після ривка об стіну

/** Точки появи у фазі 3: за спиною, збоку й далеко збоку. Ніколи двічі поспіль. */
function chronoBlinkSpot() {
  const back = P.face > 0 ? -1 : 1;                 // «за спиною» = проти погляду
  const spots = [
    P.x + back * Si(40),                                 // просто за спиною
    P.x + back * Si(74),                                 // трохи далі за спиною
    P.x - back * Si(62)                                  // з іншого боку: щоб не вгадувалось
  ];
  let i = Math.floor(rnd(0, 2.999));
  if (i === BOSS.tpSpot) i = (i + 1) % spots.length;
  BOSS.tpSpot = i;
  return clamp(spots[i], BOSS.a0 + Si(12), BOSS.a1 - BOSS.w - Si(12));
}
/** Слід ривка: низька смуга, яку видно й через яку можна перестрибнути. */
function chronoTrail(x, gy) {
  const z = zone(x - 8, gy - 14, 16, 14, 1.5, 1, '#8f6fff', 0);
  z.vx = 0;
  for (let i = 0; i < 3; i++)
    part(x + rnd(-6, 6), gy - rnd(0, 12), rnd(-20, 20), rnd(-30, 0), 0.4, '#8f6fff', 1, -20, 1);
}

function bossChrono(dt) {
  const gy = BOSS.ground - BOSS.h;
  BOSS.vy += PH.GRAV * dt;
  BOSS.y = Math.min(gy, BOSS.y + BOSS.vy * dt);
  if (BOSS.y >= gy) { BOSS.y = gy; BOSS.vy = 0; }
  BOSS.face = sign((P.x + P.w / 2) - (BOSS.x + BOSS.w / 2)) || BOSS.face;
  if (BOSS.tpCd > 0) BOSS.tpCd -= dt;
  if (BOSS.punish > 0) BOSS.punish -= dt;

  switch (BOSS.st) {
    case 'phase': BOSS.tm -= dt; if (BOSS.tm <= 0) { BOSS.st = 'idle'; BOSS.tm = 0.4; } break;

    case 'idle':
      BOSS.tm -= dt;
      if (BOSS.tm <= 0) {
        // Фаза 3 живе телепортами за спину; фази 1-2 — випадами,
        // і з другої фази до них додаються два нові патерни.
        // Фаза 3 без нових патернів на легкому: вона лишається (бос
        // прискорюється), але телепорт за спину туди не приходить.
        if (BOSS.phase >= 3 && DIFF.p3new && BOSS.tpCd <= 0) {
          BOSS.st = 'blinkTel'; BOSS.tm = CH_TEL;
          BOSS.tx = chronoBlinkSpot(); BOSS.ty = gy;
          Sfx.wChrono(); cam.hit(1.5);
          // Копія стрибає РАЗОМ із ним і в іншу точку: на екрані два
          // передвісники, і прочитати треба обидва.
          if (TWIN.on) { TWIN.tel = CH_TEL; TWIN.tx = chronoBlinkSpot(); TWIN.ty = gy; }
        } else if (BOSS.phase >= 2 && !dropped('rush') && Math.random() < 0.30) {
          BOSS.st = 'rushTel'; BOSS.tm = TEL(1.3);   // НОВЕ: ривок через арену
          BOSS.tx = BOSS.face > 0 ? BOSS.a1 - BOSS.w - 8 : BOSS.a0 + 8;
          telegraph(BOSS.a0 + Si(4), BOSS.ground - Si(16), BOSS.a1 - BOSS.a0 - Si(8), Si(16), TEL(1.3), '#8f6fff', 2);
          Sfx.charge();
        } else if (BOSS.phase >= 2 && BOSS.lastSeries && Math.random() < 0.30) {
          BOSS.st = 'echo'; BOSS.tm = 1.0;           // НОВЕ: часова копія серії
          Sfx.overheat();
          for (let i = 0; i < BOSS.lastSeries.length; i++) {
            const g = BOSS.lastSeries[i];
            GHOSTS.push({ x: g.x, y: g.y, vx: g.vx, t: 0.30, delay: 1.0 + i * 0.45, hit: false });
          }
        } else {
          BOSS.st = 'tp'; BOSS.tm = TEL(0.9);
          const side = (P.x < BOSS.cx) ? 1 : -1;
          BOSS.tx = clamp(P.x + side * 54, BOSS.a0 + 12, BOSS.a1 - BOSS.w - 12);
          BOSS.ty = gy;
        }
      }
      break;

    case 'tp':                                       // ТЕЛЕГРАФ телепорту
      BOSS.tm -= dt;
      if (Math.random() < 0.7)
        part(BOSS.tx + rnd(0, BOSS.w), BOSS.ty + rnd(0, BOSS.h), 0, -20, 0.3, '#8f6fff', 1, 0, 1);
      if (BOSS.tm <= 0) {
        burst(BOSS.x + BOSS.w / 2, BOSS.y + BOSS.h / 2, 10, '#8f6fff', 120, 0.3, 0, 1);
        BOSS.x = BOSS.tx; BOSS.y = BOSS.ty;
        BOSS.st = 'wind'; BOSS.tm = TEL(1.19); BOSS.tm3 = 0;
        BOSS.lastSeries = [];                        // почали нову серію — запам'ятовуємо
        burst(BOSS.x + BOSS.w / 2, BOSS.y + BOSS.h / 2, 10, '#8f6fff', 120, 0.3, 0, 1);
      }
      break;

    /* ---- ФАЗА 3: поява за спиною з обов'язковим силуетом ---- */
    case 'blinkTel':
      BOSS.tm -= dt;
      if (Math.random() < 0.8)
        part(BOSS.tx + rnd(0, BOSS.w), BOSS.ty + rnd(0, BOSS.h), rnd(-10, 10), -24,
             0.35, '#8f6fff', 1, 0, 1);
      if (BOSS.tm <= 0) {
        burst(BOSS.x + BOSS.w / 2, BOSS.y + BOSS.h / 2, 12, '#8f6fff', 130, 0.3, 0, 1);
        BOSS.x = BOSS.tx; BOSS.y = BOSS.ty; BOSS.vy = 0;
        BOSS.tpCd = CH_TP_CD;
        BOSS.punish = CH_PUNISH;                     // вікно нагороди за реакцію
        BOSS.st = 'wind'; BOSS.tm = TEL(0.9); BOSS.tm3 = 2;   // одразу в випад
        BOSS.lastSeries = [];
        Sfx.parry(); cam.hit(3);
        ring(BOSS.x + BOSS.w / 2, BOSS.y + BOSS.h / 2, 3, 30, 0.35, '#8f6fff', 2);
      }
      break;

    /* ---- ФАЗА 2: ривок через арену зі слідом ---- */
    case 'rushTel':
      BOSS.tm -= dt;
      if (BOSS.tm <= 0) {
        BOSS.st = 'rush'; BOSS.tm = 1.4;
        BOSS.vx = sign(BOSS.tx - BOSS.x) * S(330);
        BOSS.trailT = 0;
        Sfx.dash(); cam.hit(3);
      }
      break;
    case 'rush': {
      BOSS.tm -= dt;
      moveX(BOSS, BOSS.vx * dt);
      BOSS.x = clamp(BOSS.x, BOSS.a0 + 4, BOSS.a1 - BOSS.w - 4);
      BOSS.trailT -= dt;
      if (BOSS.trailT <= 0) { BOSS.trailT = 0.06; chronoTrail(BOSS.x + BOSS.w / 2, BOSS.ground); }
      const wall = BOSS.x <= BOSS.a0 + 5 || BOSS.x >= BOSS.a1 - BOSS.w - 5;
      if (wall || BOSS.tm <= 0) {
        // Врізався в стіну — сам себе й відкрив. Пережив ривок — б'єш безкоштовно,
        // без парирування: у фазі 2 це єдине вікно, яке дається за витримку.
        BOSS.vx = -BOSS.face * S(60); BOSS.st = 'stagger'; BOSS.tm = WIN(CH_RUSH_OPEN);
        Sfx.explode(); cam.hit(5); hitStop(0.08);
        ring(BOSS.x + BOSS.w / 2, BOSS.y + BOSS.h / 2, 4, 40, 0.45, '#8f6fff', 2);
        burst(BOSS.x + BOSS.w / 2, BOSS.y + BOSS.h - 4, 14, '#8f6fff', 180, 0.5, 120, 2);
      }
      break;
    }

    /* ---- ФАЗА 2: часова копія доспівує серію за нього ---- */
    case 'echo':
      BOSS.tm -= dt;
      if (Math.random() < 0.5)
        part(BOSS.x + rnd(0, BOSS.w), BOSS.y + rnd(0, BOSS.h), rnd(-15, 15), -20,
             0.35, '#22e0ff', 1, 0, 1);
      if (BOSS.tm <= 0) { BOSS.st = 'idle'; BOSS.tm = 0.4 * RT(); }
      break;

    case 'wind':                                     // ТЕЛЕГРАФ випаду
      BOSS.tm -= dt;
      if (BOSS.tm <= 0) {
        BOSS.st = 'lunge'; BOSS.tm = 0.30; BOSS.hitDone = false;
        BOSS.vx = BOSS.face * S(250); BOSS.tm3++;
        Sfx.slash(1);
        if (!BOSS.lastSeries) BOSS.lastSeries = [];
        if (BOSS.lastSeries.length < 3)
          BOSS.lastSeries.push({ x: BOSS.x, y: BOSS.y, vx: BOSS.vx });
        if (BOSS.phase >= 2)
          GHOSTS.push({ x: BOSS.x, y: BOSS.y, vx: BOSS.vx, t: 0.30, delay: 1.2, hit: false });
        twinEcho();                                  // постійна копія повторює той самий випад
      }
      break;

    case 'lunge': {
      BOSS.tm -= dt;
      moveX(BOSS, BOSS.vx * dt);
      BOSS.x = clamp(BOSS.x, BOSS.a0 + 4, BOSS.a1 - BOSS.w - 4);
      const bx = BOSS.face > 0 ? BOSS.x + BOSS.w - Si(6) : BOSS.x - Si(22);
      const box = { x: bx, y: BOSS.y + Si(2), w: Si(30), h: Si(24) };
      if (!BOSS.hitDone && boxHit(box.x, box.y, box.w, box.h, P.x - Si(6), P.y - Si(4), P.w + Si(12), P.h + Si(8))) {
        // У фазах 1-2 захист пробиває тільки парирування. У фазі 3 щита
        // немає взагалі, тож парирування лишається бонусом, а не умовою.
        if (P.parryT > 0) {
          BOSS.hitDone = true;
          BOSS.st = 'stagger'; BOSS.tm = WIN(CH_OPEN); BOSS.vx = -BOSS.face * S(90);
          Sfx.parry(); buzz(20); cam.hit(4); hitStop(0.10);
          ring(BOSS.x + BOSS.w / 2, BOSS.y + BOSS.h / 2, 4, 34, 0.4, '#ffd23f', 2);
          bladeCharge(2);
        } else if (boxHit(box.x, box.y, box.w, box.h, P.x, P.y, P.w, P.h)) {
          BOSS.hitDone = playerHurt(1, BOSS.x + BOSS.w / 2);
        }
      }
      if (BOSS.tm <= 0) {
        BOSS.vx = 0;
        if (BOSS.tm3 < (BOSS.phase >= 3 ? 4 : 3)) { BOSS.st = 'wind'; BOSS.tm = TEL(0.81); }
        else { BOSS.st = 'idle'; BOSS.tm = 0.6 * RT(); BOSS.tm3 = 0; }
      }
      break;
    }

    case 'stagger':                                  // ВІКНО ШКОДИ
      BOSS.tm -= dt; BOSS.vx *= 0.9;
      moveX(BOSS, BOSS.vx * dt);
      if (Math.random() < 0.4)
        part(BOSS.x + rnd(0, BOSS.w), BOSS.y + rnd(0, 8), rnd(-20, 20), -25, 0.4, '#ffd23f', 1, -10, 1);
      if (BOSS.tm <= 0) { BOSS.st = 'idle'; BOSS.tm = 0.5; }
      break;
  }
  if (BOSS.st !== 'lunge' && BOSS.st !== 'rush') bossContact(1);
}

/* ---------------- БОС 4: ГЛІТЧ-ЯДРО ---------------- */
function glitchLasers() {
  const horiz = Math.random() < 0.5;
  const n = BOSS.phase === 2 ? 3 : 2;
  for (let i = 0; i < n; i++) {
    if (horiz) {
      const y = BOSS.ground - Si(20) - i * Si(46) - S(rnd(0, 14));
      telegraph(BOSS.a0, y - 2, BOSS.a1 - BOSS.a0, 5, 0.55, '#ff2e88', 2);
      setTimeoutZone(BOSS.a0, y - 2, BOSS.a1 - BOSS.a0, 5, 0.55, 0.35);
    } else {
      const x = BOSS.a0 + Si(40) + Math.random() * (BOSS.a1 - BOSS.a0 - Si(80));
      telegraph(x - 2, 16, 5, BOSS.ground - 16, 0.55, '#ff2e88', 2);
      setTimeoutZone(x - 2, 16, 5, BOSS.ground - 16, 0.55, 0.35);
    }
  }
  Sfx.charge();
}
/** ФАЗА 3 Гліч-Ядра: сітка, що їде через арену. */
function sweepGrid() {
  const y0 = BOSS.ground - Si(70);
  telegraph(BOSS.a0 + Si(10), y0, Si(8), Si(62), TEL(1.3), '#ff2e88', 2);
  PENDING.push({ x: BOSS.a0 + Si(10), y: y0, w: Si(8), h: Si(62), t: TEL(1.3), dur: 2.4, sweep: S(95) });
  telegraph(BOSS.a1 - Si(18), y0 - Si(40), Si(8), Si(62), TEL(1.3), '#ff2e88', 2);
  PENDING.push({ x: BOSS.a1 - Si(18), y: y0 - Si(40), w: Si(8), h: Si(62), t: TEL(1.3), dur: 2.4, sweep: -S(95) });
  Sfx.charge();
}
const PENDING = [];
function setTimeoutZone(x, y, w, h, delay, dur) {
  PENDING.push({ x: x, y: y, w: w, h: h, t: delay, dur: dur });
}
function updatePending(dt) {
  for (let i = PENDING.length - 1; i >= 0; i--) {
    const p = PENDING[i];
    p.t -= dt;
    if (p.t <= 0) {
      if (p.crumble !== undefined) archCrumble(p.crumble);
      else if (p.shootVX !== undefined) {
        if (p.debris) {                              // уламок зі стелі: важкий, з гравітацією
          shoot(p.x, p.y, 0, p.shootVY,
                { own: 'e', dmg: 1, col: '#c9b8dd', w: 9, h: 11, life: 1.8, grav: 620, kind: 3 });
          Sfx.explode();
        } else if (p.wave) {                         // ударна хвиля викликаного Сервотавра
          shoot(p.x, p.y, p.shootVX, 0,
                { own: 'e', dmg: 1, col: '#ffd23f', w: 12, h: 16, life: 3.2, kind: 3 });
          Sfx.explode(); cam.hit(4);
        } else if (p.bomb) {                         // бомба викликаної Матки
          shoot(p.x, p.y, 0, p.shootVY,
                { own: 'e', dmg: 1, col: '#ff6b3d', w: 8, h: 8, life: 4, grav: 300, kind: 4 });
          Sfx.shoot();
        } else {
          shoot(p.x, p.y, p.shootVX, p.shootVY,
                { own: 'e', dmg: 1, col: '#ff2e88', w: 6, h: 6, life: 3.2 });
          Sfx.shoot();
        }
      } else {
        const z = zone(p.x, p.y, p.w, p.h, p.dur, p.dmg || 1, '#ff2e88', 1);
        if (p.sweep) z.vx = p.sweep;
        Sfx.beam();
      }
      PENDING[i] = PENDING[PENDING.length - 1]; PENDING.pop();
    }
  }
}
function glitchArenaFx() {
  const r = Math.floor(rnd(0, 3));
  if (r === 0) {                                   // інверсія гравітації
    world.grav = -1; BOSS.gravT = 5.0;
    Sfx.overheat(); cam.hit(4);
      P.vy = -S(80); P.onGround = false;
  } else if (r === 1) {                            // платформи зникають
    const off = new Uint8Array(world.tw * world.th);
    for (let tx = Math.floor(BOSS.a0 / TS); tx < world.tw; tx++)
      for (let ty = 0; ty < world.th; ty++) {
        const i = ty * world.tw + tx;
        if (world.tiles[i] === T_PLAT) off[i] = 1;
      }
    world.off = off; BOSS.offT = 4.5;
    Sfx.blocked();
  } else {                                         // дублювання екрана
    BOSS.dupT = 3.4; Sfx.overheat();
  }
}
/* ================================================================
   ГЛІТЧ-ЯДРО: цикл «політ → док → вікно шкоди»

   Стара версія висіла на y=138 з хітбоксом 26 px (138..164), а вершина
   стрибка дає клинку смугу 127,9..141,9 — перетин лише 3,9 px, та ще й
   по цілі, що весь час їздила по горизонталі. Формально попасти було
   можна, практично — ні.

   Тепер ядро на час перезавантаження ПРИТИСКАЄТЬСЯ ДО СТІНИ в одній із
   трьох фіксованих точок, розкриває оболонку пелюстками (вразлива зона
   виростає з 26 до 48 px) і завмирає. Біля кожної точки є платформа,
   тож бити можна і стоячи, і зі стрибка.
   ================================================================ */
const GL_OPEN_H = Si(68);        // висота розкритої оболонки (виросла разом із босом)
const GL_WARN = 1.2;         // попередження перед приземленням
const GL_FLY = 12;           // фаза польоту
const GL_WIN = [4.0, 3.5, 3.0];   // вікно шкоди по фазах
const GL_FOLD = 0.5;         // за скільки до кінця вікна складаються пелюстки
const GL_DETACH = 0.35;      // сам відрив з ударною хвилею
const GL_CEIL = Si(32);          // стеля арени (для перевернутої гравітації)
const GL_NODES = 3;          // вузлів даних за цикл
const GL_NODE_BACK = 4.0;    // МАКСИМАЛЬНИЙ: за скільки вузол відроджується

/* Три точки кріплення. `up` — висота точки дотику над підлогою; оболонка
   розкривається ВІД підлоги, тож вразлива зона йде вгору на GL_OPEN_H.
   При перевернутій гравітації точки дзеркаляться на стелю, і зона йде
   вниз — досяжність рахується окремо (див. tests/glitch.mjs). */
const GL_DOCKS = [
  { side: 'L', up: Si(32) },     // ліва стіна
  { side: 'C', up: Si(48) },     // центральна колона
  { side: 'R', up: Si(32) }      // права стіна
];
/** Позиція й розмір ядра в точці i. */
export function glitchDockPos(i) {
  const d = GL_DOCKS[i];
  const inv = world.grav < 0;
  let x;
  if (d.side === 'L') x = BOSS.a0 + 2;
  else if (d.side === 'R') x = BOSS.a1 - BOSS.w - 2;
  else x = BOSS.colX - BOSS.w / 2;
  const base = inv ? GL_CEIL + d.up : BOSS.ground - d.up;
  return { x: x, y: inv ? base : base - GL_OPEN_H, base: base };
}
/** Наступна точка — будь-яка, крім поточної: гравець бігає, але не гадає. */
function glitchNextDock() {
  let i = Math.floor(rnd(0, GL_DOCKS.length - 0.001));
  if (i === BOSS.dockI) i = (i + 1 + Math.floor(rnd(0, 1.999))) % GL_DOCKS.length;
  return i;
}
/** Три вузли даних: збий усі — ядро йде на перезавантаження достроково. */
function glitchSpawnNodes() {
  BOSS.parts.length = 0;
  // Арену ділимо на три смуги — вузли не злипаються в купу, і гравець
  // справді пробігає арену, а не збиває всі три з однієї точки.
  const w = (BOSS.a1 - BOSS.a0 - Si(80)) / GL_NODES;
  for (let i = 0; i < GL_NODES; i++) {
    let x = 0, y = 0;
    for (let k = 0; k < 14; k++) {                   // місце без тайла під ним
      x = BOSS.a0 + Si(40) + i * w + rnd(Si(4), w - Si(14));
      y = BOSS.ground - Si(28) - S(rnd(0, 56));             // у межах стрибка й пострілу
      if (!rectSolid(x - 2, y - 2, 14, 14)) break;
    }
    // 1 HP: вузол — це вимикач, а не ворог. Будь-яке влучання будь-чим
    // гасить його, і дальній зброї не доводиться палити на них тепло.
    BOSS.parts.push({ id: i + 1, x: x, y: y, w: Si(10), h: Si(10),
                      hp: 5, maxHp: 5, alive: true, flash: 0, kind: 'dnode',
                      ph: rnd(0, 6.28) });
  }
  BOSS.nodesDone = false;
}
/** Усі вузли збито — форсуємо перезавантаження. */
function glitchNodesLeft() {
  let n = 0;
  for (let i = 0; i < BOSS.parts.length; i++) if (BOSS.parts[i].alive) n++;
  return n;
}

function bossGlitch(dt) {
  if (BOSS.gravT > 0 && BOSS.st === 'fly') {         // у доці таймер стоїть:
    BOSS.gravT -= dt;                                // інверсія не має перевернутись
  if (BOSS.gravT <= 0) { world.grav = 1; P.vy = S(40); }
  }
  if (BOSS.offT > 0) { BOSS.offT -= dt; if (BOSS.offT <= 0) world.off = null; }
  if (BOSS.dupT > 0) BOSS.dupT -= dt;
  for (let i = 0; i < BOSS.parts.length; i++) if (BOSS.parts[i].flash > 0) BOSS.parts[i].flash -= dt;

  /* МАКСИМАЛЬНИЙ: вузли даних відроджуються. Таймер іде НЕЗАЛЕЖНО від
     фази боса: вузли збивають під час польоту, і саме там вони мають
     повертатись — інакше їх можна знімати по одному за цикл, а сенс
     був у тому, щоб зняти всі три за один захід.
     Заводиться він тут, а не в місці смерті вузла: вузол може згаснути
     й від вибуху поруч, і від чита — повертатись має однаково. */
  if (DIFF.extra) for (let i = 0; i < BOSS.parts.length; i++) {
    const nd = BOSS.parts[i];
    if (nd.alive) { nd.respawn = 0; continue; }
    if (!nd.respawn) { nd.respawn = GL_NODE_BACK; continue; }
    nd.respawn -= dt;
    if (nd.respawn <= 0) {
      nd.alive = true; nd.hp = nd.maxHp; nd.respawn = 0; nd.flash = 0.3;
      ring(nd.x + nd.w / 2, nd.y + nd.h / 2, 2, 20, 0.35, '#00ffcc', 2);
    }
  }

  BOSS.tm -= dt;
  switch (BOSS.st) {

    /* ---- ПОЛІТ: ядро недосяжне, це фаза виживання ---- */
    case 'fly': {
      BOSS.x = BOSS.cx - BOSS.w / 2 + Math.sin(BOSS.anim * 0.45) * Si(96);
      BOSS.y = lerp(BOSS.y, Si(78) + Math.cos(BOSS.anim * 0.75) * Si(30), clamp(dt * 4, 0, 1));
      BOSS.h = BOSS.def.h;
      // атаки й пастки арени
      BOSS.tm2 -= dt;
      if (BOSS.tm2 <= 0) {
        BOSS.tm2 = (BOSS.phase >= 3 ? 2.2 : BOSS.phase === 2 ? 2.8 : 3.8) * RT();
        if (BOSS.phase >= 3 && !dropped('sweep')) sweepGrid(); else glitchLasers();
      }
      BOSS.tm3 -= dt;
      // ЛЕГКИЙ: пастки САМОЇ арени вимкнені — інверсія гравітації й збій
      // екрана. Атаки боса (лазери) лишаються: вони з телеграфом, і
      // прибирати їх усі означало б прибрати бій, а не складність.
      if (BOSS.tm3 <= 0) { BOSS.tm3 = BOSS.phase === 2 ? 6.0 : 8.0; if (DIFF.hazard) glitchArenaFx(); }
      // достроково — коли гравець збив усі три вузли
      if (!BOSS.nodesDone && glitchNodesLeft() === 0) {
        BOSS.nodesDone = true;
        BOSS.tm = Math.min(BOSS.tm, 0.25);
        Sfx.parry(); cam.hit(2);
      }
      if (BOSS.tm <= 0) {                            // час — заходимо на посадку
        BOSS.dockI = glitchNextDock();
        BOSS.st = 'warn'; BOSS.tm = GL_WARN;
        Sfx.overheat(); cam.hit(3);                  // техніка, що вимикається
        ZONES.length = 0; TELE.length = 0; PENDING.length = 0;
      }
      bossContact(1);
      break;
    }

    /* ---- ПОПЕРЕДЖЕННЯ: точка світиться, від ядра до неї тягнеться кабель ---- */
    case 'warn': {
      const d = glitchDockPos(BOSS.dockI);
      const k = 1 - clamp(BOSS.tm / GL_WARN, 0, 1);
      BOSS.x = lerp(BOSS.x, d.x, clamp(dt * 3.2, 0, 1));
      BOSS.y = lerp(BOSS.y, d.y, clamp(dt * 3.2, 0, 1));
      if (Math.random() < 0.5) cam.hit(0.8);         // екран коротко смикається
      if (Math.random() < 0.4)
        part(BOSS.x + rnd(0, BOSS.w), BOSS.y + rnd(0, BOSS.h), rnd(-30, 30), rnd(-30, 30),
             0.3, '#00ffcc', 1, 0, 1);
      if (BOSS.tm <= 0) {
        BOSS.st = 'dock';
        BOSS.tm = WIN(GL_WIN[Math.min(2, BOSS.phase - 1)]);
        BOSS.x = d.x; BOSS.y = d.y; BOSS.h = GL_OPEN_H;
        // Штатно вікно — чесна пауза: пастки геть, ворогів геть.
        // На МАКСИМАЛЬНОМУ арена не вимикається: бити треба МІЖ лазерами,
        // і вікно перестає бути безпечним місцем.
        BOSS.dupT = 0;
        if (DIFF.hazard && DIFF.extra) { BOSS.hazT = 1.1; }
        else { world.off = null; BOSS.offT = 0; ZONES.length = 0; TELE.length = 0; PENDING.length = 0; }
        for (let i = 0; i < ENEM.length; i++) if (ENEM[i].fromBoss) ENEM[i].dead = true;
        Sfx.discharge(); cam.hit(5);
        ring(BOSS.x + BOSS.w / 2, d.base, 4, 54, 0.5, '#ffffff', 3);
        burst(BOSS.x + BOSS.w / 2, d.base, 14, '#00ffcc', 150, 0.5, 0, 1);
      }
      break;
    }

    /* ---- ВІКНО ШКОДИ: оболонка розкрита, ядро не атакує взагалі ---- */
    case 'dock': {
      const d = glitchDockPos(BOSS.dockI);
      BOSS.x = d.x; BOSS.y = d.y;                    // завмерло: ціль нерухома
      BOSS.dockBack = BOSS.tm;                       // скільки вікна лишилось
      // МАКСИМАЛЬНИЙ: арена не засинає. Лазери йдуть і далі, з тим самим
      // телеграфом, — вікно шкоди стає вікном МІЖ лазерами.
      if (DIFF.extra && BOSS.hazT !== undefined) {
        BOSS.hazT -= dt;
        if (BOSS.hazT <= 0) { BOSS.hazT = 1.6; glitchLasers(); }
      }
      if (Math.random() < 0.6)
        part(BOSS.x + BOSS.w / 2 + rnd(-8, 8), BOSS.y + rnd(0, GL_OPEN_H),
             rnd(-30, 30), rnd(-30, 30), 0.3, '#ffffff', 1, 0, 1);
      if (BOSS.tm <= GL_FOLD && !BOSS.foldT) {       // ТЕЛЕГРАФ відриву
        BOSS.foldT = 1; Sfx.charge();
      }
      if (BOSS.tm <= 0) {
        BOSS.st = 'detach'; BOSS.tm = GL_DETACH; BOSS.foldT = 0;
        BOSS.h = BOSS.def.h;
        glitchShockwave(d);
      }
      break;                                          // жодного bossContact
    }

    /* ---- ВІДРИВ: ударна хвиля вже пішла, ядро злітає ---- */
    case 'detach': {
      BOSS.y = lerp(BOSS.y, Si(world.grav < 0 ? 150 : 78), clamp(dt * 5, 0, 1));
      if (BOSS.tm <= 0) {
        BOSS.st = 'fly';
        BOSS.tm = GL_FLY;
        BOSS.tm2 = 1.2; BOSS.tm3 = 3.0;
        BOSS.dockBack = 0;
        glitchSpawnNodes();                           // вузли — у нових місцях
      }
      break;
    }

    /* ---- 'phase': bossCheckPhase() бере паузу на 0,9 с при зміні фази ----
       Вікно шкоди від цього пропадати не повинно — дочекались і повернули
       героєві рівно той залишок вікна, який був. */
    default: {
      if (BOSS.dockBack > 0) {
        const d = glitchDockPos(BOSS.dockI);
        BOSS.x = d.x; BOSS.y = d.y; BOSS.h = GL_OPEN_H;
      }
      if (BOSS.tm <= 0) {
        if (BOSS.dockBack > 0.2) { BOSS.st = 'dock'; BOSS.tm = BOSS.dockBack; }
        else {
          BOSS.st = 'fly'; BOSS.tm = GL_FLY; BOSS.tm2 = 1.2; BOSS.tm3 = 3.0;
          BOSS.h = BOSS.def.h; BOSS.dockBack = 0;
          glitchSpawnNodes();
        }
      }
      break;
    }
  }
}
/** Відрив від стіни: кільце, що відкидає гравця. Шкоди не завдає — це поштовх. */
function glitchShockwave(d) {
  const cx = BOSS.x + BOSS.w / 2, cy = d.base;
  Sfx.explode(); cam.hit(6); buzz(24);
  ring(cx, cy, 6, 92, 0.55, '#ffffff', 3);
  burst(cx, cy, 22, '#00ffcc', 210, 0.6, 40, 2);
  const dx = (P.x + P.w / 2) - cx, dy = (P.y + P.h / 2) - cy;
  const dist = Math.hypot(dx, dy);
  if (dist < S(110)) {
    const k = 1 - dist / S(110);
    P.vx += sign(dx || 1) * S(250) * k;
      P.vy -= S(150) * k * world.grav;
    P.onGround = false; P.ride = null;
  }
}

/* ---------------- БОС 5: АРХІТЕКТОР (3 фази) ---------------- */
function bossArchPhase2() {
  BOSS.phase = 2; BOSS.inv = 1.2; BOSS.st = 'orbit'; BOSS.tm = 1.2;
  BOSS.parts.length = 0;
  for (let i = 0; i < 3; i++)
    BOSS.parts.push({ id: i + 1, x: BOSS.cx, y: Si(110), w: Si(16), h: Si(16), hp: 80, maxHp: 80,
                      alive: true, flash: 0, kind: 'core', ang: i * Math.PI * 2 / 3, tm: rnd(0.5, 2) });
  Sfx.bossIn(); cam.hit(7);
  ring(BOSS.x + BOSS.w / 2, BOSS.y + BOSS.h / 2, 6, 90, 0.8, '#22e0ff', 3);
  burst(BOSS.x + BOSS.w / 2, BOSS.y + BOSS.h / 2, 30, '#22e0ff', 220, 0.8, 30, 2);
}
function bossArchPhase3() {
  BOSS.phase = 3; BOSS.inv = 1.4; BOSS.st = 'head'; BOSS.tm = 1.4;
  BOSS.parts.length = 0;
  BOSS.w = Si(60); BOSS.h = Si(52);
  BOSS.x = BOSS.a1 - Si(84); BOSS.y = BOSS.ground - BOSS.h - Si(26);
  BOSS.crumble = 0; BOSS.crumbleStep = 0;
  Sfx.bossIn(); cam.hit(9);
  burst(BOSS.x + BOSS.w / 2, BOSS.y + BOSS.h / 2, 34, '#ff2e88', 240, 0.9, 30, 2);
}
// Арена руйнується: щоразу зникає пара колонок підлоги (з попередженням).
const CRUMBLE = [[5, 2], [11, 2], [17, 2], [23, 2]];
function archCrumble(step) {
  if (step >= CRUMBLE.length) return;
  const t0 = Math.floor(BOSS.a0 / TS) + CRUMBLE[step][0], n = CRUMBLE[step][1];
  if (!world.off) world.off = new Uint8Array(world.tw * world.th);
  for (let i = 0; i < n; i++) {
    const tx = t0 + i;
    for (let ty = 0; ty < world.th; ty++) {
      const idx = ty * world.tw + tx;
      if (world.tiles[idx] === T_SOLID || world.tiles[idx] === T_PLAT) world.off[idx] = 1;
    }
    for (let k = 0; k < 10; k++)
      part(tx * TS + rnd(0, TS), BOSS.ground + rnd(0, 20), rnd(-40, 40), rnd(-60, 40),
           rnd(0.4, 0.9), '#7b2fbe', 2, 260, 1);
  }
  cam.hit(5); Sfx.explode();
}
/* МАКСИМАЛЬНИЙ, фаза 3: Архітектор по черзі викликає ослаблені копії
   чотирьох попередніх босів — по ОДНОМУ патерну від кожного. Це не
   чотири боси в одному бою: копія не має ні HP, ні ІІ, вона робить рівно
   один свій прийом і зникає. Порядок фіксований, тож фінал читається як
   переказ пройденого, а не як лотерея. */
const ARCH_CALL = ['servotaur', 'queen', 'chrono', 'glitch'];
function archSummon() {
  const who = ARCH_CALL[(BOSS.callI || 0) % ARCH_CALL.length];
  BOSS.callI = (BOSS.callI || 0) + 1;
  const gy = BOSS.ground;
  const px = clamp(P.x, BOSS.a0 + Si(30), BOSS.a1 - Si(30));
  // Кожен виклик починається з силуета-передвісника: хто саме прийшов,
  // видно за 0,8 с до удару.
  const tel = TEL(1.6);
  Sfx.bossIn(); cam.hit(4);
  ring(px, gy - Si(30), 4, 46, 0.5, '#7b2fbe', 3);
  if (who === 'servotaur') {                         // ударна хвиля по підлозі
    telegraph(BOSS.a0 + Si(6), gy - Si(14), BOSS.a1 - BOSS.a0 - Si(12), Si(14), tel, '#ffd23f', 1);
    PENDING.push({ x: px, y: gy - Si(9), w: 0, h: 0, t: tel, dur: 0,
                   shootVX: -S(150), shootVY: 0, wave: 1 });
    PENDING.push({ x: px, y: gy - Si(9), w: 0, h: 0, t: tel, dur: 0,
                   shootVX: S(150), shootVY: 0, wave: 1 });
  } else if (who === 'queen') {                      // бомба з тінню під нею
    telegraph(P.x - Si(12), gy - Si(4), P.w + Si(24), Si(4), tel, '#ff6b3d', 1);
    PENDING.push({ x: P.x + P.w / 2, y: Si(40), w: 0, h: 0, t: tel, dur: 0,
                   shootVX: 0, shootVY: S(40), bomb: 1 });
  } else if (who === 'chrono') {                     // один випад часової копії
    const side = P.x < BOSS.cx ? 1 : -1;
    const sx = clamp(P.x - side * Si(70), BOSS.a0 + Si(8), BOSS.a1 - Si(28));
    telegraph(sx - Si(6), gy - Si(34), Si(30), Si(30), tel, '#8f6fff', 2);
    GHOSTS.push({ x: sx, y: gy - Si(33), vx: side * S(250), t: 0.45, delay: tel, hit: false });
  } else {                                           // гліч: пара лазерів
    const y0 = gy - Si(62);
    for (const d of [-1, 1]) {
      const x = px + d * Si(48);
      telegraph(x, y0, Si(8), Si(58), tel, '#00ffcc', 2);
      PENDING.push({ x: x, y: y0, w: Si(8), h: Si(58), t: tel, dur: 1.4, dmg: 1 });
    }
  }
}

function bossArchitect(dt) {
  if (BOSS.phase === 1) {
    const gy = BOSS.ground - BOSS.h - 4;
    BOSS.y = gy + Math.sin(BOSS.anim * 1.6) * 4;
    BOSS.face = sign((P.x + P.w / 2) - (BOSS.x + BOSS.w / 2)) || BOSS.face;
    switch (BOSS.st) {
      case 'idle': {
      BOSS.vx = BOSS.face * S(34);
        moveX(BOSS, BOSS.vx * dt);
        BOSS.x = clamp(BOSS.x, BOSS.a0 + 6, BOSS.a1 - BOSS.w - 6);
        BOSS.tm -= dt;
        if (BOSS.tm <= 0) {
          if (!dropped('dash') && Math.random() < 0.35) { BOSS.st = 'dashTel'; BOSS.tm = TEL(1.9); }
          else { BOSS.st = 'aimTel'; BOSS.tm = TEL(1.6); }
        }
        break;
      }
      case 'aimTel':                                // ТЕЛЕГРАФ залпу
        BOSS.vx = 0; BOSS.tm -= dt;
        if (Math.random() < 0.6)
          part(BOSS.x + BOSS.w / 2 + BOSS.face * 10, BOSS.y + 12, rnd(-20, 20), rnd(-20, 20),
               0.25, '#22e0ff', 1, 0, 1);
        if (BOSS.tm <= 0) {
          BOSS.st = 'idle'; BOSS.tm = 1.1;
          const sx = BOSS.x + BOSS.w / 2 + BOSS.face * Si(10), sy = BOSS.y + Si(12);
          for (let i = -1; i <= 1; i++)
            shoot(sx, sy, BOSS.face * S(135), i * S(52), { own: 'e', dmg: 1, col: '#22e0ff', w: 6, h: 5, life: 3 });
          Sfx.shoot();
        }
        break;
      case 'dashTel':                               // ТЕЛЕГРАФ ривка
        BOSS.vx = 0; BOSS.tm -= dt;
        telegraph(BOSS.face > 0 ? BOSS.x : BOSS.a0, BOSS.y, BOSS.face > 0 ? BOSS.a1 - BOSS.x : BOSS.x - BOSS.a0,
                  BOSS.h, 0.06, '#ff2e88', 1);
      if (BOSS.tm <= 0) { BOSS.st = 'dash'; BOSS.tm = 1.1; BOSS.vx = BOSS.face * S(210); Sfx.dash(); }
        break;
      case 'dash':
        BOSS.tm -= dt;
        moveX(BOSS, BOSS.vx * dt);
        if (BOSS.x <= BOSS.a0 + 6 || BOSS.x + BOSS.w >= BOSS.a1 - 6 || BOSS.tm <= 0) {
          BOSS.x = clamp(BOSS.x, BOSS.a0 + 6, BOSS.a1 - BOSS.w - 6);
          BOSS.st = 'idle'; BOSS.tm = 0.8; BOSS.vx = 0;
        }
        if (boxHit(BOSS.x, BOSS.y, BOSS.w, BOSS.h, P.x, P.y, P.w, P.h)) playerHurt(1, BOSS.x + BOSS.w / 2);
        break;
      case 'phase': BOSS.tm -= dt; if (BOSS.tm <= 0) { BOSS.st = 'idle'; BOSS.tm = 0.6; } break;
    }
    if (BOSS.st !== 'dash') bossContact(1);

  } else if (BOSS.phase === 2) {
    // Три орбітальні ядра — тіло невразливе.
    BOSS.tm -= dt;
    let aliveN = 0;
    for (let i = 0; i < BOSS.parts.length; i++) {
      const c = BOSS.parts[i];
      if (c.flash > 0) c.flash -= dt;
      if (!c.alive) continue;
      aliveN++;
      c.ang += dt * 0.85;
      c.x = BOSS.cx - Si(8) + Math.cos(c.ang) * Si(78);
      c.y = Si(132 - 8) + Math.sin(c.ang) * Si(44);
      c.tm -= dt;
      if (c.tm <= 0 && BOSS.tm <= 0) {
        c.tm = 2.6; BOSS.tm = 0.7;
        const dx = (P.x + P.w / 2) - (c.x + c.w / 2), dy = (P.y + P.h / 2) - (c.y + c.h / 2);
        const L = Math.max(1, Math.hypot(dx, dy));
        telegraph(c.x - 1, c.y - 1, 18, 18, 0.45, '#ff2e88', 1);
        const vx = dx / L * S(150), vy = dy / L * S(150);
        PENDING.push({ x: c.x + 8, y: c.y + 8, w: 0, h: 0, t: 0.45, dur: 0, shootVX: vx, shootVY: vy });
      }
      if (Math.random() < 0.08)
        part(c.x + rnd(0, c.w), c.y + rnd(0, c.h), rnd(-20, 20), rnd(-20, 20), 0.3, '#22e0ff', 1, 0, 1);
    }
    BOSS.x = BOSS.cx - BOSS.w / 2; BOSS.y = Si(124);
    if (aliveN === 0 && BOSS.phase === 2) bossArchPhase3();

  } else {
    // Фаза 3: велетенська голова + арена, що руйнується.
    BOSS.y = BOSS.ground - BOSS.h - Si(26) + Math.sin(BOSS.anim * 1.1) * Si(3);
    BOSS.crumble = (BOSS.crumble || 0) - dt;
    // ЛЕГКИЙ: арена не обвалюється — бій іде на цілій підлозі.
    if (DIFF.hazard && BOSS.crumble <= 0 && (BOSS.crumbleStep || 0) < CRUMBLE.length) {
      BOSS.crumble = 6.0;
      const st = BOSS.crumbleStep || 0;
      const tx0 = (Math.floor(BOSS.a0 / TS) + CRUMBLE[st][0]) * TS;
      telegraph(tx0, BOSS.ground, CRUMBLE[st][1] * TS, 40, 0.9, '#ff2e88', 1);
      PENDING.push({ x: 0, y: 0, w: 0, h: 0, t: 0.9, dur: 0, crumble: st });
      BOSS.crumbleStep = st + 1;
    }
    BOSS.tm -= dt;
    if (BOSS.tm <= 0) {
      const r = Math.random();
      if (r < 0.22) {                                // ФАЗА 3: падаючі уламки арени
        BOSS.tm = 3.0 * RT();
        for (let i = 0; i < 4; i++) {
          const x = BOSS.a0 + Si(30) + Math.random() * (BOSS.a1 - BOSS.a0 - Si(60));
          telegraph(x - Si(10), 0, Si(20), BOSS.ground, TEL(2.2), '#ff2e88', 1);
          PENDING.push({ x: x - Si(10), y: BOSS.ground - Si(30), w: Si(20), h: Si(30), t: TEL(2.2) + i * 0.18, dur: 0.5, dmg: 2 });
        }
        Sfx.charge();
      } else if (r < 0.5) {                          // променевий замах
        BOSS.tm = 3.4;
        const y0 = BOSS.ground - Si(60);
        telegraph(BOSS.a0 + Si(8), y0, BOSS.a1 - BOSS.a0 - Si(16), Si(56), TEL(1.9), '#ff2e88', 2);
        PENDING.push({ x: BOSS.a0 + Si(8), y: y0, w: Si(10), h: Si(56), t: TEL(1.9), dur: 1.9, sweep: S(78) });
      } else if (r < 0.72) {                         // ударні хвилі по землі
        BOSS.tm = 2.8 * RT();
        cam.hit(4); Sfx.explode();
        for (const d of [-1, 1])
          shoot(BOSS.x + BOSS.w / 2, BOSS.ground - Si(9), d * S(145), 0,
                { own: 'e', dmg: 1, col: '#ffd23f', w: 12, h: 16, life: 3.4, kind: 3 });
      } else if (DIFF.extra) {                       // МАКСИМАЛЬНИЙ: виклик попередника
        BOSS.tm = 4.6 * RT();
        archSummon();
      } else {                                       // виклик рою
        BOSS.tm = 4.2 * RT();
        if (BOSS.spawned < 3) {
          const e = spawnEnemy('wasp', BOSS.x + 10, BOSS.y + 20, true);
          if (e) { e.fromBoss = true; e.hy = Si(70); BOSS.spawned++; }
        }
      }
    }
    bossContact(1);
  }
}

/* ---------------- диспетчер босів ---------------- */
function updateBoss(dt) {
  if (!BOSS.on) return;
  BOSS.anim += dt;
  if (BOSS.flash > 0) BOSS.flash -= dt;
  if (BOSS.nameT > 0) BOSS.nameT -= dt;
  if (BOSS.intro <= 0 && BOSS.st !== 'die') { BOSS.fightT += dt; rageCheck(); }
  if (BOSS.inv > 0 && BOSS.st !== 'die') BOSS.inv -= dt;
  P.x = clamp(P.x, BOSS.a0 + 2, BOSS.a1 - P.w - 2);
  if (BOSS.silence > 0) {
    BOSS.silence -= dt;
    if (Math.random() < 0.4)
      part(BOSS.x + rnd(0, BOSS.w), BOSS.y + rnd(0, BOSS.h), rnd(-30, 30), rnd(-30, 30), 0.3, '#00ffcc', 1, 0, 1);
    return;
  }
  if (BOSS.intro > 0) {
    BOSS.intro -= dt;
    if (Math.random() < 0.3)
      part(BOSS.x + rnd(0, BOSS.w), BOSS.y + rnd(0, BOSS.h), rnd(-30, 30), rnd(-30, 30),
           0.4, '#ff2e88', 1, 0, 1);
    return;
  }
  if (BOSS.st === 'die') {
    BOSS.dieT -= dt;
    if (Math.random() < 0.5) {
      const x = BOSS.x + rnd(0, BOSS.w), y = BOSS.y + rnd(0, BOSS.h);
      burst(x, y, 6, Math.random() < 0.5 ? '#ffd23f' : '#ff2e88', 150, 0.5, 120, 2);
      if (Math.random() < 0.25) { ring(x, y, 2, 22, 0.35, '#ffffff', 2); cam.hit(3); Sfx.explode(); }
    }
    if (BOSS.dieT <= 0) finishBoss();
    return;
  }
  switch (BOSS.type) {
    case 'servotaur': bossServotaur(dt); break;
    case 'queen': bossQueen(dt); break;
    case 'chrono': bossChrono(dt); break;
    case 'glitch': bossGlitch(dt); break;
    case 'architect': bossArchitect(dt); break;
  }
}
function finishBoss() {
  BOSS.on = false; BOSS.done = true;
  playCut('post', () => { });
  world.exitOpen = true; world.grav = 1; world.off = null;
  cam.lockX0 = -1; cam.lockX1 = -1;
  for (let i = 0; i < ENEM.length; i++) if (ENEM[i].fromBoss) ENEM[i].dead = true;
  ZONES.length = 0; PENDING.length = 0; GHOSTS.length = 0;
  Music.set(world.theme);
  Sfx.win(); buzz([30, 50, 30]);
  ring(BOSS.x + BOSS.w / 2, BOSS.y + BOSS.h / 2, 8, 140, 1.0, '#ffd23f', 3);
}


const WEATHER = [];
function buildBackground() {
  const th = THEME[world.theme] || THEME.slum;
  const R = mulberry(9001 + world.idx * 104729);
  world.bg = [];
  const W = world.pw;
  // далекий шар — силуети веж/конструкцій
  for (let x = -Si(40); x < W + Si(40); x += Si(22 + Math.floor(R() * 26))) {
    const h = Si(40 + R() * 110), w = Si(14 + R() * 26);
    world.bg.push({ l: 0, x: x, y: Si(200) - h, w: w, h: h + Si(90), c: th.far, n: R() });
  }
  for (let x = -Si(30); x < W + Si(30); x += Si(30 + Math.floor(R() * 34))) {
    const h = Si(30 + R() * 70), w = Si(18 + R() * 30);
    world.bg.push({ l: 1, x: x, y: Si(214) - h, w: w, h: h + Si(80), c: th.mid, n: R() });
  }
  // неонові вивіски
  for (let x = Si(20); x < W; x += Si(70 + Math.floor(R() * 90))) {
    world.bg.push({ l: 2, x: x, y: Si(40 + R() * 90), w: Si(4 + R() * 5), h: Si(12 + R() * 30),
                    c: R() < 0.5 ? th.edge : th.glow, n: R(), sign: true });
  }
  WEATHER.length = 0;
  const n = th.fx === 'rain' ? 90 : 46;
  for (let i = 0; i < n; i++)
    WEATHER.push({ x: Math.random() * VW, y: Math.random() * VH, v: rnd(0.5, 1.5), p: Math.random() });
}
function updateWeather(dt) {
  const th = THEME[world.theme] || THEME.slum;
  for (let i = 0; i < WEATHER.length; i++) {
    const w = WEATHER[i];
    switch (th.fx) {
      case 'rain': w.y += S(520 + w.v * 260) * dt; w.x -= S(90) * dt; break;
      case 'petal': w.y += S(26 + w.v * 22) * dt; w.x += Math.sin((world.time + w.p * 6) * 1.6) * S(22) * dt; break;
      case 'dust': w.y += S(10 + w.v * 14) * dt; w.x += Math.sin((world.time + w.p * 9) * 0.7) * S(10) * dt; break;
      case 'spark': w.y -= S(40 + w.v * 60) * dt; w.x += Math.sin((world.time + w.p * 5) * 3) * S(16) * dt; break;
      case 'ember': w.y -= S(30 + w.v * 50) * dt; w.x += Math.sin((world.time + w.p * 4) * 2) * S(14) * dt; break;
      case 'steam': w.y -= S(20 + w.v * 30) * dt; break;
      case 'wind': w.x -= S(180 + w.v * 200) * dt; break;
      case 'glitch': w.p += dt * 0.9; if (w.p > 1) { w.p = 0; w.y = Math.random() * VH; w.x = Math.random() * VW; } break;
    }
    if (w.y > VH + 4) { w.y = -4; w.x = Math.random() * VW; }
    if (w.y < -4) { w.y = VH + 4; w.x = Math.random() * VW; }
    if (w.x < -6) w.x = VW + 4;
    if (w.x > VW + 6) w.x = -4;
  }
}

/* =============================================== НАВЧАННЯ Й ТРЕНУВАННЯ
   Драйвер живе в tutorial.js і нічого не знає про цей файл; сюди
   приходить лише набір дрібних функцій, якими він читає стан і малює
   підказку. Так навчання перевіряється тестом без запуску всієї гри. */
const TUTFX = { hint: null, gate: 0, say: '', sayT: 0, drill: null };
export const Tut = makeTutorial({
  state() {
    return {
      px: P.x, spawnX: world.spawn.x, tile: TS, jumps: P.jumps,
      cpTaken: Game.cpTaken, level: Game.level, state: Game.state,
      // Навчання живе в перших трьох екранах сектора, далі не лізе.
      tutorSpan: Math.min(world.pw - TS * 4, VW * 3)
    };
  },
  hint(step, pos) { TUTFX.hint = { step: step, x: pos.x, y: pos.y }; },
  clearHint() { TUTFX.hint = null; },
  hintPos() { return { x: P.x + P.w / 2, y: P.y - Si(30) }; },
  gate(x) { TUTFX.gate = x || 0; },
  say(t) { TUTFX.say = t; TUTFX.sayT = 4.0; },
  ding() { Sfx.pickup(); },
  seen(id) {
    if (Store.data.tutSeen.indexOf(id) < 0) { Store.data.tutSeen.push(id); Store.save(); }
  },
  seenHas(id) { return Store.data.tutSeen.indexOf(id) >= 0; },
  setSeen(a) { Store.data.tutSeen = a; Store.save(); },
  markDone() { Store.data.tutDone = 1; Store.save(); },
  startLevel(i, cp) { Game.startLevel(i, cp); },
  startParryDrill() { spawnParryDummy(); },
  endParryDrill() {
    if (TUTFX.drill) { TUTFX.drill.dead = true; TUTFX.drill = null; }
    TUTFX.gate = 0;
  }
});

/* ---------------------------------------------- ТРЕНУВАЛЬНА КІМНАТА
   Порожній відрізок сектора 1 (там рівна підлога й немає механік),
   на ньому — чотири манекени з різним HP і один стрілець. Уся зброя
   тимчасово розблокована: сенс кімнати саме в тому, щоб порівняти.
   Прогрес не чіпається — `owned` підміняється лише в пам'яті. */
const RANGE = { on: false, dmg: 0, t: 0, last: 0, owned: null, melee: null, ranged: null };
const RANGE_HP = [50, 150, 400, 1200];

function rangeEnter() {
  Game.startLevel(0, false);
  RANGE.on = true; RANGE.dmg = 0; RANGE.t = 0; RANGE.last = 0;
  // Зброя: підміняємо СПИСОК у пам'яті, у сховище нічого не пишемо.
  RANGE.owned = Store.data.owned.slice();
  RANGE.melee = Store.data.melee; RANGE.ranged = Store.data.ranged;
  Store.data.owned = Object.keys(WEAPONS);
  refreshEquip();
  clearEntities();
  LFX.on = false; LFX.chal = null;
  const gy = 12 * TS;
  const x0 = world.spawn.x + Si(70);
  for (let i = 0; i < RANGE_HP.length; i++) {
    const e = spawnEnemy('thug', x0 + i * Si(54), gy - Si(34), false);
    if (!e) continue;
    e.dummy = 'target'; e.hp = e.maxHp = RANGE_HP[i]; e.sp = 0;
  }
  const sh = spawnEnemy('turret', x0 + Si(4 * 54), gy - Si(22), false);
  if (sh) { sh.dummy = 'parry'; sh.hp = sh.maxHp = 9999; sh.tm = 0.9; sh.ang = 0; }
  P.x = world.spawn.x; P.y = gy - P.h;
  Game.pickupName = 'ТРЕНУВАЛЬНА КІМНАТА'; Game.pickupT = 3.0;
}
/** Вихід із кімнати повертає справжній арсенал. */
function rangeLeave() {
  if (!RANGE.on) return;
  RANGE.on = false;
  if (RANGE.owned) { Store.data.owned = RANGE.owned; Store.data.melee = RANGE.melee; Store.data.ranged = RANGE.ranged; }
  RANGE.owned = null;
  refreshEquip();
}
/** Лічильник шкоди: сума за останні 2 с, щоб було видно саме темп. */
function rangeHit(dmg) {
  if (!RANGE.on) return;
  RANGE.dmg += dmg; RANGE.last = 2.0;
}
function rangeUpdate(dt) {
  if (!RANGE.on) return;
  RANGE.t += dt;
  if (RANGE.last > 0) { RANGE.last -= dt; if (RANGE.last <= 0) { RANGE.dmg = 0; RANGE.t = 0; } }
  // HP манекена повертається через секунду без влучань: смужка показує
  // урон за підхід, а не суму за весь час у кімнаті.
  for (let i = 0; i < ENEM.length; i++) {
    const e = ENEM[i];
    if (e.dummy !== 'target') continue;
    e.back = (e.back || 0) - dt;
    if (e.back <= 0 && e.hp < e.maxHp) { e.hp = e.maxHp; e.back = 1.0; }
    if (e.flash > 0) e.back = 1.0;
  }
}
export function rangeState() { return RANGE; }

/* Тренувальний ворог для парирування: стоїть на місці й пускає ПОВІЛЬНІ
   кулі по колу. Повільні — щоб вікно читалось оком, по колу — щоб
   спроба була щосекунди, а не раз на підхід. Шкоди він не завдає
   контактом і сам не рухається: єдине, що тут можна робити, — вчитись. */
function spawnParryDummy() {
  const x = P.x + Si(90), y = 12 * TS - Si(22);
  const e = spawnEnemy('turret', x, y, false);
  if (!e) return;
  e.dummy = 'parry'; e.hp = e.maxHp = 9999; e.tm = 0.9; e.ang = 0;
  TUTFX.drill = e;
}
/** Манекен: або нерухома мішень, або стрілець для парирування. */
function dummyUpdate(e, dt) {
  e.anim += dt;
  e.vx = 0; e.vy = 0;
  if (!ETYPE[e.t].fly) groundPhys(e, dt);
  if (e.dummy === 'parry') parryDummyUpdate(e, dt);
}
/** Оновлення тренувального ворога: коло повільних куль. */
function parryDummyUpdate(e, dt) {
  e.tm -= dt;
  if (e.tm > 0) return;
  e.tm = 1.15;
  e.ang = (e.ang || 0) + 0.7;
  const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
  for (let i = 0; i < 4; i++) {
    const a = e.ang + i * Math.PI / 2;
    // Позначка ставиться на вже створеній кулі: shoot() свідомо копіює
    // лише відомі йому поля, щоб у кулях не заводилось випадкового сміття.
    const b = shoot(cx, cy, Math.cos(a) * S(52), Math.sin(a) * S(52),
                    { own: 'e', dmg: 1, col: '#ff6b3d', w: 7, h: 7, life: 4.5 });
    b.drill = 1;
  }
  Sfx.shoot();
}

const Game = {
  state: 'menu', level: 0, introT: 0, cpTaken: false, cpIndex: 0, backTo: 'menu',
  pickupName: '', pickupT: 0, assembleT: 0, reward: null,
  assist: false, assistAsked: false, bossDeaths: 0, bossDeathLvl: -1, diedAtBoss: -1, cutT: false,
  combat: false,

  /* Навчання: з меню — окремим пунктом, з першого запуску — питанням.
     Воно НЕ окремий рівень: це сектор 1 зі своїми підказками, тож
     пройти навчання й пройти перший сектор — одна й та сама дія. */
  startTutorial() {
    this.range = false;
    Tut.start(true);
  },

  /* Тренувальна кімната: доступна завжди, ні на що не впливає.
     Манекени з різним HP, манекен-стрілець для парирування, уся зброя
     розблокована на час тренування, лічильник шкоди на екрані. */
  startRange() {
    this.range = true;
    Tut.stop(false);
    rangeEnter();
  },

  /** Складність міняється будь-коли; наступний кадр уже рахується по ній. */
  applyDifficulty() {
    setDiff(Store.data.diff || 'normal');
    return DIFF.key;
  },

  startLevel(idx, useCp) {
    rangeLeave();                                 // звичайний старт гасить кімнату
    const lvl = clamp(idx, 0, LEVELS.length - 1);
    // разова допомога живе лише в межах одного сектора
    if (lvl !== this.level) { this.assist = false; this.assistAsked = false; this.bossDeaths = 0; }
    this.level = lvl;
    if (!useCp) { this.cpTaken = false; this.cpIndex = 0; }
    clearEntities();
    bossReset();
    ZONES.length = 0; PENDING.length = 0; GHOSTS.length = 0; TRAIL.length = 0;
    hitStopT = 0;
    refreshEquip();
    loadLevel(this.level);
    buildBackground();
    DRONES.length = 0;
    spawnAllEnemies();
    let sx = world.spawn.x, sy = world.spawn.y;
    // ЛЕГКИЙ: якщо гравець помер на босі, він і повертається до боса —
    // а не переграє півсектора заново. Чекпоінт перед ареною існує
    // завжди, тож це просто вибір найдальшого з узятих.
    if (DIFF.bossRestart && useCp && this.diedAtBoss === lvl) {
      for (let i = 0; i < world.cps.length; i++)
        if (world.cps[i].boss) { this.cpTaken = true; this.cpIndex = i; }
    }
    if (useCp && this.cpTaken) {
      const idx = Math.min(this.cpIndex || 0, world.cps.length - 1);
      for (let i = 0; i <= idx; i++) world.cps[i].taken = true;
      world.cpTaken = true;
      world.cp.x = world.cps[idx].x; world.cp.y = world.cps[idx].y;
      sx = world.cp.x; sy = world.cp.y;
    }
    playerSpawnAt(sx, sy);
    P.hp = P.maxHp; P.q = 0; P.heat = 0;
    cam.reset(sx, sy);
    Music.set(world.theme); Music.start();
    this.introT = 2.2;
    this.state = 'play';
    this.cutT = false;
    hooks.showScreen(null);
    Input.enable(true);
    Input.clearEdges();
    playCut('lvl', () => { });
  },
  levelClear() {
    this.state = 'clear';
    Input.enable(false);
    Music.stop();
    const d = Store.data;
    if (d.cleared.indexOf(this.level) < 0) d.cleared.push(this.level);
    d.unlocked = Math.max(d.unlocked, Math.min(LEVELS.length, this.level + 2));
    Store.save();
    hooks.refreshLevels();
    this.reward = levelReward(this.level);        // нагорода за пройдений сектор
    // Кожна нова зброя приносить один рядок про СВОЮ механіку — не опис,
    // а те, чим вона відрізняється від попередньої.
    if (this.reward && this.reward.kind === 'weapon') Tut.weaponTip(this.reward.id);
    if (this.level >= LEVELS.length - 1) {
      hooks.setWinStat('Смертей за гру: ' + Store.data.deaths);
      hooks.showReward(this.reward, () => hooks.showScreen('win'));
      Sfx.win();
    } else {
      hooks.setClear(world.bossType ? 'БОСА ЗНИЩЕНО' : 'СЕКТОР ЗАЧИЩЕНО',
                     'СЕКТОР ' + (this.level + 1) + ' · ' + world.def.n);
      hooks.showReward(this.reward, () => hooks.showScreen('clear'));
    }
  },
  onDeath() {
    this.state = 'dead';
    Input.enable(false);
    Music.sting('die');
    Music.stop();
    Store.data.deaths++; Store.save();
    // Три смерті на одному босі — пропонуємо допомогу. Пропонуємо, а не
    // вмикаємо: вибір лишається за гравцем, контент не блокується.
    // Помер на арені — запам'ятовуємо це окремим прапорцем: полегшений
    // режим повертає саме до боса, і йому байдуже, який чекпоінт узято.
    this.diedAtBoss = (BOSS.on && !BOSS.done) ? this.level : -1;
    const onBoss = world.bossType && this.cpTaken && world.cps[this.cpIndex] && world.cps[this.cpIndex].boss;
    if (onBoss) {
      if (this.bossDeathLvl !== this.level) { this.bossDeathLvl = this.level; this.bossDeaths = 0; }
      this.bossDeaths++;
      if (this.bossDeaths >= 3 && !this.assist && !this.assistAsked) {
        this.assistAsked = true;
        hooks.askAssist(BOSSDEF[world.bossType].name);
        return;
      }
    }
    hooks.showScreen('dead');
  },
  /** Відповідь на пропозицію допомоги. */
  setAssist(on) {
    this.assist = !!on;
    if (on) { P.maxHp = maxHearts(); P.hp = P.maxHp; }
    hooks.showScreen('dead');
  },
  pause() {
    if (this.state !== 'play') return;
    this.state = 'pause';
    Input.enable(false);
    hooks.showScreen('pause');
  },
  resume() {
    if (this.state !== 'pause') return;
    this.state = 'play';
    Music.start();
    hooks.showScreen(null);
    Input.enable(true);
    Input.clearEdges();
  },
  toMenu() {
    rangeLeave();
    this.state = 'menu';
    Music.set('menu'); Music.layer(0); Music.start();
    clearEntities(); bossReset();
    Input.enable(false);
    hooks.showScreen('menu');
    hooks.refreshProgress();
  }
};





/** З'їдені тайл-хробаком платформи повертаються — рівень лишається прохідним. */
function updateEaten(dt) {
  for (let i = world.eaten.length - 1; i >= 0; i--) {
    const t = world.eaten[i];
    t.t -= dt;
    if (t.t <= 0) {
      world.tiles[t.i] = t.code;
      world.eaten[i] = world.eaten[world.eaten.length - 1]; world.eaten.pop();
    }
  }
}
function updateMovingPlatforms(dt) {
  for (let i = 0; i < world.mp.length; i++) {
    const m = world.mp[i];
    if (m.axis === 'h') {
      const ox = m.x;
      m.x += m.sp * m.dir * dt;
      if (m.x <= m.a) { m.x = m.a; m.dir = 1; }
      else if (m.x >= m.b) { m.x = m.b; m.dir = -1; }
      m.dx = m.x - ox; m.dy = 0;
    } else {
      const oy = m.y;
      m.y += m.sp * m.dir * dt;
      if (m.y <= m.a) { m.y = m.a; m.dir = 1; }
      else if (m.y >= m.b) { m.y = m.b; m.dir = -1; }
      m.dy = m.y - oy; m.dx = 0;
    }
  }
}
function stepGame(dt) {
  world.time += dt;
  if (Game.introT > 0) Game.introT -= dt;
  if (Game.pickupT > 0) Game.pickupT -= dt;
  if (Game.assembleT > 0) Game.assembleT -= dt;
  tickSlow(dt);
  const sdt = dt * timeScale();                   // сповільнення часу від Хроноріза
  Input.step();
  updateMovingPlatforms(sdt);
  updateEaten(dt);
  updatePlayer(dt);                               // герой завжди в реальному часі
  updateEnemies(sdt);
  updateBoss(sdt);
  updateDrones(dt);
  updateBullets(sdt);
  updateBeams(dt);
  updateZones(sdt);
  updatePending(sdt);
  updateGhosts(sdt);
  twinUpdate(sdt);
  updateTele(dt);
  updateParts(dt);
  updateRings(dt);
  updateWfx(dt);
  updateWeather(dt);
  cam.update(dt, P.x + P.w / 2, P.y + P.h / 2);
  // --- адаптивна музика: 0 спокій, 1 помітили, 2 бій, 3 бос/фінальна фаза ---
  {
    let lv = 0;
    if (BOSS.on && !BOSS.done) lv = (BOSS.phase >= 3 || BOSS.rage) ? 3 : 2;
    else {
      for (let i = 0; i < ENEM.length; i++) {
        const e = ENEM[i];
        if (e.dead || e.charm > 0) continue;
        if (Math.abs(e.x - P.x) > Si(260)) continue;
        if (e.alertSt === 'fight') { lv = 2; break; }
        if (e.alertSt === 'suspect' || e.alertSt === 'lost') lv = Math.max(lv, 1);
        else lv = Math.max(lv, 1);
      }
      if (Game.pickupT > 0.1 && lv === 0) lv = 0;
    }
    Music.layer(lv);
    Game.combat = lv >= 2;                          // бій: кнопки трохи тьмяніють
  }
  Music.update(dt);
}


/* ---------------------------------------------------------------- ЕКСПОРТ */
export const timing = {
  get hitStop() { return hitStopT; },
  sub(dt) { hitStopT = Math.max(0, hitStopT - dt); }
};
export function setGod(v) { GOD = !!v; }
export {
  cam, world, P, BOSS, Game, LFX, TUTFX, RANGE, DIFF,
  PARTS, RINGS, ZONES, TELE, BEAMS, GHOSTS, PICKS, PENDING, BULL, ENEM, TRAIL, WEATHER, WFX,
  ETYPE, LEVELS, WEAPONS, WHIP,
  stepGame, updateMovingPlatforms, Cut, playCut,
  tAt, solidAtPx, rectSolid, isSolidCode, moveX, moveY, T_EMPTY, T_SOLID, T_PLAT, T_SPIKE, T_CONVR, T_CONVL,
  bossHitBoxes, bossInvulnerable, bossDamage, bossDie, bossCheckPhase,
  spawnEnemy, damageEnemy, shoot, part, burst, ring, playerHurt, bladeBox, pickTarget, targets,
  startBoss, buildBackground, updateWeather, loadLevel, spawnAllEnemies, playerSpawnAt,
  clearEntities
};
