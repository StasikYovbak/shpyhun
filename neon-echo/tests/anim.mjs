/**
 * Машина станів анімації: чи повертається героїня у спокій, коли гравець
 * відпустив усе. П'ять ситуацій із ТЗ + перевірка залипання при згортанні.
 *   node tests/anim.mjs
 */
let pw; try { pw = await import('playwright'); } catch (e) { pw = await import('/opt/node22/lib/node_modules/playwright/index.js'); }
const chromium = pw.chromium || pw.default.chromium;
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 900, height: 420 }, hasTouch: true });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(process.env.URL || 'http://localhost:4173/');
await page.waitForFunction(() => !!window.__DEV, null, { timeout: 20000 });
// Перший запуск питає про навчання (промт №13). Цей набір перевіряє
// не його, тож позначаємо питання як уже поставлене — інакше «Грати»
// відкриє екран навчання замість гри.
await page.evaluate(() => { window.__DEV.Store.data.tutAsked = 1; window.__DEV.Store.save(); });
await page.click('#mPlay');
await page.waitForTimeout(400);

let fails = 0;
const ok = (c, m, extra) => { if (!c) { fails++; console.log('  ✗ ' + m + (extra ? '  → ' + extra : '')); }
                              else console.log('  ✓ ' + m + (extra ? '  (' + extra + ')' : '')); };
const T = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });

console.log('СПОКІЙ ПІСЛЯ ВІДПУСКАННЯ — 5 СИТУАЦІЙ\n');
console.log('  ситуація               кадрів: усього / від приземлення');
console.log('  ' + '-'.repeat(74));

/** Відпускаємо все й рахуємо кадри до IDLE (ліміт 0,2 с = 12 кадрів). */
const settle = (setup) => page.evaluate((setup) => {
  const D = window.__DEV, P = D.P;
  const NAME = { 10: 'IDLE', 20: 'RUN', 30: 'LAND', 45: 'FALL',
                 50: 'JUMP', 60: 'DASH', 70: 'ATTACK', 80: 'HURT', 90: 'DEAD' };
  D.Game.startLevel(0, false); D.god(true);
  D.kb.l = D.kb.r = D.kb.a = D.kb.b = D.kb.c = D.kb.d = 0;
  P.x = 60; P.y = 13 * D.TS - P.h; P.vx = 0; P.vy = 0;
  for (let i = 0; i < 20; i++) D.step();
  eval(setup);                                       // ситуація готується тут
  D.kb.l = D.kb.r = D.kb.a = D.kb.b = D.kb.c = D.kb.d = 0;   // ВІДПУСТИЛИ ВСЕ
  const path = [];
  let n = -1, land = -1;
  for (let i = 0; i < 90; i++) {
    D.step();
    const st = NAME[P.aState] || P.aState;
    if (!path.length || path[path.length - 1] !== st) path.push(st);
    if (P.onGround && land < 0) land = i;            // з цього кадру спокій узагалі можливий
    if (P.aState === 10 && n < 0) { n = i + 1; break; }
  }
  // час падіння — не вина анімації: рахуємо ще й від моменту, коли ноги на землі
  return { n, ground: land >= 0 ? n - land : n, path, anim: P.anim, vx: +P.vx.toFixed(2) };
}, setup);

const CASES = [
  ['на землі (біг →)', 'D.kb.r=1; for(let i=0;i<40;i++) D.step();'],
  ['у повітрі (стрибок)', 'D.kb.r=1; D.kb.a=1; for(let i=0;i<30;i++) D.step();'],
  ['під час атаки', 'D.kb.r=1; for(let i=0;i<20;i++) D.step(); D.kb.b=1; D.step();'],
  ['після ривка', 'D.kb.r=1; for(let i=0;i<20;i++) D.step(); D.S.dashP=true; D.step();'],
  ['після виходу з паузи', 'D.kb.r=1; for(let i=0;i<25;i++) D.step(); D.Game.pause(); D.Game.resume();']
];
for (const [name, setup] of CASES) {
  const r = await settle(setup);
  const good = r.n > 0 && r.ground <= 12;            // ліміт 0,2 с від моменту на землі
  if (!good) fails++;
  console.log('  ' + (good ? '✓ ' : '✗ ') + name.padEnd(22) +
    String(r.n).padStart(4) + ' / ' + String(r.ground).padStart(2) +
    '   ' + (r.ground / 60).toFixed(3) + ' c   ' + r.path.join(' → ') +
    (r.n > 0 ? '' : '  (застряг у ' + r.anim + ', vx=' + r.vx + ')'));
}

console.log('\nЗАЛИПАННЯ ВВОДУ ПРИ ЗГОРТАННІ\n');
const pos = await page.evaluate(() => { const p = window.__DEV.pad, b = window.__DEV.btn;
  return { R: { x: p.x + p.w * 0.25, y: p.y }, C: { x: b.C.x, y: b.C.y } }; });
const hide = () => page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  document.dispatchEvent(new Event('visibilitychange')); });
const show = () => page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  document.dispatchEvent(new Event('visibilitychange')); });

for (const [name, pt, read] of [['рух (стрілка →)', pos.R, 'ax'], ['стрільба (кнопка C)', pos.C, 'c']]) {
  await T('touchStart', [{ x: pt.x, y: pt.y, id: 42 }]);
  await page.waitForTimeout(120);
  await hide(); await page.waitForTimeout(150); await show(); await page.waitForTimeout(300);
  const v = await page.evaluate(k => window.__DEV.S[k], read);
  ok(!v, name + ': після згортання ввід не залипає', 'S.' + read + ' = ' + JSON.stringify(v));
  await T('touchEnd', []); await page.waitForTimeout(100);
}

console.log('\nСПОКІЙНИЙ КАДР\n');
const rest = await page.evaluate(() => {
  const D = window.__DEV, P = D.P;
  D.Game.startLevel(0, false); D.god(true);
  P.x = 60; P.y = 13 * D.TS - P.h; P.vx = 0; P.vy = 0;
  for (let i = 0; i < 20; i++) D.step();
  let air = 0, states = new Set(), frames = new Set();
  for (let i = 0; i < 120; i++) { D.step(); if (!P.onGround) air++; states.add(P.aState); frames.add(P.anim); }
  return { air, states: [...states], frames: [...frames] };
});
ok(rest.air === 0, 'стоячи на місці, героїня жодного кадру не «відривається» від землі',
   'кадрів у повітрі: ' + rest.air + ' зі 120');
ok(rest.states.length === 1 && rest.states[0] === 10, 'стан весь час IDLE', JSON.stringify(rest.states));
ok(rest.frames.every(f => f === 'idle' || f === 'blink'), 'кадри лише спокою й кліпання',
   rest.frames.join(', '));

const long = await page.evaluate(() => {
  const D = window.__DEV, P = D.P;
  const seen = new Set();
  for (let i = 0; i < 60 * 8; i++) { D.step(); seen.add(P.anim); }
  return [...seen];
});
ok(long.indexOf('idle2a') >= 0 || long.indexOf('idle2b') >= 0,
   'через 5 с простою вмикається довга анімація', long.join(', '));

if (errors.length) { console.log('\nПОМИЛКИ JS: ' + errors.slice(0, 5).join(' | ')); fails += errors.length; }
console.log('\n' + (fails === 0 ? 'АНІМАЦІЯ: УСЕ ЧИСТО' : 'ПРОБЛЕМ: ' + fails));
await browser.close();
process.exit(fails === 0 ? 0 : 1);
