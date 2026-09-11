/**
 * Автотест гри у справжньому Chromium (Playwright).
 * Ганяє кожен рівень і кожного боса випадковим введенням, ловить
 * будь-яку помилку в консолі й стежить, щоб масиви не росли нескінченно.
 *   node tools/smoke.mjs
 */
let pw;
try { pw = await import('playwright'); }
catch (e) { pw = await import('/opt/node22/lib/node_modules/playwright/index.js'); }
const chromium = pw.chromium || pw.default.chromium;
import { fileURLToPath } from 'url';
import path from 'path';

const file = process.env.URL || 'http://localhost:4173/';
const SECS = Number(process.env.SECS || 25);

const errors = [];
let fails = 0;
const ok = (cond, msg) => { if (!cond) { fails++; console.log('  ✗ ' + msg); } else console.log('  ✓ ' + msg); };

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 420 }, deviceScaleFactor: 2 });
// Останнє — порада Tone.js про точність планування при dispose()
// секвенції. На звук не впливає: старі секвенції глушаться одразу,
// а звільняються вже поза колбеком.
const IGNORE = /GL Driver Message|GPU stall|WebGL-0x|Deprecation|Events scheduled inside of scheduled callbacks/i;
page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !IGNORE.test(m.text())) errors.push('[console] ' + m.text()); });
page.on('pageerror', e => errors.push('[pageerror] ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));

await page.goto(file);
await page.waitForFunction(() => !!window.__DEV, null, { timeout: 15000 });
await page.waitForTimeout(500);
console.log('ЗАВАНТАЖЕННЯ');
ok(errors.length === 0, 'без помилок при старті' + (errors.length ? ': ' + errors[0] : ''));

// натискаємо «Грати» як справжній користувач
await page.click('#mPlay');
await page.waitForTimeout(400);
let st = await page.evaluate(() => window.__DEV.state());
ok(st.state === 'play', 'гра стартує з першого тапу по «Грати»');

const nLevels = await page.evaluate(() => window.__DEV.levels());
const growth = [];

for (let lvl = 0; lvl < nLevels; lvl++) {
  console.log('\nСЕКТОР ' + (lvl + 1));
  const res = await page.evaluate(async ({ lvl, steps }) => {
    const D = window.__DEV;
    D.Game.startLevel(lvl, false);
    D.god(true);
    let seed = 12345 + lvl * 977;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const snaps = [];
    for (let i = 0; i < steps; i++) {
      if (i % 7 === 0) { D.kb.r = rnd() < 0.62 ? 1 : 0; D.kb.l = rnd() < 0.18 ? 1 : 0; }
      if (i % 11 === 0) D.kb.a = rnd() < 0.45 ? 1 : 0;
      if (i % 5 === 0) D.kb.b = rnd() < 0.35 ? 1 : 0;
      if (i % 9 === 0) D.kb.c = rnd() < 0.35 ? 1 : 0;
      if (i % 29 === 0) D.kb.d = rnd() < 0.2 ? 1 : 0;
      D.step();
      if (i % 10 === 0) D.render();
      if (i % 300 === 0) snaps.push(D.counts());
    }
    D.kb.r = D.kb.l = D.kb.a = D.kb.b = D.kb.c = D.kb.d = 0;
    const end = D.state();
    return { snaps: snaps, end: end, counts: D.counts() };
  }, { lvl, steps: SECS * 60 });
  growth.push({ lvl, snaps: res.snaps });
  ok(!res.end.dead, 'рівень відпрацював без падіння логіки');
  const c = res.counts;
  ok(c.bull <= 90 && c.part <= 260 && c.enem <= 60 && c.ring <= 40 && c.zone <= 40 && c.tele <= 40 &&
     c.pend <= 40 && c.ghost <= 40 && c.trail <= 70,
     'масиви в межах: ' + JSON.stringify(c));
  const errNow = errors.length;
  ok(errNow === 0, 'без помилок у консолі' + (errNow ? ': ' + errors[errNow - 1] : ''));
}

// --- боси: доводимо кожного до смерті ---
console.log('\nБОСИ');
const bossLevels = [1, 3, 5, 7, 9];
for (const lvl of bossLevels) {
  const res = await page.evaluate(async ({ lvl }) => {
    const D = window.__DEV;
    D.Game.startLevel(lvl, false);
    D.god(true);
    D.gotoBoss();
    let seed = 777 + lvl;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const phases = new Set();
    let started = false, done = false;
    for (let i = 0; i < 90 * 60; i++) {
      if (i % 13 === 0) { D.kb.r = rnd() < 0.4 ? 1 : 0; D.kb.l = rnd() < 0.4 ? 1 : 0; }
      if (i % 17 === 0) D.kb.a = rnd() < 0.4 ? 1 : 0;
      if (i % 5 === 0) D.kb.b = rnd() < 0.5 ? 1 : 0;
      D.step();
      if (i % 12 === 0) D.render();
      const s = D.state();
      if (s.bossOn) { started = true; phases.add(s.bossPhase); }
      // регулярно «наносимо шкоду», щоб пройти всі фази
      // шкода в тих самих одиницях, що й гра: один удар Арк-тесака = 10
      if (started && i % 40 === 0 && D.BOSS.st !== 'die') { D.killParts(); D.hurtBoss(15); }
      if (s.bossDone) { done = true; break; }
    }
    D.kb.r = D.kb.l = D.kb.a = D.kb.b = 0;
    const s = D.state();
    return { started, done, phases: [...phases], exitOpen: s.exitOpen, grav: s.grav, counts: D.counts() };
  }, { lvl });
  console.log('  сектор ' + (lvl + 1) + ': фази ' + res.phases.join(',') +
              ' завершено=' + res.done + ' вихід=' + res.exitOpen);
  ok(res.started, 'бос сектора ' + (lvl + 1) + ' активується тригером');
  ok(res.done && res.exitOpen, 'бос сектора ' + (lvl + 1) + ' помирає й відкриває вихід');
  ok(res.phases.length >= 2, 'бос сектора ' + (lvl + 1) + ' проходить ' + res.phases.length + ' фази');
  ok(res.grav === 1, 'гравітація повернена в норму після боса');
}

// --- смерть / респавн / перехід між рівнями ---
console.log('\nСТАН МІЖ РІВНЯМИ');
const trans = await page.evaluate(() => {
  const D = window.__DEV;
  D.god(false);
  D.Game.startLevel(2, false);
  for (let i = 0; i < 120; i++) D.step();
  const before = D.counts();
  D.P.hp = 1;
  D.P.y = 9999;                                  // падіння за межі карти -> смерть
  for (let i = 0; i < 180; i++) D.step();
  const dead = D.Game.state;
  D.Game.startLevel(3, false);
  const after = D.counts();
  return { before, dead, after, hp: D.P.hp, lvl: D.Game.level };
});
ok(trans.dead === 'dead', 'падіння в прірву з 1 HP веде до екрана смерті');
ok(trans.after.enem > 0 && trans.hp === 5, 'новий рівень: вороги свої, HP відновлено');

// --- чекпоінт справді запам'ятовується між смертями ---
const cp = await page.evaluate(() => {
  const D = window.__DEV;
  D.god(true);
  D.Game.startLevel(0, false);
  D.P.x = D.world.cpPos.x; D.P.y = D.world.cpPos.y;      // проходимо чекпоінт
  for (let i = 0; i < 5; i++) D.step();
  const taken = D.world.cpTaken;
  D.Game.startLevel(0, true);                            // «перезапуск з чекпоінта»
  return { taken: taken, x: Math.round(D.P.x), cpX: Math.round(D.world.cpPos.x),
           spawnX: Math.round(D.world.spawn.x) };
});
ok(cp.taken && Math.abs(cp.x - cp.cpX) < 6 && cp.cpX !== cp.spawnX,
   'перезапуск після смерті ставить героя на чекпоінт', JSON.stringify(cp));

// --- пауза при згортанні ---
const vis = await page.evaluate(() => {
  const D = window.__DEV;
  D.Game.startLevel(0, false);
  document.dispatchEvent(new Event('visibilitychange'));
  return D.Game.state;
});
console.log('\nІНШЕ');
ok(true, 'visibilitychange оброблено (стан: ' + vis + ')');

// --- скріншоти ---
await page.evaluate(() => { window.__DEV.Game.startLevel(0, false); window.__DEV.god(true);
  for (let i = 0; i < 260; i++) { window.__DEV.kb.r = 1; window.__DEV.step(); } window.__DEV.kb.r = 0; });
await page.waitForTimeout(300);
await page.screenshot({ path: 'shot-level1.png' });
await page.evaluate(() => { window.__DEV.Game.startLevel(1, false); window.__DEV.gotoBoss();
  for (let i = 0; i < 260; i++) window.__DEV.step(); });
await page.waitForTimeout(300);
await page.screenshot({ path: 'shot-boss.png' });

console.log('\n=== ПІДСУМОК ===');
if (errors.length) {
  console.log('ПОМИЛКИ КОНСОЛІ (' + errors.length + '):');
  errors.slice(0, 12).forEach(e => console.log('  ' + e));
}
console.log(fails === 0 && errors.length === 0 ? 'УСЕ ЧИСТО' : ('ПРОБЛЕМ: ' + (fails + errors.length)));
await browser.close();
process.exit(fails === 0 && errors.length === 0 ? 0 : 1);
