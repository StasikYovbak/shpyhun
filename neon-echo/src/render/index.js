/**
 * ШАР РЕНДЕРУ НА PIXIJS (WebGL).
 * Замінює колишнє малювання на Canvas2D: усе тепер спрайти з одного
 * атласу + пост-обробка шейдерами. Ігрова логіка сюди не зазирає —
 * рендер лише читає стан ядра.
 */
import {
  Application, Assets, Container, Sprite, Spritesheet, Texture, Text,
  RenderTexture, BlurFilter, DisplacementFilter, TilingSprite, ColorMatrixFilter
} from 'pixi.js';
import { AdvancedBloomFilter, CRTFilter, RGBSplitFilter } from 'pixi-filters';
import { SpritePool } from './pool.js';
import { PaletteFilter } from './palette.js';
import { VW, VH, TS, clamp, lerp, rnd } from '../config.js';
import { THEME } from '../themes.js';
import { Store } from '../store.js';
import * as G from '../core.js';

const MAXVW = 528;                       // максимальна ширина кадру на витягнутих екранах
let app = null, sheet = null, T = {};
let camX = 0, camY = 0;
let vw = VW, scale = 1, dpr = 1;

/* ---------------------------------------------------------------- шари */
let root, worldC, hudC;
let skySpr, bgC, bgDimF, bgP, tileP, reflectC, reflectP, entP, outlineP, entAddP, lightP, darkP, weatherP, hudP;
let hudTexts = {};
let paletteF, bloomF, crtF, rgbF, dispF, dispSpr;
let quality = 'auto', fpsAvg = 60, autoLevel = 2;   // 0 perf, 1 bal, 2 max
const lights = [];                                  // збираються за кадр, малюються разом

/* ------------------------------------------------------------ утиліти */
const px = () => T.px;
function pushLight(x, y, r, color, alpha) {
  if (lights.length > 90) return;
  lights.push({ x, y, r, color, alpha });
}
const COL = {
  pink: 0xff2e88, cyan: 0x22e0ff, yellow: 0xffd23f, white: 0xffffff,
  green: 0x3dff9a, orange: 0xff6b3d, violet: 0x7b2fbe, ice: 0x7df9ff
};
const hex = s => parseInt(s.replace('#', ''), 16);

export const Gfx = {
  get app() { return app; },
  get frameW() { return vw; },
  get fps() { return fpsAvg; },

  async init(canvas) {
    app = new Application();
    await app.init({
      canvas, width: VW, height: VH, backgroundColor: 0x05030a,
      antialias: false, autoDensity: false, resolution: 1,
      preference: 'webgl', powerPreference: 'high-performance'
    });
    const tex = await Assets.load({ src: 'assets/atlas.png', data: { scaleMode: 'nearest' } });
    tex.source.scaleMode = 'nearest';
    const data = await (await fetch('assets/atlas.json')).json();
    sheet = new Spritesheet(tex, data);
    await sheet.parse();
    T = sheet.textures;
    for (const k in T) T[k].source.scaleMode = 'nearest';
    const noiseTex = await Assets.load({ src: 'assets/noise.png' });

    root = new Container();
    worldC = new Container();
    hudC = new Container();
    root.addChild(worldC, hudC);
    app.stage.addChild(root);

    // Небо, силуети міста й відбиття живуть в одному контейнері, якому
    // ми знімаємо яскравість і насиченість: правило «ігрові об'єкти —
    // найяскравіші на екрані» має виконуватись саме тут, а не в шейдері.
    bgC = new Container(); worldC.addChild(bgC);
    bgDimF = new ColorMatrixFilter();
    bgC.filters = [bgDimF];

    skySpr = new Sprite(T['sky_slum']);
    skySpr.width = MAXVW; skySpr.height = VH;
    bgC.addChild(skySpr);

    const mk = (blend) => { const c = new Container(); worldC.addChild(c); return new SpritePool(c, blend); };
    const bgc = new Container(); bgC.addChild(bgc);
    bgP = new SpritePool(bgc, 'normal');
    reflectC = new Container(); bgC.addChild(reflectC);
    reflectP = new SpritePool(reflectC, 'add');
    reflectC.filters = [new BlurFilter({ strength: 3, quality: 2 })];
    reflectC.alpha = 0.32;
    tileP = mk('normal');
    outlineP = mk('normal');            // темний контур силуетів — шар ПІД спрайтами
    entP = mk('normal');
    entAddP = mk('add');
    lightP = mk('add');
    darkP = mk('normal');
    weatherP = mk('normal');
    hudP = new SpritePool(hudC, 'normal');

    // --- пост-обробка ---
    paletteF = new PaletteFilter();
    // Поріг підняли: світяться самі джерела світла, а не весь кадр.
    // Радіус удвічі менший, сила за замовчуванням 0.35 (було 0.9).
    bloomF = new AdvancedBloomFilter({ threshold: 0.86, bloomScale: 0.35, brightness: 1.0, blur: 2.5, quality: 4 });
    rgbF = new RGBSplitFilter({ red: { x: 0, y: 0 }, green: { x: 0, y: 0 }, blue: { x: 0, y: 0 } });
    crtF = new CRTFilter({ curvature: 1.4, lineWidth: 1.1, lineContrast: 0.18, vignetting: 0.28, vignettingAlpha: 0.7, noise: 0.06 });
    dispSpr = new TilingSprite({ texture: noiseTex, width: MAXVW, height: VH });
    dispSpr.alpha = 0;
    worldC.addChild(dispSpr);
    dispF = new DisplacementFilter({ sprite: dispSpr, scale: 0 });

    this.applyQuality();
    this.layout(canvas);
    return app;
  },

  /** Цілий масштаб у ФІЗИЧНИХ пікселях + розширення кадру до 528 px. */
  layout(canvas) {
    dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const Wd = Math.max(320, window.innerWidth) * dpr;
    const Hd = Math.max(200, window.innerHeight) * dpr;
    let s = Math.max(1, Math.floor(Hd / VH));
    if (VW * s > Wd) s = Math.max(1, Math.floor(Wd / VW));
    let w = Math.floor(Wd / s);
    w = Math.max(VW, Math.min(MAXVW, w - (w % 2)));
    vw = w; scale = s;
    G.view.w = vw;
    app.renderer.resize(vw, VH, s);
    const cssW = (vw * s / dpr), cssH = (VH * s / dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    skySpr.width = vw;
    dispSpr.width = vw;
    if (crtF) crtF.width = vw, crtF.height = VH;
  },

  applyQuality() {
    quality = Store.data.gfx || 'auto';
    const lvl = quality === 'perf' ? 0 : quality === 'bal' ? 1 : quality === 'max' ? 2 : autoLevel;
    const D = Store.data;
    const bloom = (D.bloom === undefined ? 35 : D.bloom) / 100;
    const ab = (D.ab === undefined ? 0 : D.ab) / 100;
    const fx = [paletteF];
    if (lvl >= 1) fx.push(dispF);
    if (lvl >= 1 && bloom > 0) fx.push(bloomF);
    if (lvl >= 2 && ab > 0) fx.push(rgbF);          // аберацію додаємо лише коли вона потрібна
    worldC.filters = fx;
    reflectC.visible = lvl >= 1;
    bloomF.bloomScale = bloom;
    bloomF.quality = lvl >= 2 ? 4 : 2;
    bloomF.blur = lvl >= 2 ? 2.5 : 1.6;
    // фон: -40% яскравості й -25% насиченості за замовчуванням
    const dim = (D.bgDim === undefined ? 60 : D.bgDim) / 100;
    bgDimF.reset();
    bgDimF.saturate(-0.25, true);
    bgDimF.brightness(dim, true);
    this.outline = D.outline === undefined ? true : !!D.outline;
    this.ab = ab;
    root.filters = D.crt ? [crtF] : null;
    this.level = lvl;
  },
  /** Скільки спрайтів у шарі сутностей — для перевірок рендеру. */
  entCount() { return entP.n + entAddP.n; },
  /** «Чистий режим»: жодних пост-ефектів, лише піксель-арт. */
  cleanMode() {
    const D = Store.data;
    D.bloom = 0; D.ab = 0; D.crt = 0; D.bgDim = 75; D.outline = 1;
    this.applyQuality();
  },

  /** Авто-режим: тримаємо 60 FPS, знімаючи ефекти згори вниз. */
  sampleFps(dtMs) {
    const f = 1000 / Math.max(1, dtMs);
    fpsAvg = fpsAvg * 0.92 + f * 0.08;
    if ((Store.data.gfx || 'auto') !== 'auto') return;
    if (fpsAvg < 50 && autoLevel > 0) { autoLevel--; this.applyQuality(); }
    else if (fpsAvg > 58.5 && autoLevel < 2 && Math.random() < 0.002) { autoLevel++; this.applyQuality(); }
  },

  /* ==================================================================
     ГОЛОВНИЙ КАДР
     ================================================================== */
  draw() {
    const W = G.world, th = THEME[W.theme] || THEME.slum;
    camX = Math.round(G.cam.ox()); camY = Math.round(G.cam.oy());
    lights.length = 0;
    bgP.begin(); reflectP.begin(); tileP.begin(); entP.begin(); outlineP.begin(); entAddP.begin();
    lightP.begin(); darkP.begin(); weatherP.begin(); hudP.begin();

    if (G.Game.state === 'menu') {
      skySpr.texture = T['sky_' + (W.theme || 'slum')] || T.sky_slum;
      skySpr.alpha = 1;
      finish();
      return;
    }
    drawSky(th);
    drawBackground(th);
    drawTiles(th);
    drawCheckpointExit(th);
    drawPickups();
    drawTelegraphs();
    drawEnemies();
    drawBoss();
    drawGhosts();
    drawPlayer(th);
    drawDrones();
    drawBullets();
    drawBeams();
    drawZones();
    drawParticles();
    drawRings();
    drawWeather(th);
    drawDarkness();
    drawLights();
    drawHud();
    if (Store.data.dbg) drawDebug();
    updateFx(th);
    finish();

    function finish() {
      bgP.end(); reflectP.end(); tileP.end(); entP.end(); outlineP.end(); entAddP.end();
      lightP.end(); darkP.end(); weatherP.end(); hudP.end();
    }
  }
};

/* --------------------------------------------------------- допоміжне */
const colCache = new Map();
function toHex(c) {
  if (typeof c === 'number') return c;
  let v = colCache.get(c);
  if (v === undefined) { v = hex(c.slice(0, 7)); colCache.set(c, v); }
  return v;
}
function floorUnder(x, y) {
  let ty = Math.floor(y / TS);
  for (let i = 0; i < 14; i++, ty++) {
    const c = G.tAt(Math.floor(x / TS), ty);
    if (c === G.T_SOLID || c === G.T_PLAT || c === G.T_CONVR || c === G.T_CONVL) return ty * TS;
  }
  return null;
}
/** Дзеркальна копія спрайта на мокрому асфальті. */
/**
 * Ставить спрайт НОГАМИ на низ хітбокса: anchor (0.5, 1), центр по X,
 * y = низ хітбокса. Уся різниця між висотою спрайта й висотою хітбокса
 * іде вгору, у голову, а не вниз у підлогу. Єдина точка прив'язки для
 * героїні, фантома й усіх ворогів.
 */
function putEnt(pool, tex, x, y, w, h, face, dy) {
  const s = pool.get(tex);
  s.anchor.set(0.5, 1);
  s.x = Math.round(x + w / 2 - camX);
  s.y = Math.round(y + h - camY + (dy || 0));
  if (face < 0) s.scale.x = -1;
  return s;
}
/** Темний контур 1 px: той самий кадр чотири рази зі зсувом, під спрайтом. */
function outline(tex, x, y, w, h, face, dy) {
  if (!Gfx.outline) return;
  for (const [ox, oy] of OFF4) {
    const o = putEnt(outlineP, tex, x, y, w, h, face, dy);
    o.x += ox; o.y += oy;
    o.tint = 0x0a0612; o.alpha = 0.85;
  }
}
const OFF4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function reflect(tex, x, y, w, h, tint, alpha) {
  const f = floorUnder(x + w / 2, y + h);
  if (f === null) return;
  const s = reflectP.get(tex);
  s.x = x - camX; s.y = (2 * f - y - h) - camY;
  s.width = w; s.height = h;
  s.scale.y = -Math.abs(s.scale.y);
  s.y += h;
  s.tint = tint === undefined ? 0xffffff : tint;
  s.alpha = alpha === undefined ? 0.5 : alpha;
}

/* ------------------------------------------------------------- НЕБО */
function drawSky(th) {
  const key = 'sky_' + G.world.theme;
  if (T[key] && skySpr.texture !== T[key]) skySpr.texture = T[key];
  skySpr.width = vw; skySpr.height = VH; skySpr.alpha = 1;
  // «місяць» корпорації
  const m = bgP.get(T.glow);
  m.width = 86; m.height = 86;
  m.x = vw - 130 - camX * 0.04; m.y = 12;
  m.tint = toHex(th.glow); m.alpha = 0.16;
}

/* --------------------------------------------------- ПАРАЛАКС І НЕОН */
function drawBackground(th) {
  const bg = G.world.bg;
  if (!bg) return;
  const tileTint = toHex(th.tile), glowTint = toHex(th.glow);
  for (let i = 0; i < bg.length; i++) {
    const b = bg[i];
    const par = b.l === 0 ? 0.22 : (b.l === 1 ? 0.45 : 0.62);
    const x = Math.round(b.x - camX * par), y = Math.round(b.y - camY * par * 0.4);
    if (x > vw + 40 || x + b.w < -40) continue;
    if (b.sign) {
      const blink = 0.55 + 0.45 * Math.sin(G.world.time * (1.5 + b.n * 3) + b.n * 10);
      const c = toHex(b.c);
      bgP.rect(px(), x, y, b.w, b.h, c, 0.5 + blink * 0.5);
      pushLight(x + camX, y + camY + b.h / 2, 44 + b.h, c, 0.30 * blink);
      reflect(px(), x + camX, y + camY, b.w, b.h, c, 0.55 * blink);
    } else {
      bgP.rect(px(), x, y, b.w, b.h, b.l === 0 ? toHex(th.far) : toHex(th.mid), 1);
      // вікна: обмежена кількість, щоб не роздувати кількість спрайтів
      let n = 0;
      for (let wy = y + 6; wy < y + b.h - 4 && n < 10; wy += 9)
        for (let wx = x + 3; wx < x + b.w - 3 && n < 10; wx += 7)
          if (((wx + wy + (b.n * 100 | 0)) % 5) < 2) { bgP.rect(px(), wx, wy, 2, 3, glowTint, 0.16); n++; }
    }
  }
}

/* ------------------------------------------------------------ ТАЙЛИ */
function drawTiles(th) {
  const W = G.world;
  const key = W.theme;
  const solid = T[`t_${key}_solid`], top = T[`t_${key}_top`],
        plat = T[`t_${key}_plat`], conv = T[`t_${key}_conv`];
  const x0 = Math.max(0, Math.floor(camX / TS)), x1 = Math.min(W.tw - 1, Math.ceil((camX + vw) / TS));
  const y0 = Math.max(0, Math.floor(camY / TS)), y1 = Math.min(W.th - 1, Math.ceil((camY + VH) / TS));
  const edge = toHex(th.edge);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const c = G.tAt(tx, ty);
      if (c === G.T_EMPTY) continue;
      const x = tx * TS - camX, y = ty * TS - camY;
      if (c === G.T_SOLID) {
        const open = G.tAt(tx, ty - 1) === G.T_EMPTY;
        const s = tileP.get(open ? top : solid);
        s.x = x; s.y = y;
        if (open) pushLight(tx * TS + 8, ty * TS + 2, 18, edge, 0.10);
      } else if (c === G.T_PLAT) {
        const s = tileP.get(plat); s.x = x; s.y = y;
        pushLight(tx * TS + 8, ty * TS + 1, 14, edge, 0.10);
      } else if (c === G.T_SPIKE) {
        const s = tileP.get(T.t_spike); s.x = x; s.y = y;
      } else if (c === G.T_CONVR || c === G.T_CONVL) {
        const s = tileP.get(conv); s.x = x; s.y = y;
        const d = c === G.T_CONVR ? 1 : -1;
        const off = ((G.world.time * 40 * d) % 8 + 8) % 8;
        for (let i = -1; i < 3; i++)
          tileP.rect(px(), x + ((i * 8 + off) % 16 + 16) % 16, y + 5, 4, 2, toHex(th.glow), 0.8);
      }
    }
  }
  for (let i = 0; i < G.world.mp.length; i++) {
    const m = G.world.mp[i];
    const s = tileP.get(plat);
    s.x = Math.round(m.x - camX); s.y = Math.round(m.y - camY); s.width = m.w;
    pushLight(m.x + m.w / 2, m.y, 24, edge, 0.14);
  }
}

/* ------------------------------------------------- ЧЕКПОІНТ І ВИХІД */
function drawCheckpointExit(th) {
  const W = G.world, pulse = 0.5 + 0.5 * Math.sin(W.time * 4);
  const c = W.cpPos;
  tileP.rect(px(), c.x + 2 - camX, c.y - 4 - camY, 3, 20, 0x2a1140, 1);
  tileP.rect(px(), c.x - camX, c.y - 10 - camY, 8, 8, W.cpTaken ? COL.green : 0x5b238c, 1);
  if (W.cpTaken) pushLight(c.x + 4, c.y - 6, 40, COL.green, 0.35 + pulse * 0.25);
  const e = W.exit;
  tileP.rect(px(), e.x + 1 - camX, e.y - camY, 16, 32, 0x150a22, 1);
  tileP.rect(px(), e.x + 2 - camX, e.y + 1 - camY, 14, 30, W.exitOpen ? COL.cyan : 0x3a2050, 1);
  if (W.exitOpen) {
    tileP.rect(px(), e.x + 5 - camX, e.y + 8 - camY, 8, 16, 0xe8ddf5, 1);
    pushLight(e.x + 9, e.y + 16, 60, COL.cyan, 0.40 + pulse * 0.25);
    reflect(px(), e.x + 2, e.y + 1, 14, 30, COL.cyan, 0.5);
  } else {
    for (let i = 0; i < 3; i++) tileP.rect(px(), e.x + 3 - camX, e.y + 5 + i * 9 - camY, 12, 3, COL.pink, 1);
  }
  tileP.rect(px(), e.x - camX, e.y - 3 - camY, 18, 3, toHex(th.edge), 1);
}

function drawPickups() {
  const t = G.world.time;
  for (let i = 0; i < G.PICKS.length; i++) {
    const p = G.PICKS[i];
    const b = Math.sin((t + p.t) * 3) * 2;
    if (p.kind === 'frag') {
      // Фрагмент призми: блакитне мерехтіння видно в межах екрана —
      // підказка чесна, гравець має ПОМІТИТИ, а не гадати.
      const k = 0.55 + 0.45 * Math.sin(t * 4 + p.t);
      const s = entP.get(T.frag);
      s.x = Math.round(p.x - camX); s.y = Math.round(p.y + b - camY);
      entAddP.rect(px(), p.x - 1 - camX, p.y - 1 + b - camY, 11, 12, COL.ice, 0.20 + 0.25 * k);
      pushLight(p.x + 4, p.y + 5 + b, 46 + 18 * k, COL.ice, 0.45 + 0.3 * k);
      for (let j = 0; j < 3; j++) {                 // іскри, що піднімаються
        const a = t * 1.6 + j * 2.1 + p.t;
        entAddP.rect(px(), p.x + 4 + Math.cos(a) * 7 - camX,
                     p.y + 4 + b - ((a * 9) % 18) - camY, 1, 2, 0xffffff, 0.55);
      }
      reflect(T.frag, p.x, p.y + b, 9, 10, 0xffffff, 0.5);
      continue;
    }
    entP.rect(px(), p.x - camX, p.y + b - camY, 10, 9, 0xe8f7ff, 1);
    entP.rect(px(), p.x + 1 - camX, p.y + 1 + b - camY, 8, 7, 0xff3355, 1);
    entP.rect(px(), p.x + 4 - camX, p.y + 2 + b - camY, 2, 5, 0xffffff, 1);
    entP.rect(px(), p.x + 2 - camX, p.y + 3.5 + b - camY, 6, 2, 0xffffff, 1);
    pushLight(p.x + 5, p.y + 4 + b, 26, 0xff3355, 0.30);
  }
}

function drawTelegraphs() {
  for (let i = 0; i < G.TELE.length; i++) {
    const t = G.TELE[i];
    const k = 1 - t.t / t.max;
    const a = 0.18 + 0.35 * Math.abs(Math.sin(k * 18));
    entAddP.rect(px(), t.x - camX, t.y - camY, t.w, t.h, toHex(t.col), a);
  }
}

/* ----------------------------------------------------------- ВОРОГИ */
function drawEnemies() {
  const t = G.world.time;
  for (let i = 0; i < G.ENEM.length; i++) {
    const e = G.ENEM[i];
    const sx = e.x - camX, sy = e.y - camY;
    if (sx < -40 || sx > vw + 40) continue;
    const tel = (e.st === 'wind' || e.st === 'wind2' || e.st === 'aim' || e.st === 'tele' ||
                 e.st === 'beep' || e.st === 'blink' || e.st === 'slam');
    if (tel) {
      const k = 0.35 + 0.45 * Math.abs(Math.sin(t * 22));
      entAddP.rect(px(), sx - 3, sy - 3, e.w + 6, e.h + 6, COL.pink, k * 0.5);
      pushLight(e.x + e.w / 2, e.y + e.h / 2, 40, COL.pink, k * 0.5);
    }
    if (e.t === 'phantom') {
      const s = putEnt(entP, T['phantom_idle'], e.x, e.y, e.w, e.h, e.face, 0);
      s.alpha = 0.55 + 0.25 * Math.sin(t * 5 + e.id);
      pushLight(e.x + 6, e.y + 7, 34, 0x6ef7d8, 0.35);
      if (e.flash > 0) entAddP.rect(px(), sx, sy, e.w, e.h, COL.white, 0.7);
      continue;
    }
    const tex = T[`e_${e.t}_${e.elite ? 'x' : 'n'}`];
    if (tex) {
      outline(tex, e.x, e.y, e.w, e.h, e.face, 0);
      const s = putEnt(entP, tex, e.x, e.y, e.w, e.h, e.face, 0);
      if (e.flash > 0) s.tint = 0xffffff;
      else if (e.charm > 0) s.tint = 0x8effe4;      // перехоплений Гліч-Кодом
      reflect(tex, e.x, e.y, e.w, e.h, 0xffffff, 0.35);
    }
    if (e.charm > 0) {
      entAddP.rect(px(), sx - 2, sy - 2, e.w + 4, e.h + 4, 0x00ffcc, 0.18 + 0.12 * Math.sin(t * 9));
      pushLight(e.x + e.w / 2, e.y + e.h / 2, 40, 0x00ffcc, 0.4);
    }
    if (e.warded > 0) {                              // щит від пілона
      entAddP.rect(px(), sx - 3, sy - 3, e.w + 6, e.h + 6, COL.cyan, 0.20 + 0.10 * Math.sin(t * 7 + e.id));
    }
    if (e.flash > 0) entAddP.rect(px(), sx, sy, e.w, e.h, COL.white, 0.8);
    // деталі станів окремими спрайтами
    if (e.t === 'thug') {
      const sw = e.st === 'swing' ? 1 : (e.st === 'wind' || e.st === 'wind2' ? -1 : 0);
      const s = entP.get(T.e_pipe);
      s.x = Math.round(e.face > 0 ? sx + e.w : sx - 12); s.y = Math.round(sy + 3 + sw * 4);
    } else if (e.t === 'turret') {
      const aim = e.st === 'aim' || e.st === 'fire';
      entP.rect(px(), e.face > 0 ? sx + e.w - 2 : sx - 6, sy + 5, 8, 4, 0x2a3140, 1);
      const c = aim ? 0xff3355 : (e.elite ? COL.yellow : COL.cyan);
      entAddP.rect(px(), sx + 4, sy + 6, 6, 4, c, aim ? 0.9 : 0.5);
      pushLight(e.x + 7, e.y + 8, aim ? 46 : 24, c, aim ? 0.55 : 0.25);
    } else if (e.t === 'wasp') {
      const f = Math.floor(t * 30) % 2;
      const w1 = entP.get(T.e_wing); w1.x = Math.round(sx - 1); w1.y = Math.round(sy + (f ? 0 : 2));
      const w2 = entP.get(T.e_wing); w2.x = Math.round(sx + 8); w2.y = Math.round(sy + (f ? 0 : 2));
      pushLight(e.x + 6, e.y + 5, 22, e.elite ? COL.yellow : 0xc9a227, 0.28);
    } else if (e.t === 'kami') {
      const bl = e.st === 'beep' ? (Math.floor(t * 24) % 2) : (Math.floor(t * 6) % 2);
      const c = bl ? 0xff3355 : COL.yellow;
      entAddP.rect(px(), sx + 3, sy + 3, 5, 5, c, 0.9);
      pushLight(e.x + 5, e.y + 5, e.st === 'beep' ? 60 : 30, c, e.st === 'beep' ? 0.7 : 0.35);
    } else if (e.t === 'shield') {
      const s = entP.get(T.e_plate);
      s.x = Math.round(e.face > 0 ? sx + e.w - 3 : sx - 3); s.y = Math.round(sy - 2);
      pushLight(e.x + (e.face > 0 ? e.w : 0), e.y + 8, 34, COL.cyan, 0.35);
    } else if (e.t === 'adept') {
      const lift = (e.st === 'wind') ? -6 : (e.st === 'lunge' ? 2 : -2);
      const s = entP.get(T.e_blade);
      s.x = Math.round(e.face > 0 ? sx + e.w : sx - 16); s.y = Math.round(sy + 6 + lift);
      pushLight(e.x + e.face * 10, e.y + 7 + lift, 30, COL.ice, 0.35);
      if (e.guard > 0) entAddP.rect(px(), sx - 2, sy - 2, e.w + 4, e.h + 4, COL.cyan, 0.15 + e.guard * 0.12);
      if (e.st === 'stagger') entAddP.rect(px(), sx - 2, sy - 6, e.w + 4, 3, COL.yellow, 0.6);
    } else if (e.t === 'spider' && e.st === 'hang') {
      entP.rect(px(), sx + e.w / 2 - 0.5, e.hy - 24 - camY, 1, 24 + (e.y - e.hy), 0xc8dcff, 0.35);
    } else if (e.t === 'rammer') {
      if (e.st === 'ram') {                          // смуги швидкості вздовж розгону
        for (let k = 0; k < 3; k++)
          entAddP.rect(px(), sx - e.face * (6 + k * 7), sy + 3 + k * 3, 6, 1, 0xff8a3d, 0.55 - k * 0.15);
        pushLight(e.x + e.w / 2, e.y + e.h / 2, 52, 0xff8a3d, 0.5);
      } else if (e.st === 'stun2') {                 // вікно шкоди читається окремо
        entAddP.rect(px(), sx - 2, sy - 2, e.w + 4, e.h + 4, COL.cyan, 0.25 + 0.2 * Math.sin(t * 14));
      }
    } else if (e.t === 'anvil') {
      if (e.st === 'slam') {
        entAddP.rect(px(), sx - 14, sy + e.h - 4, e.w + 28, 4, COL.yellow, 0.7);
        pushLight(e.x + e.w / 2, e.y + e.h, 70, COL.yellow, 0.65);
      }
      const g = e.st === 'wind' ? 0.8 : 0.35;
      entAddP.rect(px(), sx + 4, sy + 2, 2, 2, 0xff8a3d, g);
      entAddP.rect(px(), sx + e.w - 6, sy + 2, 2, 2, 0xff8a3d, g);
    } else if (e.t === 'carrier') {
      const pl = 0.5 + 0.5 * Math.sin(t * 3 + e.id);
      entAddP.rect(px(), sx + 4, sy + 9, e.w - 8, 3, COL.ice, 0.35 + 0.35 * pl);
      pushLight(e.x + e.w / 2, e.y + e.h, 34, COL.ice, 0.25 + 0.2 * pl);
      for (let j = 0; j < G.ENEM.length; j++) {      // ниточка до кожного випущеного малого
        const k = G.ENEM[j];
        if (k.parent !== e || k.dead) continue;
        const ax = sx + e.w / 2, ay = sy + e.h, bx = k.x + k.w / 2 - camX, by = k.y - camY;
        for (let m = 0; m < 5; m++)
          entP.rect(px(), ax + (bx - ax) * m / 5, ay + (by - ay) * m / 5, 1, 1, 0x7df9ff, 0.35);
      }
    } else if (e.t === 'pylon') {
      const pl = 0.5 + 0.5 * Math.sin(t * 5);
      entAddP.rect(px(), sx + 3, sy + 3, e.w - 6, 4, COL.cyan, 0.4 + 0.4 * pl);
      pushLight(e.x + e.w / 2, e.y + 6, 46 + e.wards * 8, COL.cyan, 0.35 + 0.25 * pl);
      for (let j = 0; j < G.ENEM.length; j++) {      // видно, кого саме він тримає
        const o = G.ENEM[j];
        if (o === e || o.dead || !(o.warded > 0)) continue;
        const ax = sx + e.w / 2, ay = sy + 5, bx = o.x + o.w / 2 - camX, by = o.y + o.h / 2 - camY;
        for (let m = 1; m < 6; m++)
          entAddP.rect(px(), ax + (bx - ax) * m / 6, ay + (by - ay) * m / 6, 1, 1, COL.cyan, 0.30);
      }
    } else if (e.t === 'blinker' && e.st === 'blink') {
      const g = entAddP.get(tex || T.e_blinker_n);   // привид у точці появи — це і є телеграф
      g.x = Math.round(e.tx - camX); g.y = Math.round(e.ty - camY);
      g.tint = 0x6ef7d8; g.alpha = 0.30 + 0.35 * (1 - e.tm / 0.35);
      pushLight(e.tx + e.w / 2, e.ty + e.h / 2, 40, 0x6ef7d8, 0.45);
    } else if (e.t === 'worm') {
      const spin = Math.floor(t * 22) % 2;           // свердло крутиться
      entAddP.rect(px(), e.face > 0 ? sx + e.w - 3 : sx, sy + 3 + spin, 3, 2, COL.white, 0.5);
    } else if (e.t === 'arch1' || e.t === 'arch2' || e.t === 'arch3') {
      const c = e.t === 'arch1' ? 0xffb347 : (e.t === 'arch2' ? 0xff3355 : COL.cyan);
      const pl = 0.4 + 0.3 * Math.sin(t * 6 + e.id);
      entAddP.rect(px(), sx + 5, sy + 9, e.w - 10, 2, c, pl);
      pushLight(e.x + e.w / 2, e.y + 10, 40, c, pl * 0.7);
    }
    // маркер уваги: '?' — почув, '!' — побачив і зараз піде в бій
    if (e.charm <= 0 && !e.dead) {
      const mk = (e.alertSt === 'fight' && e.react > 0) ? T.mk_ex
        : (e.alertSt === 'suspect' || e.alertSt === 'lost') ? T.mk_q : null;
      if (mk) {
        const m = entP.get(mk);
        m.x = Math.round(sx + e.w / 2 - mk.width / 2);
        m.y = Math.round(sy - 11 + Math.sin(t * 8) * 1);
        m.alpha = e.alertSt === 'lost' ? clamp(e.alertT / 3, 0.25, 0.8) : 1;
        pushLight(e.x + e.w / 2, e.y - 8, 22, mk === T.mk_ex ? COL.yellow : COL.ice, 0.35);
      }
    }
    if (e.elite) entAddP.rect(px(), sx + e.w / 2 - 2, sy - 4, 4, 2, COL.yellow, 0.7);
    if (e.hp < e.maxHp && e.maxHp > 3) {
      entP.rect(px(), sx, sy - 3, e.w, 1, 0x000000, 0.6);
      entP.rect(px(), sx, sy - 3, e.w * clamp(e.hp / e.maxHp, 0, 1), 1, COL.pink, 1);
    }
    if (e.stun > 0) for (let k = 0; k < 3; k++) {
      const a = t * 5 + k * 2.1;
      entAddP.rect(px(), sx + e.w / 2 + Math.cos(a) * 7 - 1, sy - 6 + Math.sin(a) * 2, 2, 2, COL.yellow, 0.9);
    }
  }
}

/* -------------------------------------------------------------- БОС */
function drawBoss() {
  const B = G.BOSS;
  if (!B.on) return;
  const t = G.world.time;
  const sx = B.x - camX, sy = B.y - camY;
  const flash = B.flash > 0;
  const put = (tex, x, y, flip) => {
    const s = entP.get(tex);
    s.x = Math.round(x); s.y = Math.round(y);
    if (flip) { s.scale.x = -1; s.x += tex.width; }
    if (flash) s.tint = 0xffffff;
    return s;
  };
  const alpha0 = B.intro > 0 ? (0.35 + 0.65 * (1 - B.intro / 1.9)) : 1;
  entP.parent.alpha = 1;
  switch (B.type) {
    case 'servotaur': {
      const tel = B.st === 'paw' || B.st === 'jumpTel';
      if (tel) entAddP.rect(px(), sx - 4, sy - 4, B.w + 8, B.h + 8, COL.pink, 0.35 * Math.abs(Math.sin(t * 20)) + 0.2);
      put(T.b_taur_body, sx, sy + 4).alpha = alpha0;
      for (let i = 0; i < 4; i++) {
        const bob = B.st === 'charge' ? Math.sin(t * 24 + i) * 2 : 0;
        put(T.b_taur_leg, sx + 4 + i * (B.w - 12) / 3, sy + B.h - 8 + bob);
      }
      const hx = B.face > 0 ? sx + B.w - 14 : sx + 2;
      put(T.b_taur_head, hx, sy, B.face < 0);
      put(T.b_taur_horn, hx - 2, sy - 4); put(T.b_taur_horn, hx + 10, sy - 4);
      const eye = B.st === 'charge' ? 0xff3355 : COL.yellow;
      pushLight(B.x + B.w / 2 + B.face * 12, B.y + 6, 50, eye, 0.55);
      if (B.st === 'stun') entAddP.rect(px(), sx, sy - 6, B.w, 3, COL.cyan, 0.55);
      reflect(T.b_taur_body, B.x, B.y + 4, 40, 24, 0xffffff, 0.4);
      break;
    }
    case 'queen': {
      for (let i = 0; i < B.parts.length; i++) {
        const nd = B.parts[i];
        if (!nd.alive) { entP.rect(px(), nd.x + 3 - camX, nd.y + 10 - camY, 8, 4, 0x2a1140, 1); continue; }
        put(T.b_node, nd.x - camX, nd.y - camY).tint = nd.flash > 0 ? 0xffffff : 0xffffff;
        pushLight(nd.x + 7, nd.y + 7, 46, COL.cyan, 0.45);
        entP.rect(px(), nd.x - camX, nd.y - 4 - camY, 14 * clamp(nd.hp / nd.maxHp, 0, 1), 2, COL.pink, 1);
      }
      const f = Math.floor(t * 26) % 2;
      put(T.b_queen_wing, sx + 1, sy + (f ? 0 : 2));
      put(T.b_queen_wing, sx + B.w - 11, sy + (f ? 0 : 2));
      put(T.b_queen_body, sx, sy).alpha = alpha0;
      pushLight(B.x + B.w / 2, B.y + B.h / 2, 70, 0xffb03f, 0.4);
      if (G.bossInvulnerable()) {
        const s = entAddP.get(T.ring);
        s.width = 76; s.height = 76;
        s.x = sx + B.w / 2 - 38; s.y = sy + B.h / 2 - 38;
        s.tint = COL.cyan; s.alpha = 0.25 + 0.12 * Math.sin(t * 8);
      }
      break;
    }
    case 'chrono': {
      if (B.st === 'tp') entAddP.rect(px(), B.tx - camX, B.ty - camY, B.w, B.h, 0x8f6fff, 0.3 + 0.25 * Math.sin(t * 18));
      if (B.st === 'wind') entAddP.rect(px(), sx - 3, sy - 3, B.w + 6, B.h + 6, COL.pink, 0.3 + 0.4 * Math.abs(Math.sin(t * 22)));
      put(T.b_chrono_body, sx, sy).alpha = alpha0;
      const lift = B.st === 'wind' ? -7 : (B.st === 'lunge' ? 3 : -1);
      put(T.b_chrono_blade, B.face > 0 ? sx + B.w : sx - 20, sy + 8 + lift, B.face < 0);
      pushLight(B.x + B.w / 2 + B.face * 14, B.y + 9 + lift, 44, COL.ice, 0.5);
      if (B.st === 'stagger') entAddP.rect(px(), sx - 2, sy - 6, B.w + 4, 3, COL.yellow, 0.6);
      reflect(T.b_chrono_body, B.x, B.y, B.w, B.h, 0xffffff, 0.4);
      break;
    }
    case 'glitch': {
      const reb = B.st === 'reboot';
      for (let i = 0; i < 3; i++) {
        const o = reb ? 0 : Math.round(Math.sin(t * 13 + i * 2) * 4);
        entP.rect(px(), sx + o, sy + i * (B.h / 3), B.w, B.h / 3,
                  i === 1 ? COL.pink : (reb ? 0xffffff : 0x00ffcc), reb ? 0.9 : 0.55);
      }
      entP.rect(px(), sx + 8, sy + 8, B.w - 16, B.h - 16, reb ? COL.yellow : 0x0a0a28, 1);
      pushLight(B.x + B.w / 2, B.y + B.h / 2, reb ? 110 : 70, reb ? 0xffffff : 0x00ffcc, reb ? 0.8 : 0.45);
      break;
    }
    case 'architect': {
      if (B.phase === 1) {
        const tel = B.st === 'aimTel' || B.st === 'dashTel';
        if (tel) entAddP.rect(px(), sx - 4, sy - 4, B.w + 8, B.h + 8, COL.pink, 0.3 + 0.4 * Math.abs(Math.sin(t * 20)));
        put(T.b_arch_body, sx, sy, B.face < 0).alpha = alpha0;
        pushLight(B.x + B.w / 2, B.y + 6, 60, COL.cyan, 0.5);
        reflect(T.b_arch_body, B.x, B.y, B.w, B.h, 0xffffff, 0.4);
      } else if (B.phase === 2) {
        for (let i = 0; i < B.parts.length; i++) {
          const c = B.parts[i];
          if (!c.alive) continue;
          put(T.b_arch_core, c.x - camX, c.y - camY);
          pushLight(c.x + 8, c.y + 8, 50, COL.cyan, 0.5);
          entP.rect(px(), c.x - camX, c.y - 4 - camY, 16 * clamp(c.hp / c.maxHp, 0, 1), 2, COL.pink, 1);
        }
      } else {
        put(T.b_arch_head, sx, sy).alpha = alpha0;
        const g = 0.3 + 0.2 * Math.sin(t * 5);
        entAddP.rect(px(), sx + 8, sy + 12, 16, 8, COL.pink, g + 0.4);
        entAddP.rect(px(), sx + B.w - 24, sy + 12, 16, 8, COL.pink, g + 0.4);
        pushLight(B.x + 16, B.y + 16, 70, COL.pink, 0.5);
        pushLight(B.x + B.w - 16, B.y + 16, 70, COL.pink, 0.5);
      }
      break;
    }
  }
}

function drawGhosts() {
  for (let i = 0; i < G.GHOSTS.length; i++) {
    const g = G.GHOSTS[i];
    if (g.delay > 0) continue;
    entAddP.rect(px(), g.x - camX, g.y - camY, 14, 22, 0x8f6fff, 0.45);
    entAddP.rect(px(), g.x + (g.vx > 0 ? 14 : -14) - camX, g.y + 8 - camY, 14, 2, 0xc9b8ff, 0.6);
    pushLight(g.x + 7, g.y + 11, 40, 0x8f6fff, 0.35);
  }
}

/* ------------------------------------------------------------ ГЕРОЙ */
/* Шарф — ланцюжок із п'яти ланок: кожна тягнеться за попередньою з
   запізненням, тому на розвороті він відстає, а в падінні здіймається.
   Стан живе між кадрами, тому це модульний масив, а не локальна змінна. */
const SCARF = [];
for (let i = 0; i < 5; i++) SCARF.push({ x: 0, y: 0 });
let scarfReady = false;
function drawScarf(P, t) {
  // Кріпиться до шиї спрайта 12x15 і тримається близько до тіла:
  // це шарф, а не окрема деталь, що літає поруч.
  const ax = P.x + (P.face > 0 ? 2 : P.w - 2), ay = P.y + 5;
  if (!scarfReady || Math.hypot(SCARF[0].x - ax, SCARF[0].y - ay) > 48) {
    for (const q of SCARF) { q.x = ax; q.y = ay; }   // старт рівня / телепорт
    scarfReady = true;
  }
  const wind = -P.face * (1.0 + clamp(Math.abs(P.vx) / 130, 0, 1) * 1.8);
  const lift = clamp(-P.vy / 300, -1.2, 1.6);
  let px0 = ax, py0 = ay;
  for (let i = 0; i < SCARF.length; i++) {
    const q = SCARF[i];
    const tx = px0 + wind, ty = py0 - lift + Math.sin(t * 9 - i * 0.9) * (0.6 + i * 0.25);
    q.x += (tx - q.x) * (0.42 - i * 0.05);           // хвіст в'ялий, основа жорстка
    q.y += (ty - q.y) * (0.42 - i * 0.05);
    const w = 2.4 - i * 0.3;
    entP.rect(px(), q.x - camX - w / 2, q.y - camY - 1, w, 2,
              i === 0 ? COL.yellow : (i < 3 ? 0xffb03f : 0xc98a12), 1 - i * 0.11);
    px0 = q.x; py0 = q.y;
  }
}
/* ЕЛЕКТРОХЛИСТ. Мотузка малюється ланка за ланкою: біля рукояті 3 px,
   на кінчику 1 px — класичний конус батога. Уздовж біжать розряди,
   кінчик світиться яскравіше, дуга лишає шлейф, що згасає за 0,2 с. */
const WHIP_TRAIL = [];
function drawWhip(t) {
  const W = G.WHIP;
  if (!W.on) { if (WHIP_TRAIL.length) WHIP_TRAIL.length = 0; return; }
  const pts = W.pts, n = pts.length;
  // шлейф: запам'ятовуємо кінчик і малюємо згасаючий слід
  WHIP_TRAIL.push({ x: pts[n - 1].x, y: pts[n - 1].y, t: 0.2 });
  if (WHIP_TRAIL.length > 14) WHIP_TRAIL.shift();
  for (let i = WHIP_TRAIL.length - 1; i >= 0; i--) {
    const q = WHIP_TRAIL[i];
    q.t -= 1 / 60;
    if (q.t <= 0) { WHIP_TRAIL.splice(i, 1); continue; }
    entAddP.rect(px(), q.x - 1 - camX, q.y - 1 - camY, 2, 2, COL.ice, (q.t / 0.2) * 0.55);
  }
  // сама мотузка: товщина від 3 px біля рукояті до 1 px на кінчику
  const white = W.flash > 0 ? W.flash / 0.08 : 0;
  for (let i = 1; i < n; i++) {
    const a = pts[i - 1], b = pts[i];
    const k = i / (n - 1);
    const th = Math.max(1, Math.round(3 - k * 2));
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2));
    for (let m = 0; m <= steps; m++) {
      const x = a.x + (b.x - a.x) * m / steps, y = a.y + (b.y - a.y) * m / steps;
      entP.rect(px(), Math.round(x - th / 2 - camX), Math.round(y - th / 2 - camY), th, th,
                white > 0.4 ? COL.white : 0x2a1140, 1);
      entAddP.rect(px(), Math.round(x - th / 2 - camX), Math.round(y - th / 2 - camY), th, th,
                   white > 0.4 ? COL.white : COL.ice, 0.30 + 0.5 * k + white * 0.5);
    }
    // розряди, що біжать уздовж мотузки
    if (((t * 26 + i) | 0) % 4 === 0)
      entAddP.rect(px(), Math.round(b.x - camX) - 1, Math.round(b.y - camY) - 1, 3, 3, COL.white, 0.8);
  }
  const tip = pts[n - 1];
  entAddP.rect(px(), Math.round(tip.x - camX) - 2, Math.round(tip.y - camY) - 2, 4, 4, COL.white, 0.95);
  pushLight(tip.x, tip.y, 40 + white * 40, COL.ice, 0.55 + white * 0.4);
  pushLight(pts[0].x, pts[0].y, 22, COL.ice, 0.3);
  if (W.tipHit) {                                   // іскри в точці удару
    const h = W.tipHit;
    entAddP.rect(px(), h.x - 4 - camX, h.y - 4 - camY, 8, 8, COL.white, h.t / 0.2);
    pushLight(h.x, h.y, 46, COL.white, h.t / 0.2);
  }
}

/* Дрони «Рою»: тіло, слід і промінь до позначеної цілі. */
function drawDrones() {
  const t = G.world.time;
  for (let i = 0; i < G.DRONES.length; i++) {
    const d = G.DRONES[i];
    const sx = d.x - camX, sy = d.y - camY;
    const s = entP.get(T.e_mote);
    s.anchor.set(0.5, 0.5);
    s.x = Math.round(sx); s.y = Math.round(sy);
    s.rotation = t * 6 + i;                          // корпус повільно крутиться
    const hot = d.hitT > 0;
    if (!d.tr) d.tr = [];                          // видима траєкторія дрона
    d.tr.push({ x: d.x, y: d.y });
    if (d.tr.length > 10) d.tr.shift();
    for (let k = 0; k < d.tr.length; k++)
      entAddP.rect(px(), d.tr[k].x - camX, d.tr[k].y - camY, 1, 1, COL.cyan, (k / d.tr.length) * 0.4);
    entAddP.rect(px(), sx - 1, sy - 1, 2, 2, hot ? COL.yellow : COL.cyan, 0.9);
    pushLight(d.x, d.y, hot ? 44 : 26, hot ? COL.yellow : COL.cyan, hot ? 0.6 : 0.32);
    if (d.t < 1.2 && Math.floor(t * 14) % 2) s.alpha = 0.4;   // блимає перед згасанням
  }
  const m = G.P.mark;
  if (m && !m.dead) {                                // мітка цілі — чотири кутики
    const mx = m.x - camX, my = m.y - camY, k = 0.6 + 0.4 * Math.sin(t * 10);
    for (const [ox, oy, dx, dy] of [[0, 0, 1, 1], [m.w, 0, -1, 1], [0, m.h, 1, -1], [m.w, m.h, -1, -1]]) {
      entAddP.rect(px(), mx + ox - (dx > 0 ? 2 : 0) - 1, my + oy - 1, 3, 1, COL.cyan, k);
      entAddP.rect(px(), mx + ox - 1, my + oy - (dy > 0 ? 2 : 0) - 1, 1, 3, COL.cyan, k);
    }
  }
}

function drawPlayer(th) {
  const P = G.P, t = G.world.time;
  drawWhip(t);                                     // зброя видима навіть коли героїня блимає
  if (P.dead && P.deadT <= 0.05) return;
  if (P.inv > 0 && P.hurtT <= 0 && Math.floor(P.inv * 22) % 2 === 0) return;
  const tex = T['hero_' + P.anim] || T.hero_idle;
  const sx = Math.round(P.x - 1 - camX), sy = Math.round(P.y - (P.crouch ? 4 : 0) - camY);

  // тінь-пляма під ногами
  const f = floorUnder(P.x + P.w / 2, P.y + P.h);
  if (f !== null) {
    const d = clamp(1 - (f - (P.y + P.h)) / 90, 0.15, 1);
    const s = entP.get(T.shadow);
    s.width = 20 * d; s.height = 6 * d;
    s.x = P.x + P.w / 2 - 10 * d - camX; s.y = f - 3 - camY;
    s.alpha = 0.55 * d;
  }
  // підсвітка контуру кольором найближчого джерела
  let near = null, nd = 1e9;
  for (let i = 0; i < lights.length; i++) {
    const l = lights[i];
    const d = Math.hypot(l.x - (P.x + 5), l.y - (P.y + 7));
    if (d < nd && d < 170) { nd = d; near = l; }
  }
  if (near) {
    const rim = putEnt(entAddP, tex, P.x, P.y, P.w, P.h, P.face, 0);
    rim.tint = near.color;
    rim.alpha = clamp(0.42 - nd / 500, 0.05, 0.4);
  }
  drawScarf(P, t);
  // дихання: у спокої силует піднімається на піксель — персонаж «живий»
  const br = (P.anim === 'idle' || P.anim === 'blink') && Math.sin(P.breath) > 0.45 ? 1 : 0;
  outline(tex, P.x, P.y, P.w, P.h, P.face, -br);
  const s = putEnt(entP, tex, P.x, P.y, P.w, P.h, P.face, -br);
  if (P.flipT > 0) {                             // сальто подвійного стрибка
    const k = 1 - P.flipT / 0.40;
    s.anchor.set(0.5, 0.5);
    s.y -= P.h / 2;
    s.rotation = k * Math.PI * 2 * P.face;
  }
  if (G.world.grav < 0) { s.scale.y = -Math.abs(s.scale.y); s.y -= P.h; }
  if (P.hurtT > 0 || P.dischT > 0) s.tint = 0xffffff;
  reflect(tex, P.x + P.w / 2 - tex.width / 2, P.y + P.h - tex.height, tex.width, tex.height, 0xffffff, 0.45);

  // клинок
  if (P.atkT > 0 && G.EQ.m.id !== 'whip') {
    const b = G.bladeBox();
    const wid = G.EQ.m.id;
    const dur = wid === 'arc' ? (P.atkIdx === 2 ? 0.30 : 0.18) : G.EQ.m.swing[0];
    const k = 1 - P.atkT / dur;
    const a = clamp(1 - Math.abs(k - 0.5) * 2, 0, 1) * 0.95;
    if (wid === 'claws') {                         // три короткі паралельні розрізи
      for (let i = 0; i < 3; i++) {
        const oy = b.y + 2 + i * 4;
        const sx0 = b.x + (P.face > 0 ? -2 : 2) + P.face * k * 6;
        entAddP.rect(px(), sx0 - camX, oy - camY + i, b.w + 4, 1, 0x00ffcc, a);
        entAddP.rect(px(), sx0 + P.face * 2 - camX, oy - camY + i, b.w, 1, COL.white, a * 0.7);
      }
      pushLight(b.x + b.w / 2, b.y + b.h / 2, 34, 0x00ffcc, a * 0.7);
    } else {
      const col = P.atkIdx === 2 ? COL.yellow : (wid === 'brand' ? COL.orange : COL.ice);
      const th = wid === 'brand' ? 6 : 4;
      entAddP.rect(px(), b.x - camX, b.y + b.h / 2 - th / 2 + (P.atkIdx ? 4 : -3) - camY, b.w, th, col, a);
      pushLight(b.x + b.w / 2, b.y + b.h / 2, 54, col, a * 0.8);
    }
  }
  if (P.parryT > 0) entAddP.rect(px(), P.x - 5 - camX, P.y - 4 - camY, P.w + 10, P.h + 8, COL.yellow, 0.35 * (P.parryT / 0.15));
  if (P.q >= 10) {
    entAddP.rect(px(), P.x - 3 - camX, P.y - 3 - camY, P.w + 6, P.h + 6, COL.cyan, 0.2 + 0.15 * Math.sin(t * 12));
    pushLight(P.x + 5, P.y + 7, 46, COL.cyan, 0.4);
  }
  if (P.chargeReady) {
    const cx = P.x + P.w / 2 + P.face * 10, cy = P.y + 6;
    entAddP.rect(px(), cx - 3 - camX, cy - 3 - camY, 6, 6, COL.yellow, 0.5 + 0.4 * Math.sin(t * 20));
    pushLight(cx, cy, 40, COL.yellow, 0.6);
  }
  if (P.dashT > 0) pushLight(P.x + 5, P.y + 7, 40, COL.cyan, 0.45);
}

/* ---------------------------------------------- КУЛІ, ПРОМЕНІ, ЗОНИ */
function drawBullets() {
  for (let i = 0; i < G.BULL.length; i++) {
    const b = G.BULL[i];
    const c = toHex(b.col);
    entAddP.rect(px(), b.x - b.w / 2 - 2 - camX, b.y - b.h / 2 - 2 - camY, b.w + 4, b.h + 4, c, 0.35);
    entP.rect(px(), b.x - b.w / 2 - camX, b.y - b.h / 2 - camY, b.w, b.h, c, 1);
    entP.rect(px(), b.x - b.w / 2 + 1 - camX, b.y - b.h / 2 + 1 - camY, Math.max(1, b.w - 2), Math.max(1, b.h - 2), 0xffffff, 0.9);
    pushLight(b.x, b.y, b.kind === 3 ? 40 : 26, c, 0.4);
    if (b.falloff) {                               // дробовик: трасер, а не точка
      const L = clamp(Math.hypot(b.vx, b.vy) * 0.016, 3, 9);
      const nx = b.vx / (Math.hypot(b.vx, b.vy) || 1), ny = b.vy / (Math.hypot(b.vx, b.vy) || 1);
      for (let k = 1; k <= 3; k++)
        entAddP.rect(px(), b.x - nx * k * L / 3 - camX - 1, b.y - ny * k * L / 3 - camY - 1,
                     2, 2, c, 0.5 - k * 0.12);
    }
    if (b.kind === 6) {                            // Ехо-Призма: слід і лічильник відбиттів
      const k = (b.bounce || 0) / 5;
      entAddP.rect(px(), b.x - b.vx * 0.02 - 1 - camX, b.y - b.vy * 0.02 - 1 - camY, 3, 3, COL.white, 0.4);
      pushLight(b.x, b.y, 30 + 14 * k, COL.ice, 0.5);
    }
  }
}
function drawBeams() {
  // дуга ланцюгового розряду: ламана між двома ворогами
  for (let i = 0; i < G.BEAMS.length; i++) {
    const b = G.BEAMS[i];
    if (b.arc) {
      const a = b.t / b.max;
      for (let k = 0; k <= 6; k++) {
        const u = k / 6;
        const x = b.x + (b.arc.x - b.x) * u + Math.sin(u * 9 + G.world.time * 40) * 3;
        const y = b.y + (b.arc.y - b.y) * u + Math.cos(u * 11 + G.world.time * 40) * 3;
        entAddP.rect(px(), Math.round(x - camX) - 1, Math.round(y - camY) - 1, 2, 2, COL.ice, a);
      }
      pushLight((b.x + b.arc.x) / 2, (b.y + b.arc.y) / 2, 40, COL.ice, a * 0.6);
      continue;
    }
    const k = b.t / b.max, c = toHex(b.col);
    const x0 = b.dir > 0 ? b.x : b.x - b.len;
    entAddP.rect(px(), x0 - camX, b.y - 4 * k - camY, b.len, 8 * k, c, k);
    entAddP.rect(px(), x0 - camX, b.y - 1 - camY, b.len, 2, 0xffffff, k * 0.9);
    pushLight(x0 + b.len / 2, b.y, 90, c, k * 0.7);
  }
}
function drawZones() {
  for (let i = 0; i < G.ZONES.length; i++) {
    const z = G.ZONES[i];
    const k = clamp(z.t / z.max, 0, 1), c = toHex(z.col);
    entAddP.rect(px(), z.x - camX, z.y - camY, z.w, z.h, c, 0.35 + 0.4 * k);
    entAddP.rect(px(), z.x - camX, z.y + z.h / 2 - 1 - camY, z.w, 2, 0xffffff, 0.9);
    pushLight(z.x + z.w / 2, z.y + z.h / 2, 70, c, 0.5);
  }
}
function drawParticles() {
  const lim = Gfx.level === 0 ? 120 : G.PARTS.length;
  for (let i = 0; i < G.PARTS.length && i < lim; i++) {
    const p = G.PARTS[i];
    const a = clamp(p.t / p.max, 0, 1);
    const s = Math.max(1, Math.round(p.s * (p.k === 1 ? a : 1)));
    entAddP.rect(px(), Math.round(p.x - s / 2 - camX), Math.round(p.y - s / 2 - camY), s, s, toHex(p.col), a);
  }
}
function drawRings() {
  for (let i = 0; i < G.RINGS.length; i++) {
    const r = G.RINGS[i];
    const k = 1 - r.t / r.max;
    const rad = lerp(r.r0, r.r1, k);
    const s = entAddP.get(T.ring);
    s.width = rad * 2.2; s.height = rad * 2.2;
    s.x = r.x - rad * 1.1 - camX; s.y = r.y - rad * 1.1 - camY;
    s.tint = toHex(r.col); s.alpha = clamp(r.t / r.max, 0, 1) * 0.9;
    pushLight(r.x, r.y, rad * 1.6, toHex(r.col), clamp(r.t / r.max, 0, 1) * 0.5);
  }
}

/* --------------------------------------------------- ПОГОДА Й СВІТЛО */
function drawWeather(th) {
  const fx = th.fx;
  for (let i = 0; i < G.WEATHER.length; i++) {
    const w = G.WEATHER[i];
    const x = Math.round(w.x), y = Math.round(w.y);
    switch (fx) {
      case 'rain': { const s = weatherP.get(T.drop); s.x = x; s.y = y; s.height = 5 + w.v * 3;
        s.tint = 0x8fdcff; s.alpha = 0.2 + w.v * 0.16; break; }
      case 'petal': { const s = weatherP.get(T.petal); s.x = x; s.y = y;
        s.tint = w.p < 0.5 ? 0xffb7d5 : 0xff8fc0; s.alpha = 0.55; break; }
      case 'dust': weatherP.rect(px(), x, y, 1, 1, 0x9ad6c0, 0.22); break;
      case 'spark': weatherP.rect(px(), x, y, 1, 2, 0xffb03f, 0.5); break;
      case 'ember': weatherP.rect(px(), x, y, 1, 1, w.p < 0.5 ? COL.orange : COL.yellow, 0.55); break;
      case 'steam': weatherP.rect(px(), x - 2, y, 5, 3, 0xbff4ff, 0.13); break;
      case 'wind': weatherP.rect(px(), x, y, 10 + w.v * 10, 1, 0xbff4ff, 0.24); break;
      case 'glitch': weatherP.rect(px(), x - 14, y, 28 + w.v * 20, 2, w.v > 1 ? 0x00ffcc : COL.pink, 0.3 * (1 - w.p)); break;
    }
  }
}
function drawDarkness() {
  if (!G.world.dark) return;
  const P = G.P;
  const cx = P.x + P.w / 2 - camX, cy = P.y + P.h / 2 - camY;
  const R = 118;
  const h = darkP.get(T.dark_hole);
  h.x = cx - R; h.y = cy - R; h.width = R * 2; h.height = R * 2;
  // решту екрана закриваємо суцільними прямокутниками
  darkP.rect(px(), 0, 0, vw, Math.max(0, cy - R), 0x03020a, 1);
  darkP.rect(px(), 0, cy + R, vw, Math.max(0, VH - (cy + R)), 0x03020a, 1);
  darkP.rect(px(), 0, cy - R, Math.max(0, cx - R), R * 2, 0x03020a, 1);
  darkP.rect(px(), cx + R, cy - R, Math.max(0, vw - (cx + R)), R * 2, 0x03020a, 1);
}
function drawLights() {
  if (Gfx.level === 0) return;                  // у режимі продуктивності світло вимкнене
  for (let i = 0; i < lights.length; i++) {
    const l = lights[i];
    const s = lightP.get(T.glow);
    const d = l.r * 2;
    s.width = d; s.height = d;
    s.x = l.x - l.r - camX; s.y = l.y - l.r - camY;
    s.tint = l.color; s.alpha = l.alpha;
  }
}

/* -------------------------------------------------------------- HUD */
const FONT = 'Handjet, ui-monospace, monospace';
function txt(key, str, x, y, size, color, align) {
  let t = hudTexts[key];
  if (!t) {
    t = new Text({
      text: str,
      style: { fontFamily: FONT, fontSize: size, fill: color, letterSpacing: 1,
               dropShadow: { color: 0x12081c, blur: 0, distance: 1, angle: Math.PI / 4, alpha: 1 } }
    });
    t.resolution = 2;
    hudTexts[key] = t;
    hudC.addChild(t);
  }
  if (t.text !== str) t.text = str;
  if (t.style.fontSize !== size) t.style.fontSize = size;
  if (t.style.fill !== color) t.style.fill = color;
  t.anchor.set(align === 'center' ? 0.5 : (align === 'right' ? 1 : 0), 0);
  t.x = x; t.y = y; t.visible = true;
  return t;
}
function hideTxt(key) { if (hudTexts[key]) hudTexts[key].visible = false; }

function drawHud() {
  const P = G.P, B = G.BOSS, W = G.world;
  for (let i = 0; i < P.maxHp; i++) {
    const s = hudP.get(T.heart);
    s.x = 6 + i * 9; s.y = 6;
    s.tint = i < P.hp ? 0xffffff : 0x3a2050;
  }
  // --- ліворуч: іконка ближньої зброї і її власний ресурс ---
  const mw = G.EQ.m, rw = G.EQ.r;
  const mi = hudP.get(T[mw.sprite] || T.w_arc);
  mi.x = 5; mi.y = 15;
  if (mw.id === 'arc') {                          // заряд клинка — десять поділок
    const full = P.q >= 10;
    for (let i = 0; i < 10; i++)
      hudP.rect(px(), 23 + i * 5, 20, 4, 5, i < P.q
        ? (full ? (Math.floor(W.time * 10) % 2 ? 0xffffff : COL.cyan) : COL.cyan) : 0x241a3a, 1);
    hideTxt('mres');
  } else if (mw.id === 'chrono') {                // кулдаун телепорту
    const k = 1 - clamp(P.chronoCd / 1.2, 0, 1);
    hudP.rect(px(), 23, 20, 50, 5, 0x241a3a, 1);
    hudP.rect(px(), 23, 20, Math.round(50 * k), 5, k >= 1 ? COL.cyan : 0x8f7fb0, 1);
    hideTxt('mres');
  } else {
    txt('mres', mw.res === 'нема' ? '' : mw.res.toUpperCase(), 23, 18, 9, 0x8f7fb0);
  }

  // --- праворуч: ресурс дальньої зброї, під ним ривок ---
  const bx = vw - 68, by = 6, bw = 62, bh = 7;
  const pips = (n, max, on, off) => {
    for (let i = 0; i < max; i++)
      hudP.rect(px(), bx + i * (bw / max), by, bw / max - 2, bh, i < n ? on : off, 1);
  };
  if (rw.id === 'rail') {
    hudP.rect(px(), bx, by, bw, bh, 0x241a3a, 1);
    const k = clamp(P.heat / 100, 0, 1);
    hudP.rect(px(), bx + 1, by + 1, Math.round((bw - 2) * k), bh - 2,
      P.lock ? 0xff3355 : (k > 0.75 ? COL.orange : (k > 0.45 ? COL.yellow : COL.cyan)), 1);
    if (P.lock) {
      hudP.rect(px(), bx + 1 + (bw - 2) * P.arA, by + 1, Math.max(2, (bw - 2) * (P.arB - P.arA)), bh - 2, COL.green, 1);
      hudP.rect(px(), bx + 1 + (bw - 2) * P.arMark, by, 2, bh, 0xffffff, 1);
      if (Math.floor(W.time * 8) % 2) txt('oh', 'ПЕРЕГРІВ', bx + bw, by + 9, 9, 0xff3355, 'right'); else hideTxt('oh');
    } else hideTxt('oh');
  } else if (rw.id === 'shot') {
    pips(P.shells, 6, COL.yellow, 0x241a3a);
    if (P.reloadT > 0) {
      hudP.rect(px(), bx, by + bh + 1, Math.round(bw * (1 - P.reloadT / 1.8)), 2, COL.orange, 1);
      if (Math.floor(W.time * 8) % 2) txt('oh', 'ПЕРЕЗАРЯДКА', bx + bw, by + 10, 9, COL.orange, 'right'); else hideTxt('oh');
    } else hideTxt('oh');
  } else if (rw.id === 'glitch') {
    pips(P.cores, 3, 0x00ffcc, 0x241a3a);
    if (P.cores < 3) hudP.rect(px(), bx + P.cores * (bw / 3), by, (bw / 3 - 2) * clamp(P.coreFrac, 0, 1), bh, 0x0a6b5c, 1);
    hideTxt('oh');
  } else if (rw.id === 'swarm') {
    pips(G.DRONES.length, 3, COL.cyan, 0x241a3a);
    if (P.droneCd > 0) hudP.rect(px(), bx, by + bh + 1, Math.round(bw * (1 - P.droneCd / 3)), 2, COL.ice, 1);
    hideTxt('oh');
  } else {                                        // «Оса» — нескінченні набої
    hudP.rect(px(), bx, by, bw, bh, 0x241a3a, 1);
    hudP.rect(px(), bx + 1, by + 1, bw - 2, bh - 2, 0x2f6b4a, 1);
    txt('oh', '∞', bx + bw / 2, by - 2, 11, COL.green, 'center');
  }
  const ri = hudP.get(T[rw.sprite] || T.w_rail);
  ri.x = vw - 21; ri.y = 15;
  const dashReady = P.dashCd <= 0;
  for (let i = 0; i < 3; i++) hudP.rect(px(), vw - 44 + i * 5, 20, 3, 5, dashReady ? COL.ice : 0x3a2050, 1);
  txt('dash', 'РИВОК', vw - 46, 17, 9, dashReady ? 0x7df9ff : 0x5b4a72, 'right');

  // підказка про знайдену зброю
  if (G.Game.pickupT > 0) {
    const a = clamp(G.Game.pickupT / 0.6, 0, 1);
    hudP.rect(px(), vw / 2 - 78, VH - 40, 156, 16, 0x0b0413, 0.72 * a);
    txt('pick', 'ЗНАЙДЕНО: ' + G.Game.pickupName, vw / 2, VH - 37, 11, COL.yellow, 'center').alpha = a;
  } else hideTxt('pick');
  txt('sector', 'СЕКТОР ' + (W.idx + 1), vw / 2, 4, 10, 0xc9b8dd, 'center');

  if (B.on && B.intro <= 0) {
    const w = 200, x = (vw - w) / 2;
    txt('bname', B.def.name, vw / 2, 14, 10, COL.pink, 'center');
    hudP.rect(px(), x, 25, w, 6, 0x241a3a, 1);
    hudP.rect(px(), x + 1, 26, Math.round((w - 2) * clamp(B.hp / B.maxHp, 0, 1)), 4,
      G.bossInvulnerable() ? 0x8f7fb0 : COL.pink, 1);
    if (B.phase > 1) txt('bphase', 'ФАЗА ' + B.phase, x + w + 4, 24, 9, COL.yellow); else hideTxt('bphase');
    if (G.bossInvulnerable()) {
      txt('bhint', B.type === 'queen' ? 'ЗБИЙ ГЕНЕРАТОРИ'
        : B.type === 'chrono' ? 'ПАРИРУЙ ВИПАД (B)'
        : B.type === 'glitch' ? 'ЧЕКАЙ ПЕРЕЗАВАНТАЖЕННЯ' : 'БИЙ ЯДРА', vw / 2, 33, 9, COL.yellow, 'center');
    } else hideTxt('bhint');
  } else { hideTxt('bname'); hideTxt('bphase'); hideTxt('bhint'); }

  if (B.on && B.nameT > 0 && B.intro > 0) {
    const a = clamp(B.nameT / 1.2, 0, 1);
    hudP.rect(px(), 0, VH / 2 - 26, vw, 44, 0x0b0413, 0.55 * a);
    txt('bigname', B.def.name, vw / 2, VH / 2 - 20, 24, COL.pink, 'center').alpha = a;
    txt('bigsub', B.def.sub, vw / 2, VH / 2 + 4, 10, COL.cyan, 'center').alpha = a;
  } else { hideTxt('bigname'); hideTxt('bigsub'); }

  if (G.Game.introT > 0) {
    const a = clamp(G.Game.introT / 0.8, 0, 1);
    txt('lvl1', 'СЕКТОР ' + (W.idx + 1), vw / 2, VH / 2 - 18, 12, COL.yellow, 'center').alpha = a;
    txt('lvl2', W.def.n, vw / 2, VH / 2 - 2, 18, COL.cyan, 'center').alpha = a;
  } else { hideTxt('lvl1'); hideTxt('lvl2'); }

  if (G.Game.state === 'pause') hudP.rect(px(), 0, 0, vw, VH, 0x0b0413, 0.55);
}

/* --------------------------------------------- РЕЖИМ НАЛАГОДЖЕННЯ
   Червоне — хітбокси, зелене — сітка тайлів, жовте — рівень підлоги
   під героїнею. Саме тут видно, чи збігається низ спрайта з низом
   хітбокса й чи стоїть хітбокс рівно на поверхні тайла. */
function drawDebug() {
  const P = G.P, W = G.world;
  const box = (x, y, w, h, col, a) => {
    entAddP.rect(px(), Math.round(x - camX), Math.round(y - camY), w, 1, col, a);
    entAddP.rect(px(), Math.round(x - camX), Math.round(y + h - 1 - camY), w, 1, col, a);
    entAddP.rect(px(), Math.round(x - camX), Math.round(y - camY), 1, h, col, a);
    entAddP.rect(px(), Math.round(x + w - 1 - camX), Math.round(y - camY), 1, h, col, a);
  };
  // сітка тайлів
  const x0 = Math.floor(camX / TS), x1 = Math.ceil((camX + vw) / TS);
  const y0 = Math.floor(camY / TS), y1 = Math.ceil((camY + VH) / TS);
  for (let tx = x0; tx <= x1; tx++)
    entAddP.rect(px(), tx * TS - camX, 0, 1, VH, 0x3dff9a, 0.14);
  for (let ty = y0; ty <= y1; ty++)
    entAddP.rect(px(), 0, ty * TS - camY, vw, 1, 0x3dff9a, 0.14);
  // тверді тайли — яскравіша сітка
  for (let ty = Math.max(0, y0); ty <= Math.min(W.th - 1, y1); ty++)
    for (let tx = Math.max(0, x0); tx <= Math.min(W.tw - 1, x1); tx++) {
      const c = G.tAt(tx, ty);
      if (c === G.T_EMPTY) continue;
      const col = c === G.T_PLAT ? 0x22e0ff : (c === G.T_SPIKE ? 0xff3355 : 0x3dff9a);
      box(tx * TS, ty * TS, TS, TS, col, 0.45);
    }
  // хітбокси ворогів і героїні
  for (let i = 0; i < G.ENEM.length; i++) {
    const e = G.ENEM[i];
    if (e.dead) continue;
    box(e.x, e.y, e.w, e.h, 0xff3355, 0.9);
  }
  if (G.BOSS.on) for (const hb of G.bossHitBoxes()) box(hb.x, hb.y, hb.w, hb.h, 0xff3355, 0.9);
  box(P.x, P.y, P.w, P.h, 0xff3355, 1);
  // рівень підлоги під героїнею — жовта лінія на всю ширину екрана
  const f = floorUnder(P.x + P.w / 2, P.y + P.h);
  if (f !== null) {
    entAddP.rect(px(), 0, Math.round(f - camY), vw, 1, 0xffd23f, 0.9);
    entAddP.rect(px(), Math.round(P.x + P.w / 2 - camX), Math.round(f - camY) - 3, 1, 3, 0xffd23f, 0.9);
  }
  // цифри: низ хітбокса й низ спрайта — мають збігатись
  const tex = T['hero_' + P.anim] || T.hero_idle;
  txt('dbg1', 'ХІТБОКС ' + P.w + 'x' + P.h + '  СПРАЙТ ' + tex.width + 'x' + tex.height, 4, VH - 26, 9, 0xffd23f);
  txt('dbg2', 'НИЗ ХІТБОКСА y=' + (P.y + P.h).toFixed(1) + '   ПІДЛОГА y=' + (f === null ? '—' : f.toFixed(1)) +
              '   onGround=' + (P.onGround ? '1' : '0'), 4, VH - 15, 9, 0x3dff9a);
}

/* ------------------------------------------------- ПОСТ-ОБРОБКА КАДРУ */
let gradeFrom = THEME.slum.grade, gradeTo = THEME.slum.grade, gradeMix = 1, lastTheme = 'slum';
let abT = 0;
function updateFx(th) {
  const P = G.P, B = G.BOSS, W = G.world;
  if (W.theme !== lastTheme) {                    // плавний перехід палітри між локаціями
    gradeFrom = gradeTo; gradeTo = th.grade; gradeMix = 0; lastTheme = W.theme;
  }
  gradeMix = Math.min(1, gradeMix + 0.02);
  paletteF.setGrade(gradeFrom, gradeTo, gradeMix);
  paletteF.saturation = 1.0 + (W.theme === 'virtual' ? 0.08 : 0);
  const flash = (B.on && B.st === 'die') ? 0.10 + 0.10 * Math.sin(W.time * 30) :
                (P.hurtT > 0 ? 0.10 * P.hurtT : 0);
  paletteF.flash = flash;

  // Хроматична аберація: постійного розшарування нема взагалі.
  // Тільки короткий сплеск 0,15 с при шкоді і фонове тремтіння на арені
  // Гліч-Ядра — і те, й те множиться на повзунок «Аберація».
  if (Gfx.level >= 2 && Gfx.ab > 0) {
    abT = Math.max(abT - 1 / 60, 0);
    if (P.hurtT > 0.14) abT = 0.15;                // новий удар — новий сплеск
    const hit = abT > 0 ? 3.0 * (abT / 0.15) : 0;
    const glitch = (B.on && B.type === 'glitch') ? 1.0 + Math.sin(W.time * 9) * 0.7 : 0;
    const base = (hit + glitch) * Gfx.ab;
    rgbF.red = { x: -base, y: 0 };
    rgbF.green = { x: 0, y: 0 };
    rgbF.blue = { x: base, y: 0 };
  }
  if (Gfx.level >= 1) {                            // спека й пар над трубами / вибухами
    const hot = (W.theme === 'server' || W.theme === 'factory' || W.theme === 'core') ? 3 : 0;
    const boom = G.RINGS.length ? 4 : 0;
    dispF.scale.x = dispF.scale.y = hot + boom;
    dispSpr.tilePosition.x = W.time * 12;
    dispSpr.tilePosition.y = -W.time * 20;
  }
  bloomF.bloomScale = Gfx.level >= 2 ? 0.9 : 0.65;
  if (crtF) crtF.time = W.time * 4;
}
