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
import { VW, VH, TS, clamp, lerp, rnd, DEV_MODE } from '../config.js';
import { CH } from '../cheats.js';
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
let cutC, cutP;                                    // катсцени малюються поверх усього
let hudTexts = {};
let paletteF, bloomF, crtF, rgbF, dispF, dispSpr;
let quality = 'auto', fpsAvg = 60, autoLevel = 2;   // 0 perf, 1 bal, 2 max
const lights = [];                                  // збираються за кадр, малюються разом

/* ------------------------------------------------------------ утиліти */
const px = () => T.px;
let msAvg = 16.7;                                   // згладжений час кадру, мс
function pushLight(x, y, r, color, alpha) {
  if (lights.length > 90) return;
  lights.push({ x, y, r, color, alpha });
}
const COL = {
  pink: 0xff2e88, cyan: 0x22e0ff, yellow: 0xffd23f, white: 0xffffff,
  green: 0x3dff9a, orange: 0xff6b3d, violet: 0x7b2fbe, ice: 0x7df9ff
};
const hex = s => parseInt(s.replace('#', ''), 16);
const RAGE_TINT = 0xff8080;                        // відтінок боса в режимі люті

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
    cutC = new Container(); root.addChild(cutC);
    cutP = new SpritePool(cutC, 'normal');

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
  get frameMs() { return msAvg; },
  sampleFps(dtMs) {
    const f = 1000 / Math.max(1, dtMs);
    fpsAvg = fpsAvg * 0.92 + f * 0.08;
    msAvg = msAvg * 0.92 + Math.min(999, dtMs) * 0.08;
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
    lightP.begin(); darkP.begin(); weatherP.begin(); hudP.begin(); cutP.begin();

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
    drawScan(G.world.time);
    drawWfx(G.world.time);
    drawBullets();
    drawBeams();
    drawZones();
    drawParticles();
    drawRings();
    drawWeather(th);
    drawDarkness();
    drawLights();
    if (!G.Cut.on) drawHud();               // під час катсцени HUD не потрібен
    drawCut();
    if (Store.data.dbg || (DEV_MODE && (CH.boxes || CH.grid))) drawDebug();
    if (DEV_MODE) drawDiag();
    updateFx(th);
    finish();

    function finish() {
      bgP.end(); reflectP.end(); tileP.end(); entP.end(); outlineP.end(); entAddP.end();
      lightP.end(); darkP.end(); weatherP.end(); hudP.end(); cutP.end();
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
      if (G.getSlow() > 0 && Math.abs(e.vx) + Math.abs(e.vy) > 12)
        for (let q = 1; q <= 2; q++) {              // сповільнення часу: сліди за рухомим
          const gh = putEnt(entAddP, tex, e.x - e.vx * 0.035 * q, e.y - e.vy * 0.035 * q,
                            e.w, e.h, e.face, 0);
          gh.tint = 0x6f8fff; gh.alpha = 0.26 / q;
        }
      outline(tex, e.x, e.y, e.w, e.h, e.face, 0);
      const s = putEnt(entP, tex, e.x, e.y, e.w, e.h, e.face, 0);
      if (e.flash > 0) s.tint = 0xffffff;
      else if (e.charm > 0) s.tint = 0x8effe4;      // перехоплений Гліч-Кодом
      reflect(tex, e.x, e.y, e.w, e.h, 0xffffff, 0.35);
    }
    if (e.charm > 0) {
      // палітра інвертована на бірюзову, силует мерехтить, зверху — символ коду
      entAddP.rect(px(), sx - 2, sy - 2, e.w + 4, e.h + 4, 0x00ffcc, 0.18 + 0.12 * Math.sin(t * 9));
      pushLight(e.x + e.w / 2, e.y + e.h / 2, 40, 0x00ffcc, 0.4);
      if (Math.floor(t * 20) % 5 === 0)
        entAddP.rect(px(), sx, sy + ((t * 61 | 0) % Math.max(1, e.h)), e.w, 1, COL.white, 0.55);
      const gy = sy - 9 + Math.sin(t * 4) * 1.5;     // «{ }» над головою
      for (const [ox, oy, w2, h2] of [[0, 0, 1, 5], [1, 0, 2, 1], [1, 4, 2, 1],
                                      [6, 0, 1, 5], [4, 0, 2, 1], [4, 4, 2, 1]])
        entAddP.rect(px(), Math.round(sx + e.w / 2 - 3 + ox), Math.round(gy + oy), w2, h2, 0x00ffcc, 0.9);
      if (e.charm < 1) {                             // час вийшов — розсипається на квадратики
        const q = 1 - e.charm;
        for (let n = 0; n < 6; n++)
          entAddP.rect(px(), sx + ((n * 7) % e.w) + q * (n % 2 ? 5 : -5),
                       sy + ((n * 5) % e.h) + q * 4, 3, 3, 0x00ffcc, 1 - q);
      }
    }
    if (e.hs > 0) {                                  // кігті: що більший стак — то білішим розжарений
      const q = e.hs / 5;
      entAddP.rect(px(), sx, sy, e.w, e.h, q > 0.75 ? COL.white : COL.orange, 0.18 + q * 0.45);
      pushLight(e.x + e.w / 2, e.y + e.h / 2, 20 + q * 26, q > 0.75 ? COL.white : COL.orange, 0.25 + q * 0.4);
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
    else if (B.rage) s.tint = RAGE_TINT;             // режим люті: бос червоніє
    return s;
  };
  const alpha0 = B.intro > 0 ? (0.35 + 0.65 * (1 - B.intro / 1.9)) : 1;
  entP.parent.alpha = 1;
  if (B.rage) {                                      // червона аура + пульс світла
    const k = 0.22 + 0.12 * Math.sin(t * 7);
    entAddP.rect(px(), sx - 4, sy - 4, B.w + 8, B.h + 8, 0xff3355, k);
    pushLight(B.x + B.w / 2, B.y + B.h / 2, 90, 0xff3355, 0.35 + 0.15 * Math.sin(t * 7));
  }
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
      // Кабель живлення від кожного вузла до матки: поки він світиться —
      // звідти йдуть оси й тримається щит. Мертвий вузол — темний кабель.
      const qx = B.x + B.w / 2 - camX, qy = B.y + B.h - 2 - camY;
      for (let i = 0; i < B.parts.length; i++) {
        const nd = B.parts[i];
        const nx = nd.x + nd.w / 2 - camX, ny = nd.y + 2 - camY;
        const SEG = 7;
        let px0 = nx, py0 = ny;
        for (let k = 1; k <= SEG; k++) {
          const u = k / SEG;
          // легке провисання + біжуча хвиля, поки кабель живий
          const sag = Math.sin(u * Math.PI) * 9;
          const wob = nd.alive ? Math.sin(u * 5 - t * 5 + i) * 1.6 : 0;
          const cx2 = nx + (qx - nx) * u + wob;
          const cy2 = ny + (qy - ny) * u + sag;
          if (nd.alive) {
            line(entP, px0, py0, cx2, cy2, 0x16324a, 0.9, 2);
            const pulse = clamp(1 - Math.abs(((t * 0.9 + i * 0.25) % 1) - u) * 6, 0, 1);
            line(entAddP, px0, py0, cx2, cy2, COL.cyan, 0.22 + pulse * 0.75, 1);
          } else {
            line(entP, px0, py0, cx2, cy2 + 4 * u, 0x241a33, 0.55, 1);
          }
          px0 = cx2; py0 = cy2;
        }
        if (!nd.alive) { entP.rect(px(), nd.x + 3 - camX, nd.y + 10 - camY, 8, 4, 0x2a1140, 1); continue; }
        const pu = nd.pulse > 0 ? nd.pulse / 0.35 : 0;
        put(T.b_node, nd.x - camX, nd.y - camY - Math.round(pu * 2)).tint = nd.flash > 0 ? 0xffffff : 0xffffff;
        if (pu > 0) entAddP.rect(px(), nd.x - 2 - camX, nd.y - 2 - camY, nd.w + 4, nd.h + 4, COL.cyan, pu * 0.6);
        pushLight(nd.x + 7, nd.y + 7, 46 + pu * 24, COL.cyan, 0.45 + pu * 0.4);
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

/** Довільна лінія одним спрайтом: поворот замість Graphics. */
function line(pool, x1, y1, x2, y2, col, alpha, th) {
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy);
  if (L < 0.5) return null;
  const s = pool.get(px());
  s.anchor.set(0, 0.5);
  s.x = x1; s.y = y1;
  s.width = L; s.height = th || 1;
  s.rotation = Math.atan2(dy, dx);
  s.tint = col; s.alpha = alpha;
  return s;
}

/* ---------------------------------- ПОЧЕРК ЗБРОЇ
   Кожен ефект живе у G.WFX і має власний малюнок. Правило просте:
   гравець має впізнати зброю в дії, не читаючи опису. */
function drawWfx(t) {
  const F = G.WFX;
  for (let i = 0; i < F.length; i++) {
    const f = F[i], k = f.t / f.max;
    const x = f.x - camX, y = f.y - camY;
    switch (f.k) {
      /* --- РЕЙКОСТРИЛ --- */
      case 'ray': {                                  // біла нитка з блакитним ореолом
        const x2 = x + f.face * f.len;
        const th = f.wide ? 3 : 1;
        entAddP.rect(px(), Math.min(x, x2), y - th - 1, f.len, th * 2 + 2, COL.ice, 0.30 * k);
        entP.rect(px(), Math.min(x, x2), y - th / 2, f.len, th, 0xffffff, k);
        pushLight(f.x + f.face * 12, f.y, 60, COL.ice, 0.7 * k);
        break;
      }
      case 'rings': {                                // магнітні кільця спалахують знизу вгору
        for (let r = 0; r < 3; r++) {
          const at = 1 - k;                          // 0 -> 1 за час ефекту
          const on = clamp(1 - Math.abs(at * 3 - r) * 2.2, 0, 1);
          const rx = x + f.face * (4 + r * 3);
          entP.rect(px(), rx - 1, y - 4 + r * 0.5, 2, 8 - r, 0x3a2050, 0.9);
          entAddP.rect(px(), rx - 1, y - 4 + r * 0.5, 2, 8 - r,
                       f.chg ? COL.yellow : COL.ice, on * (f.chg ? 1 : 0.85));
        }
        break;
      }
      case 'rift': {                                 // розрив простору по лінії пробою
        for (let r = 0; r < 7; r++) {
          const u = (r + 0.5) / 7;
          const rx = x + f.face * f.len * u;
          const h = (2 + (r % 3) * 3) * k;
          entAddP.rect(px(), rx, y - h, 1, h * 2, COL.white, 0.55 * k);
        }
        break;
      }
      /* --- ДРОБОВИК --- */
      case 'muzzle': {                               // спалах і розжарений зріз ствола
        if (k > 0.72) {
          const a = (k - 0.72) / 0.28;
          entAddP.rect(px(), x - 5, y - 5, 10, 10, COL.yellow, a * 0.9);
          entAddP.rect(px(), x - 9, y - 2, 18, 4, COL.orange, a * 0.6);
          pushLight(f.x, f.y, 64 * a, COL.yellow, a);
        }
        entAddP.rect(px(), x - 2, y - 1, 4, 2, COL.orange, k * 0.4);
        break;
      }
      /* --- ТАВРО --- */
      case 'plates': {                               // рукавиця розкладається на пластини
        const o = (1 - k) * 5;
        for (let r = 0; r < 4; r++) {
          const a = r * Math.PI / 2 + 0.4;
          entP.rect(px(), x + f.face * 7 + Math.cos(a) * o - 1, y + Math.sin(a) * o - 1, 3, 3, 0x2a1140, 1);
          entAddP.rect(px(), x + f.face * 7 + Math.cos(a) * o - 1, y + Math.sin(a) * o - 1, 3, 3,
                       COL.violet, 0.5 + 0.5 * k);
        }
        pushLight(f.x + f.face * 7, f.y, 40, COL.violet, 0.6 * k);
        break;
      }
      case 'crack': {                                // тріщина, що біжить підлогою
        if (f.t > f.max - f.delay) break;            // ще не дійшла сюди
        const a = clamp(k * 1.6, 0, 1);
        entP.rect(px(), x, y, f.len, 1, 0x150a22, a);
        entAddP.rect(px(), x, y - 1, f.len, 1, COL.yellow, a * 0.5);
        break;
      }
      case 'grav': {                                 // гравітаційне поле навколо схопленого
        const r = 10 + 4 * Math.sin(t * 12);
        for (let n = 0; n < 10; n++) {
          const a = n / 10 * Math.PI * 2 + t * 2;
          entAddP.rect(px(), x + Math.cos(a) * r - 1, y + Math.sin(a) * r * 0.7 - 1, 2, 2,
                       COL.violet, 0.8 * k);
        }
        break;
      }
      /* --- ПЛАЗМОВІ КІГТІ --- */
      case 'cut': {                                  // три паралельні розрізи під кутом
        for (let r = 0; r < 3; r++) {
          const oy = y - 4 + r * 4;
          const x1 = x + f.face * 3, x2 = x + f.face * 15;
          line(entAddP, x1, oy - 3, x2, oy + 3, 0x00ffcc, k * 0.95, 1);
          line(entAddP, x1 + f.face, oy - 3, x2 + f.face, oy + 3, COL.white, k * 0.6, 1);
        }
        pushLight(f.x + f.face * 9, f.y, 34, 0x00ffcc, k * 0.7);
        break;
      }
      case 'boom': {                                 // вибух п'ятого стака
        const r = (1 - k) * f.r;
        for (let n = 0; n < 14; n++) {
          const a = n / 14 * Math.PI * 2;
          entAddP.rect(px(), x + Math.cos(a) * r - 1, y + Math.sin(a) * r - 1, 3, 3, COL.white, k);
        }
        break;
      }
      /* --- ХРОНОРІЗ --- */
      case 'phant': {                                // синя фантомна копія на траєкторії
        const tex = T.hero_dash || T.hero_run1 || T.hero_idle;
        const sp = putEnt(entAddP, tex, f.x, f.y, 10, 14, f.face, 0);
        sp.tint = 0x6f8fff; sp.alpha = k * 0.55;
        break;
      }
      case 'rip': {                                  // вертикальний розріз-спалах у спину
        entAddP.rect(px(), x - 1, y - f.h / 2, 2, f.h, COL.white, k);
        entAddP.rect(px(), x - 3, y - f.h / 2, 6, f.h, 0x8f6fff, k * 0.5);
        pushLight(f.x, f.y, 50, 0x8f6fff, k * 0.8);
        break;
      }
      /* --- ЕХО-ПРИЗМА --- */
      case 'node': {                                 // підсвічений кут рикошету
        const r = 9;
        line(entAddP, x, y, x + Math.cos(f.a0) * r, y + Math.sin(f.a0) * r, COL.ice, k * 0.8, 1);
        line(entAddP, x, y, x + Math.cos(f.a1) * r, y + Math.sin(f.a1) * r, COL.white, k, 1);
        entAddP.rect(px(), x - 2, y - 2, 4, 4, COL.white, k);
        break;
      }
      case 'grid':                                   // геометрична сітка, що згасає
        line(entAddP, x, y, f.x2 - camX, f.y2 - camY, 0x8fdcff, k * 0.45, 1);
        break;
      /* --- РІЙ --- */
      case 'dbeam':
        line(entAddP, x, y, f.x2 - camX, f.y2 - camY, f.col, k, 1);
        break;
    }
  }
}

/* Дрони «Рою»: три штуки видно завжди — кружляють поруч, у бою
   відриваються від строю, а порожній тьмяніє й опускається нижче. */
function drawDrones() {
  const t = G.world.time;
  for (let i = 0; i < G.DRONES.length; i++) {
    const d = G.DRONES[i];
    const sx = d.x - camX, sy = d.y - camY;
    const empty = d.cd > 0;                          // на перезарядці
    const s = entP.get(T.e_mote);
    s.anchor.set(0.5, 0.5);
    s.x = Math.round(sx); s.y = Math.round(sy);
    s.rotation = t * 6 + i;                          // корпус повільно крутиться
    s.tint = empty ? 0x6a5a80 : 0xffffff;
    s.alpha = empty ? 0.45 : 1;
    // власний кольоровий слід — видно, який саме дрон полетів бити
    if (d.tr && d.tr.length > 3) {
      const n = d.tr.length / 2;
      for (let k = 1; k < n; k++)
        line(entAddP, d.tr[(k - 1) * 2] - camX, d.tr[(k - 1) * 2 + 1] - camY,
             d.tr[k * 2] - camX, d.tr[k * 2 + 1] - camY, d.col, (k / n) * 0.55, 1);
    }
    const hot = d.hitT > 0.3;
    entAddP.rect(px(), sx - 1, sy - 1, 2, 2, hot ? COL.yellow : d.col, empty ? 0.35 : 0.9);
    pushLight(d.x, d.y, empty ? 12 : (hot ? 44 : 26), hot ? COL.yellow : d.col,
              empty ? 0.12 : (hot ? 0.6 : 0.32));
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

/* «Оса»: сканер на стволі клацає на цілі за мить до пострілу. */
function drawScan(t) {
  const P = G.P, e = P.scan;
  if (!e || e.dead || G.EQ.r.id !== 'osa') return;
  const mx = P.x + P.w / 2 + P.face * 8, my = P.y + 6;
  const ex = e.x + e.w / 2, ey = e.y + e.h / 2;
  line(entAddP, mx - camX, my - camY, ex - camX, ey - camY, COL.yellow, 0.16, 1);
  const k = 0.5 + 0.5 * Math.sin(t * 18);
  for (const [ox, oy] of [[0, 0], [e.w, 0], [0, e.h], [e.w, e.h]])
    entAddP.rect(px(), e.x + ox - 1 - camX, e.y + oy - 1 - camY, 2, 2, COL.yellow, 0.35 + 0.4 * k);
}

function drawPlayer(th) {
  const P = G.P, t = G.world.time;
  drawWhip(t);                                     // зброя видима навіть коли героїня блимає
  if (P.dead && P.deadT <= 0.05) return;
  if (P.inv > 0 && P.hurtT <= 0 && Math.floor(P.inv * 22) % 2 === 0) return;
  const tex = T['hero_' + P.anim] || T.hero_idle;
  const sx = Math.round(P.x - 1 - camX), sy = Math.round(P.y - camY);

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
  if (G.getSlow() > 0 && Math.abs(P.vx) + Math.abs(P.vy) > 12)
    for (let q = 1; q <= 2; q++) {                  // той самий слід і за героїнею
      const gh = putEnt(entAddP, tex, P.x - P.vx * 0.035 * q, P.y - P.vy * 0.035 * q,
                        P.w, P.h, P.face, 0);
      gh.tint = 0x6f8fff; gh.alpha = 0.26 / q;
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
    if (b.tr && b.tr.length > 3) {                 // «Оса»: видно саме дугу доводки
      const n = b.tr.length / 2;
      for (let k = 1; k < n; k++)
        line(entAddP, b.tr[(k - 1) * 2] - camX, b.tr[(k - 1) * 2 + 1] - camY,
             b.tr[k * 2] - camX, b.tr[k * 2 + 1] - camY, COL.yellow, (k / n) * 0.7, 1);
    }
    if (b.pix) {                                   // Гліч-Код: постріл розсипається пікселями
      for (let k = 0; k < b.pix.length; k++) {
        const q = b.pix[k], w = G.world.time * q.sp * 9;
        entAddP.rect(px(), b.x + q.ox * (0.5 + 0.5 * Math.sin(w)) - camX,
                     b.y + q.oy * (0.5 + 0.5 * Math.cos(w * 1.3)) - camY,
                     2, 2, k % 2 ? 0x00ffcc : COL.white, 0.85);
      }
    }
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

/** Текст катсцени: окремий контейнер, тож завжди поверх смуг і HUD. */
const cutTexts = {};
function ctxt(key, str, x, y, size, color, align) {
  let t = cutTexts[key];
  if (!t) {
    t = new Text({
      text: str,
      style: { fontFamily: FONT, fontSize: size, fill: color, letterSpacing: 1,
               dropShadow: { color: 0x12081c, blur: 0, distance: 1, angle: Math.PI / 4, alpha: 1 } }
    });
    t.resolution = 2;
    cutTexts[key] = t;
    cutC.addChild(t);
  }
  if (t.text !== str) t.text = str;
  if (t.style.fontSize !== size) t.style.fontSize = size;
  if (t.style.fill !== color) t.style.fill = color;
  t.anchor.set(align === 'center' ? 0.5 : (align === 'right' ? 1 : 0), 0);
  t.x = x; t.y = y; t.visible = true; t.alpha = 1;
  return t;
}
function hideCutTxt(key) { if (cutTexts[key]) cutTexts[key].visible = false; }

/* -------------------------------------------------------- КАТСЦЕНИ
   Малюємо поверх усього: чорні смуги, портрет із анімацією появи,
   ім'я, репліка й підказка «Тап — пропустити». Дані бере з Cut.view(),
   логіка кроків живе в cutscene.js. */
const CUT_BAR = 34;                                  // висота чорної смуги
function wrapCut(str, max) {
  if (str.length <= max) return [str];
  const w = str.split(' '), out = []; let cur = '';
  for (const q of w) {
    if ((cur + ' ' + q).trim().length > max) { out.push(cur.trim()); cur = q; }
    else cur += ' ' + q;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.slice(0, 3);
}
function drawCut() {
  const v = G.Cut.view();
  if (!v.on) {
    for (const k in cutTexts) cutTexts[k].visible = false;
    return;
  }
  for (const k in hudTexts) hudTexts[k].visible = false;   // HUD на час катсцени зникає
  const hide = v.fade > 0.85;
  // смуги: кадр стає кінематографічним і ховає HUD
  cutP.rect(px(), 0, 0, vw, CUT_BAR, 0x000000, 1);
  cutP.rect(px(), 0, VH - CUT_BAR, vw, CUT_BAR, 0x000000, 1);
  cutP.rect(px(), 0, CUT_BAR, vw, 1, 0x3a2050, 0.8);
  cutP.rect(px(), 0, VH - CUT_BAR - 1, vw, 1, 0x3a2050, 0.8);

  // панель діалогу: без неї репліка губиться на тлі рівня
  const PY = VH - CUT_BAR - 58, PH2 = 58;
  cutP.rect(px(), 0, PY, vw, PH2, 0x0b0413, 0.86);
  cutP.rect(px(), 0, PY, vw, 1, 0x3a2050, 0.9);

  // портрет 48x48 ліворуч, із анімацією появи
  const tex = v.portrait ? T[v.portrait] : null;
  if (tex) {
    const k = clamp(v.animT / 0.35, 0, 1);
    let ox = 0, oy = 0, a = 1;
    if (v.anim === 'slide') { ox = -48 * (1 - k); a = k; }
    else if (v.anim === 'rise') { oy = 30 * (1 - k); a = k; }
    else if (v.anim === 'glitch') {
      a = k < 1 ? (Math.floor(v.animT * 30) % 2 ? 0.35 : 1) : 1;
      ox = k < 1 ? Math.round(Math.sin(v.animT * 40) * 5 * (1 - k)) : 0;
    } else a = k;
    const s2 = cutP.get(tex);
    s2.x = 7 + ox; s2.y = PY + 5 + oy; s2.alpha = a;
    // тонка рамка кольором фракції
    cutP.rect(px(), 6 + ox, PY + 4 + oy, 50, 1, 0xff2e88, a * 0.9);
    cutP.rect(px(), 6 + ox, PY + 53 + oy, 50, 1, 0xff2e88, a * 0.9);
    cutP.rect(px(), 6 + ox, PY + 4 + oy, 1, 50, 0xff2e88, a * 0.9);
    cutP.rect(px(), 55 + ox, PY + 4 + oy, 1, 50, 0xff2e88, a * 0.9);
  }
  // ім'я та репліка
  const tx = tex ? 64 : 12;
  if (v.by && !hide) ctxt('cutName', v.by, tx, PY + 5, 11, 0x22e0ff);
  else hideCutTxt('cutName');
  const lines = (v.say && !hide) ? wrapCut(v.say, Math.floor((vw - tx - 14) / 5.6)) : [];
  for (let i = 0; i < 3; i++) {
    if (i < lines.length) ctxt('cutL' + i, lines[i], tx, PY + 20 + i * 13, 12, 0xe8ddf5);
    else hideCutTxt('cutL' + i);
  }
  // підказка про пропуск — видно завжди, перші три секунди яскравіше
  if (hide) hideCutTxt('cutHint');
  else ctxt('cutHint', 'ТАП — ПРОПУСТИТИ', vw - 10, VH - CUT_BAR + 11, 9, 0x9a7fb5, 'right')
         .alpha = v.hint;

  if (v.flash > 0) cutP.rect(px(), 0, 0, vw, VH, 0xffffff, clamp(v.flash, 0, 1));
  if (v.fade > 0) cutP.rect(px(), 0, 0, vw, VH, 0x000000, clamp(v.fade, 0, 1));
}

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
  // Панель розробника вмикає сітку й хітбокси окремо; старий прапорець
  // Store.data.dbg із налаштувань лишається й показує все одразу.
  const all = Store.data.dbg;
  const wantGrid = all || (DEV_MODE && CH.grid);
  const wantBox = all || (DEV_MODE && CH.boxes);
  const box = (x, y, w, h, col, a) => {
    entAddP.rect(px(), Math.round(x - camX), Math.round(y - camY), w, 1, col, a);
    entAddP.rect(px(), Math.round(x - camX), Math.round(y + h - 1 - camY), w, 1, col, a);
    entAddP.rect(px(), Math.round(x - camX), Math.round(y - camY), 1, h, col, a);
    entAddP.rect(px(), Math.round(x + w - 1 - camX), Math.round(y - camY), 1, h, col, a);
  };
  // сітка тайлів
  const x0 = Math.floor(camX / TS), x1 = Math.ceil((camX + vw) / TS);
  if (wantGrid) {
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
    // рівень підлоги під героїнею — жовта лінія на всю ширину екрана
    const f0 = floorUnder(P.x + P.w / 2, P.y + P.h);
    if (f0 !== null) {
      entAddP.rect(px(), 0, Math.round(f0 - camY), vw, 1, 0xffd23f, 0.9);
      entAddP.rect(px(), Math.round(P.x + P.w / 2 - camX), Math.round(f0 - camY) - 3, 1, 3, 0xffd23f, 0.9);
    }
  }
  if (wantBox) {                                   // хітбокси ворогів, атак і героїні
    for (let i = 0; i < G.ENEM.length; i++) {
      const e = G.ENEM[i];
      if (e.dead) continue;
      box(e.x, e.y, e.w, e.h, 0xff3355, 0.9);
    }
    if (G.BOSS.on) for (const hb of G.bossHitBoxes()) box(hb.x, hb.y, hb.w, hb.h, 0xff3355, 0.9);
    for (let i = 0; i < G.BULL.length; i++) {      // кулі — теж хітбокси
      const b = G.BULL[i];
      box(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, b.own === 'e' ? 0xff6b3d : 0x3dff9a, 0.8);
    }
    if (P.atkT > 0) { const bb = G.bladeBox(); box(bb.x, bb.y, bb.w, bb.h, 0xffd23f, 0.95); }
    box(P.x, P.y, P.w, P.h, 0xff3355, 1);
  }
  if (all) {                                       // цифри старого режиму з налаштувань
    const f = floorUnder(P.x + P.w / 2, P.y + P.h);
    const tex = T['hero_' + P.anim] || T.hero_idle;
    txt('dbg1', 'ХІТБОКС ' + P.w + 'x' + P.h + '  СПРАЙТ ' + tex.width + 'x' + tex.height, 4, VH - 26, 9, 0xffd23f);
    txt('dbg2', 'НИЗ ХІТБОКСА y=' + (P.y + P.h).toFixed(1) + '   ПІДЛОГА y=' + (f === null ? '—' : f.toFixed(1)) +
                '   onGround=' + (P.onGround ? '1' : '0'), 4, VH - 15, 9, 0x3dff9a);
  } else { hideTxt('dbg1'); hideTxt('dbg2'); }
}

/* ------------------------------------------------- ДІАГНОСТИКА (DEV)
   Усе тут вмикається окремими перемикачами в панелі й НЕ міняє поведінку
   гри — тільки малює поверх. При DEV_MODE = false Rollup викидає і цю
   функцію, і її виклик разом із модулем читів. */
const AST_NAME = { 10: 'IDLE', 20: 'RUN', 30: 'LAND', 45: 'FALL', 50: 'JUMP',
                   60: 'DASH', 70: 'ATTACK', 80: 'HURT', 90: 'DEAD' };
const ALERT_COL = { calm: 0x3dff9a, suspect: 0xffd23f, fight: 0xff3355, lost: 0x22e0ff };
let poolPeak = { bull: 0, enem: 0, part: 0 };
function drawDiag() {
  const P = G.P, W = G.world;

  /* --- стан ШІ кожного ворога: колір за станом, лінія до цілі, токен --- */
  if (CH.ai) {
    for (let i = 0; i < G.ENEM.length; i++) {
      const e = G.ENEM[i];
      if (e.dead) continue;
      const sx = e.x - camX, sy = e.y - camY;
      if (sx < -60 || sx > vw + 60) continue;
      const col = ALERT_COL[e.alertSt] || 0x9a7fb5;
      entAddP.rect(px(), Math.round(sx), Math.round(sy) - 6, e.w, 2, col, 0.95);
      // токен атаки — жовта позначка збоку: видно, кому дозволено бити
      if (e.token) entAddP.rect(px(), Math.round(sx) + e.w + 1, Math.round(sy) - 6, 3, 3, 0xffd23f, 1);
      // лінія до цілі: у бою — до героїні, інакше до останньої відомої точки
      if (e.alertSt === 'fight')
        line(entAddP, sx + e.w / 2, sy + e.h / 2, P.x + P.w / 2 - camX, P.y + P.h / 2 - camY, col, 0.30, 1);
      else if (e.alertSt === 'lost')                 // до останньої відомої точки
        line(entAddP, sx + e.w / 2, sy + e.h / 2, e.lastSeen - camX, sy + e.h / 2, col, 0.30, 1);
      txt('ai' + i, (e.st || '?') + (e.token ? '*' : ''), Math.round(sx), Math.round(sy) - 16, 8, col);
    }
    for (let i = G.ENEM.length; i < 24; i++) hideTxt('ai' + i);
  } else for (let i = 0; i < 24; i++) hideTxt('ai' + i);

  /* --- цифри: кадр, героїня, пули --- */
  if (CH.diag) {
    hudP.rect(px(), 0, 0, 232, 60, 0x000000, 0.62);   // підкладка: цифри читаються поверх HUD
    const cnt = { bull: G.BULL.length, enem: G.ENEM.length, part: G.PARTS.length };
    poolPeak.bull = Math.max(poolPeak.bull, cnt.bull);
    poolPeak.enem = Math.max(poolPeak.enem, cnt.enem);
    poolPeak.part = Math.max(poolPeak.part, cnt.part);
    const fps = Gfx.fps;
    txt('dg0', 'FPS ' + fps.toFixed(0) + '   КАДР ' + Gfx.frameMs.toFixed(1) + ' мс   СПРАЙТІВ ' + Gfx.entCount(),
        4, 4, 9, fps < 50 ? 0xff6b3d : 0x3dff9a);
    txt('dg1', 'x ' + P.x.toFixed(1) + '  y ' + P.y.toFixed(1) +
               '   vx ' + P.vx.toFixed(1) + '  vy ' + P.vy.toFixed(1), 4, 15, 9, 0xbff4ff);
    txt('dg2', 'onGround ' + (P.onGround ? '1' : '0') +
               '   СТАН ' + (AST_NAME[P.aState] || P.aState) + '   КАДР ' + P.anim, 4, 26, 9, 0xffd23f);
    txt('dg3', 'ПУЛИ  кулі ' + cnt.bull + '/' + poolPeak.bull +
               '  вороги ' + cnt.enem + '/' + poolPeak.enem +
               '  частинки ' + cnt.part + '/' + poolPeak.part +
               '  дрони ' + G.DRONES.length, 4, 37, 9,
        poolPeak.part >= 255 ? 0xff6b3d : 0x9a7fb5);
    txt('dg4', 'СЕКТОР ' + (W.idx + 1) + '   HP ' + P.hp + '/' + P.maxHp +
               (G.BOSS.on ? '   БОС ' + G.BOSS.hp.toFixed(0) + '/' + G.BOSS.maxHp +
                            ' ФАЗА ' + G.BOSS.phase + (G.BOSS.rage ? ' ЛЮТЬ' : '') : ''),
        4, 48, 9, 0x22e0ff);
  } else for (const k of ['dg0', 'dg1', 'dg2', 'dg3', 'dg4']) hideTxt(k);

  /* --- останні помилки з консолі --- */
  if (CH.errs) {
    const list = (window.__DBG && window.__DBG.errors) || [];
    for (let i = 0; i < 10; i++) {
      const m = list[list.length - 1 - i];
      if (m) txt('er' + i, m.slice(0, 74), 4, VH - 12 - i * 10, 8, 0xff6b7f);
      else hideTxt('er' + i);
    }
  } else for (let i = 0; i < 10; i++) hideTxt('er' + i);
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
  // Хроноріз: на телепорті світ на 0,1 с знебарвлюється, у сповільненні —
  // холодний синій відтінок. Обидва ефекти живуть тільки з цією зброєю.
  const desat = G.getDesat();
  const slow = G.getSlow() > 0 ? 1 : 0;
  paletteF.saturation = 1.0 + (W.theme === 'virtual' ? 0.08 : 0) - desat * 0.95 - slow * 0.35;
  const flash = (B.on && B.st === 'die') ? 0.10 + 0.10 * Math.sin(W.time * 30) :
                (P.hurtT > 0 ? 0.10 * P.hurtT : 0) + desat * 0.12;
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
