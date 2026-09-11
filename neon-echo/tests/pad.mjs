/**
 * Керування після промта №8: дві стрілки ← →, жодного присідання,
 * спуск крізь тонку платформу — утримання A 0,4 с.
 *   node tests/pad.mjs
 */
let pw;
try { pw = await import('playwright'); }
catch (e) { pw = await import('/opt/node22/lib/node_modules/playwright/index.js'); }
const chromium = pw.chromium || pw.default.chromium;
const file = process.env.URL || 'http://localhost:4173/';

let fails = 0;
const ok = (c, m, extra) => { if (!c) { fails++; console.log('  ✗ ' + m + (extra ? '  → ' + extra : '')); }
                              else console.log('  ✓ ' + m + (extra ? '  (' + extra + ')' : '')); };

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 900, height: 420 }, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(file);
await page.waitForFunction(() => !!window.__DEV);
await page.click('#mPlay');
await page.waitForTimeout(250);

console.log('ХРЕСТОВИНИ БІЛЬШЕ НЕМА\n');

const geo = await page.evaluate(() => {
  const d = document.getElementById('dpad');
  const arws = [...d.querySelectorAll('polygon')];
  const rL = document.getElementById('dpL').getBoundingClientRect();
  const rR = document.getElementById('dpR').getBoundingClientRect();
  const C = window.__DEV.CONFIG, p = window.__DEV.pad;
  return { n: arws.length, up: !!document.getElementById('dpU'), dn: !!document.getElementById('dpD'),
           lw: rL.width, lh: rL.height, rw: rR.width, rh: rR.height,
           gap: rR.left - rL.right, cfg: { w: C.ARROW_W, h: C.ARROW_H, g: C.ARROW_GAP, hit: C.DPAD_HIT },
           padW: p.w, padH: p.h, hw: p.hw, hh: p.hh };
});
ok(geo.n === 2 && !geo.up && !geo.dn, 'у розмітці лишилися рівно дві стрілки, ↑ і ↓ видалені',
   'polygon×' + geo.n);
ok(Math.abs(geo.lw - 90) < 8 && Math.abs(geo.lh - 120) < 8 &&
   Math.abs(geo.rw - 90) < 8 && Math.abs(geo.rh - 120) < 8,
   'кожна стрілка ≈ 90×120 CSS-px',
   '← ' + geo.lw.toFixed(0) + '×' + geo.lh.toFixed(0) + ', → ' + geo.rw.toFixed(0) + '×' + geo.rh.toFixed(0));
ok(Math.abs(geo.gap - 10) < 6, 'проміжок між стрілками ≈ 10 px', geo.gap.toFixed(1) + ' px');
ok(Math.abs(geo.hw / (geo.padW / 2) - 1.30) < 0.02 && Math.abs(geo.hh / (geo.padH / 2) - 1.30) < 0.02,
   'хітбокс на 30 % більший за візуал',
   'ширина ×' + (geo.hw / (geo.padW / 2)).toFixed(2) + ', висота ×' + (geo.hh / (geo.padH / 2)).toFixed(2));

// --- за межами розширеного хітбокса напрямок не вмикається ---
const cdp = await ctx.newCDPSession(page);
const p = await page.evaluate(() => ({ x: window.__DEV.pad.x, y: window.__DEV.pad.y,
                                       w: window.__DEV.pad.w,
                                       hw: window.__DEV.pad.hw, hh: window.__DEV.pad.hh }));
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart',
  touchPoints: [{ x: p.x - p.w * 0.25, y: p.y - p.hh - 24, id: 21 }] });
await page.waitForTimeout(120);
const outside = await page.evaluate(() => window.__DEV.S.ax);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
ok(outside === 0, 'дотик вище за розширений хітбокс напрямку не дає', 'ax=' + outside);

// нижній зовнішній кут (там, де лежить великий палець) — ще ←
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart',
  touchPoints: [{ x: Math.max(3, p.x - p.hw + 6), y: p.y + p.hh - 6, id: 22 }] });
await page.waitForTimeout(120);
const corner = await page.evaluate(() => window.__DEV.S.ax);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
ok(corner < -0.2, 'палець у нижньому зовнішньому куті хітбокса тримає ←', 'ax=' + corner);

// нахил усередину: верх зони зсунуто до центра екрана
const tilt = await page.evaluate(() => {
  const D = window.__DEV, C = D.CONFIG, pd = D.pad;
  const dy = pd.h / 2;                       // верх візуальної коробки
  return { shift: dy * C.DPAD_TILT, tilt: C.DPAD_TILT };
});
ok(tilt.tilt > 0.1 && tilt.shift > 8,
   'хітбокс нахилений усередину — верх зсунуто до центра екрана',
   '+' + tilt.shift.toFixed(0) + ' px на верхньому краю');

console.log('\nПРИСІДАННЯ ПРИБРАНО');
const cr = await page.evaluate(() => {
  const D = window.__DEV;
  D.Game.startLevel(0, false);
  const h0 = D.P.h;
  D.P.x = 60; D.P.y = 13 * D.TS - h0;
  for (let i = 0; i < 40; i++) { D.kb.a = i % 8 < 3 ? 1 : 0; D.step(); }
  D.kb.a = 0;
  return { field: 'crouch' in D.P, down: 'down' in D.S, kbd: 'd' in D.kb,
           h: D.P.h, same: D.P.h === h0 };
});
ok(!cr.field, 'у гравця немає поля crouch');
ok(!cr.down, 'у вводі немає стану «вниз»');
ok(!cr.kbd, 'клавіша ↓ більше нічого не тримає');
ok(cr.same, 'висота хітбокса героїні не міняється ні від чого', cr.h + ' px постійно');

console.log('\nСПУСК КРІЗЬ ТОНКУ ПЛАТФОРМУ — УТРИМАННЯ A');
const drop = await page.evaluate(() => {
  const D = window.__DEV, P = D.P, W = D.world, TS = D.TS || 16;
  D.Game.startLevel(0, false); D.god(true);
  // Механіку сектора на час заміру глушимо: кімната-виклик спавнить
  // ворогів, і вони збивають героїню з платформи — а міряємо ми спуск,
  // а не бій. Сама механіка перевіряється в tests/levels.mjs.
  D.G.LFX.on = false; D.G.LFX.chal = null; D.ENEM.length = 0;
  // шукаємо тонку платформу ('=' → T_PLAT) з порожнечею під нею
  let spot = null;
  for (let ty = 3; ty < W.th - 2 && !spot; ty++)
    for (let tx = 2; tx < W.tw - 2; tx++)
      if (D.tAt(tx, ty) === 2 && D.tAt(tx, ty + 1) === 0 && D.tAt(tx, ty + 2) === 0 &&
          D.tAt(tx - 1, ty) === 2 && D.tAt(tx + 1, ty) === 2) { spot = { tx, ty }; break; }
  if (!spot) return { none: true };

  const put = () => { P.x = spot.tx * TS + 3; P.y = spot.ty * TS - P.h - 6; P.vy = 0; P.vx = 0;
                      P.dropT = 0; P.dropHold = 0; P.jbuf = 0; P.jumps = 0;
                      D.kb.a = 0; D.step(); };

  // 1) тапи по A не провалюють: щоразу це просто стрибок
  put(); for (let i = 0; i < 30; i++) D.step();
  const y0 = P.y; let tapDropped = false;
  for (let t = 0; t < 4; t++) {
    D.kb.a = 1; D.step(); D.kb.a = 0;
    for (let i = 0; i < 30; i++) { D.step(); if (P.y > y0 + TS) tapDropped = true; }
  }

  // 2) утримання A: перше натискання = стрибок, після приземлення тримаємо далі
  put(); for (let i = 0; i < 30; i++) D.step();
  const yStart = P.y;
  D.kb.a = 1;
  let frames = 0, fell = false, holdAtFall = 0;
  for (let i = 0; i < 200; i++) {
    D.step(); frames++;
    if (P.y > yStart + TS) { fell = true; holdAtFall = frames / 60; break; }
  }
  D.kb.a = 0;
  return { tapDropped, fell, sec: holdAtFall, drop: D.CONFIG.DROP_HOLD };
});
ok(!drop.none, 'у рівні 1 знайдено тонку платформу для перевірки');
ok(drop.tapDropped === false, 'тапи по A не провалюють крізь платформу — це звичайні стрибки');
ok(drop.fell === true, 'утримання A провалює героїню крізь тонку платформу',
   'через ' + (drop.sec || 0).toFixed(2) + ' с');
ok(drop.fell && drop.sec <= 1.4, 'спуск настає швидко (стрибок + ' + drop.drop + ' с утримання)',
   (drop.sec || 0).toFixed(2) + ' с');

ok(errors.length === 0, 'без помилок JS' + (errors.length ? ': ' + errors[0] : ''));
console.log('\n' + (fails === 0 ? 'КЕРУВАННЯ: УСЕ ЧИСТО' : 'КЕРУВАННЯ: ПРОБЛЕМ ' + fails));
await browser.close();
process.exit(fails === 0 ? 0 : 1);
