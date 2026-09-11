/**
 * Режим бога: панель, чити, індикація і — головне — правило «вимкнув
 * чит, і гра поводиться рівно як раніше». Перевіряємо не наявність
 * кнопок, а що кожен чит справді діє й справді знімається без слідів.
 *   node tests/godmode.mjs
 *
 * Набір має сенс лише при DEV_MODE = true; при false він одразу
 * повідомляє, що панелі немає — і це теж правильна поведінка.
 */
let pw; try { pw = await import('playwright'); } catch (e) { pw = await import('/opt/node22/lib/node_modules/playwright/index.js'); }
const chromium = pw.chromium || pw.default.chromium;
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 900, height: 460 }, hasTouch: true,
                                      permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(process.env.URL || 'http://localhost:4173/');
await page.waitForFunction(() => !!window.__DEV, null, { timeout: 20000 });

let fails = 0;
const ok = (c, m, extra) => { if (!c) { fails++; console.log('  ✗ ' + m + (extra ? '  → ' + extra : '')); }
                              else console.log('  ✓ ' + m + (extra ? '  (' + extra + ')' : '')); };

const hasPanel = await page.evaluate(() => !!window.__DBG);
if (!hasPanel) {
  console.log('DEV_MODE вимкнено — панелі в збірці немає. Це очікувана поведінка релізу.');
  await browser.close();
  process.exit(0);
}
await page.click('#mPlay');
await page.waitForTimeout(300);

/** Натиснути кнопку в рядку панелі за підписом. */
const hit = (label, txt) => page.evaluate(({ label, txt }) => {
  const rows = [...document.querySelectorAll('.dbgRow')];
  const r = rows.find(x => x.querySelector('.dbgLab').textContent === label);
  if (!r) throw new Error('нема рядка ' + label);
  const b = [...r.querySelectorAll('.dbgB')].find(b => !txt || b.textContent === txt);
  if (!b) throw new Error('нема кнопки ' + txt + ' у рядку ' + label);
  b.click();
}, { label, txt });

console.log('ПАНЕЛЬ\n');
ok(await page.isVisible('#btnDbg'), 'кнопка DBG видима в грі');
await page.click('#btnDbg');
await page.waitForTimeout(150);
ok(await page.isVisible('.dbgPanel'), 'тап відкриває панель');
ok(await page.evaluate(() => window.__DEV.Game.state) === 'dbg',
   'гра стоїть, поки панель відкрита');
const secs = await page.evaluate(() => [...document.querySelectorAll('.dbgSec h4')].map(h => h.textContent));
ok(secs.length === 5, 'п\'ять розділів: бій, рух, навігація, діагностика, службове', secs.join(' / '));

console.log('\nБІЙ');
// --- безсмертя ---
await hit('Безсмертя');
const inv = await page.evaluate(() => {
  const D = window.__DEV, P = D.P;
  D.Game.startLevel(0, false); D.god(false);
  P.hp = P.maxHp; P.inv = 0;
  D.G.playerHurt(2, P.x + 40);
  const withCheat = P.hp;
  return { withCheat, max: P.maxHp };
});
ok(inv.withCheat === inv.max, 'безсмертя тримає шкоду', inv.withCheat + '/' + inv.max);
await hit('Безсмертя');                                  // вимикаємо
const noInv = await page.evaluate(() => {
  const D = window.__DEV, P = D.P;
  P.hp = P.maxHp; P.inv = 0;
  D.G.playerHurt(2, P.x + 40);
  return P.hp;
});
ok(noInv < inv.max, 'вимкнув — шкода проходить як раніше', noInv + '/' + inv.max);

// --- множник урону: накладається поверх, базові числа не міняються ---
const dmg = await page.evaluate(() => {
  const D = window.__DEV, P = D.P;
  const base = JSON.stringify(D.WEAPONS.arc.dmg);
  const shot = (mult) => {
    D.Game.startLevel(0, false); D.god(true);
    P.x = 60; P.y = 194; P.vy = 0;
    const e = D.spawnEnemy('thug', P.x + 30, 192, false);
    e.blind = 1; e.sp = 0; e.st = 'idle'; e.hp = e.maxHp = 1e6;
    const before = e.hp;
    D.damageEnemy(e, 2, 0, {});
    return before - e.hp;
  };
  const x1 = shot();
  return { base, x1 };
});
await hit('Урон гравця', '×20');
const dmg20 = await page.evaluate(() => {
  const D = window.__DEV, P = D.P;
  D.Game.startLevel(0, false); D.god(true);
  P.x = 60; P.y = 194; P.vy = 0;
  const e = D.spawnEnemy('thug', P.x + 30, 192, false);
  e.blind = 1; e.sp = 0; e.st = 'idle'; e.hp = e.maxHp = 1e6;
  const before = e.hp;
  D.damageEnemy(e, 2, 0, {});
  return { dealt: before - e.hp, base: JSON.stringify(D.WEAPONS.arc.dmg) };
});
ok(dmg20.dealt === dmg.x1 * 20, 'множник ×20 множить нанесену шкоду',
   dmg.x1 + ' → ' + dmg20.dealt);
ok(dmg20.base === dmg.base, 'таблиця зброї при цьому НЕ змінена', dmg20.base);
await hit('Урон гравця', '×1');

// --- нескінченні ресурси ---
await hit('Нескінченні ресурси');
const res = await page.evaluate(() => {
  const D = window.__DEV, P = D.P;
  D.Game.startLevel(0, false); D.god(true);
  D.equip('arc', 'rail');
  P.x = 60; P.y = 194; P.vy = 0; P.heat = 0;
  for (let i = 0; i < 240; i++) { D.kb.c = i % 2; D.step(); }
  D.kb.c = 0;
  return { heat: P.heat, lock: !!P.lock };
});
ok(res.heat === 0 && !res.lock, 'тепло рейкострила не росте й перегріву немає',
   'heat=' + res.heat);
await hit('Нескінченні ресурси');
const res2 = await page.evaluate(() => {
  const D = window.__DEV, P = D.P;
  D.Game.startLevel(0, false); D.god(true);
  D.equip('arc', 'rail');
  P.x = 60; P.y = 194; P.vy = 0; P.heat = 0;
  for (let i = 0; i < 240; i++) { D.kb.c = i % 2; D.step(); }
  D.kb.c = 0;
  return P.heat;
});
ok(res2 > 0, 'вимкнув — тепло знову накопичується', 'heat=' + res2.toFixed(0));

// --- вбити всіх / вбити боса ---
await page.evaluate(() => {
  const D = window.__DEV;
  D.Game.startLevel(0, false); D.god(true);
  for (let i = 0; i < 4; i++) D.spawnEnemy('thug', 80 + i * 30, 192, false);
});
const alive0 = await page.evaluate(() => window.__DEV.ENEM.filter(e => !e.dead).length);
await hit('Зачистити екран', 'ВБИТИ ВСІХ');
await page.evaluate(() => { for (let i = 0; i < 3; i++) window.__DEV.step(); });
const alive1 = await page.evaluate(() => window.__DEV.ENEM.filter(e => !e.dead).length);
ok(alive0 > 0 && alive1 === 0, 'кнопка «вбити всіх» чистить екран', alive0 + ' → ' + alive1);

await page.evaluate(() => {
  const D = window.__DEV;
  D.Game.startLevel(1, false); D.god(true); D.gotoBoss();
  for (let i = 0; i < 150; i++) D.step();
});
const bossBefore = await page.evaluate(() => ({ on: window.__DEV.BOSS.on, hp: window.__DEV.BOSS.hp }));
await hit('Бос', 'ВБИТИ МИТТЄВО');
await page.evaluate(() => { for (let i = 0; i < 4; i++) window.__DEV.step(); });
const bossAfter = await page.evaluate(() => ({ st: window.__DEV.BOSS.st, hp: window.__DEV.BOSS.hp }));
ok(bossBefore.on && bossAfter.st === 'die' && bossAfter.hp <= 0,
   'кнопка «вбити боса» запускає штатну смерть', bossBefore.hp + ' → ' + bossAfter.hp);

console.log('\nРУХ');
// --- політ / noclip ---
await hit('Політ / noclip');
const fly = await page.evaluate(() => {
  const D = window.__DEV, P = D.P, TS = D.TS;
  D.Game.startLevel(0, false); D.god(true);
  const y0 = 13 * TS - P.h;                        // підлога першого сектора
  P.x = 60; P.y = y0; P.vy = 0;
  D.kb.a = 1;
  for (let i = 0; i < 90; i++) D.step();
  D.kb.a = 0;
  const up = P.y;
  const solid = D.solidAtPx(P.x + P.w / 2, P.y + P.h / 2);
  return { up, y0, ground: P.onGround, solid };
});
ok(fly.up < fly.y0 - 3 * fly.y0 / 13, 'політ піднімає героїню вгору',
   'y ' + fly.y0.toFixed(0) + ' → ' + fly.up.toFixed(0));
ok(fly.ground === false, 'у польоті onGround вимкнено');
await hit('Політ / noclip');
const land = await page.evaluate(() => {
  const D = window.__DEV, P = D.P;
  for (let i = 0; i < 200; i++) D.step();
  return { y: P.y, ground: P.onGround };
});
ok(land.ground === true, 'вимкнув — героїня падає й нормально приземляється',
   'y=' + land.y.toFixed(0));

// --- покадровий режим ---
await hit('Покадровий режим');
const frozen = await page.evaluate(async () => {
  const D = window.__DEV, P = D.P;
  D.Game.startLevel(0, false); D.god(true);
  P.x = 60; P.y = 150; P.vy = 0;
  const y0 = P.y;
  await new Promise(r => setTimeout(r, 400));      // реальний цикл, не D.step()
  return { y0, y1: P.y };
});
ok(Math.abs(frozen.y1 - frozen.y0) < 0.01, 'покадровий режим зупиняє гру',
   'y ' + frozen.y0.toFixed(1) + ' → ' + frozen.y1.toFixed(1));
await hit('Крок уперед (клавіша «.»)', 'НАСТУПНИЙ КАДР');
await page.waitForTimeout(120);
const stepped = await page.evaluate(() => window.__DEV.P.y);
ok(stepped > frozen.y1, 'кнопка «наступний кадр» просуває рівно один крок',
   'y → ' + stepped.toFixed(2));
await hit('Покадровий режим');

// --- потрійний стрибок ---
// Рахуємо кількість зльотів за один політ. Між тапами — 5 кадрів: кнопка
// відпускається одразу, тож це короткий стрибок (CUT 0.45), і довша пауза
// встигла б повернути героїню на землю — а там буфер стрибка домішав би
// зайвий зліт, який до чита не має стосунку.
const jumps = () => page.evaluate(() => {
  const D = window.__DEV, P = D.P, TS = D.TS;
  D.Game.startLevel(0, false); D.god(true);
  P.x = 120; P.y = 13 * TS - P.h; P.vy = 0; P.vx = 0;
  for (let i = 0; i < 6; i++) D.step();            // стати на землю
  P.jumps = 0;
  let n = 0, landed = false;
  for (let k = 0; k < 4; k++) {
    P.wallRestored = true;                         // без «подарунка» від стіни
    const before = P.vy;
    D.kb.a = 1; D.step(); D.kb.a = 0;
    if (P.vy < before - 100) n++;                  // саме зліт, а не падіння
    for (let i = 0; i < 5; i++) {
      D.step();
      if (k > 0 && P.onGround) landed = true;      // політ перервався — замір недійсний
      P.wallRestored = true;
    }
  }
  return landed ? -1 : n;
});
const jOff = await jumps();
await hit('Потрійний стрибок');
const jOn = await jumps();
await hit('Потрійний стрибок');
const jBack = await jumps();
ok(jOff === 2, 'без чита стрибків рівно два (земля + повітря)', String(jOff));
ok(jOn === jOff + 1, 'потрійний стрибок додає рівно один', jOff + ' → ' + jOn);
ok(jBack === jOff, 'вимкнув — знову два, без залишкових ефектів', String(jBack));

console.log('\nНАВІГАЦІЯ');
await hit('Сектор', '8');
await page.waitForTimeout(200);
const lvl = await page.evaluate(() => window.__DEV.Game.level);
ok(lvl === 7, 'перехід на сектор 8 одним тапом', 'level=' + lvl);
await page.click('#btnDbg'); await page.waitForTimeout(150);
await hit('Уся зброя', 'РОЗБЛОКУВАТИ');
const arm = await page.evaluate(() => ({ owned: window.__DEV.Store.data.owned.length,
                                         frags: window.__DEV.Store.data.frags.length }));
ok(arm.owned >= 11 && arm.frags === 3, 'уся зброя й фрагменти розблоковані',
   arm.owned + ' зброй, ' + arm.frags + ' фрагменти');
await hit('Арена боса', 'ПЕРЕЙТИ');
await page.waitForTimeout(150);
const at = await page.evaluate(() => ({ x: window.__DEV.P.x, boss: window.__DEV.world.bossX }));
ok(at.boss > 0 && Math.abs(at.x - (at.boss - 34)) < 6, 'перехід до арени боса',
   'x=' + at.x.toFixed(0) + ' при bossX=' + at.boss);

console.log('\nІНДИКАЦІЯ Й СЛУЖБОВЕ');
await page.click('#btnDbg'); await page.waitForTimeout(150);
await hit('Безсмертя');
await page.waitForTimeout(150);
ok(await page.isVisible('#godFrame'), 'з увімкненим читом видно рамку GOD MODE');
await page.evaluate(() => document.querySelector('.dbgHead .dbgB').click());   // ВИМКНУТИ ВСЕ
await page.waitForTimeout(250);
ok(!(await page.isVisible('#godFrame')), 'кнопка «вимкнути все» гасить рамку');

const slot = await page.evaluate(() => {
  const t = [...document.querySelectorAll('.dbgNote')].map(n => n.textContent).join(' ');
  return { note: t, key: Object.keys(localStorage).filter(k => k.indexOf('echo_neon') === 0) };
});
ok(slot.key.some(k => k.endsWith('_dev')), 'прогрес пишеться в окремий дебажний слот',
   slot.key.join(', '));
ok(slot.key.indexOf('echo_neon_courier_v1') < 0, 'основний слот гравця не чіпається');

const dumped = await page.evaluate(async () => {
  const rows = [...document.querySelectorAll('.dbgRow')];
  const r = rows.find(x => x.querySelector('.dbgLab').textContent === 'Стан у буфер');
  r.querySelector('.dbgB').click();
  await new Promise(res => setTimeout(res, 200));
  try { return await navigator.clipboard.readText(); } catch (e) { return 'НЕМА ДОСТУПУ'; }
});
ok(dumped.indexOf('героїня') > 0 && dumped.indexOf('"onGround"') > 0,
   'дамп стану містить рівень, координати й стан анімації',
   dumped === 'НЕМА ДОСТУПУ' ? 'буфер недоступний у headless' : dumped.length + ' символів');

ok(errors.length === 0, 'без помилок JS' + (errors.length ? ': ' + errors[0] : ''));
console.log('\n' + (fails === 0 ? 'РЕЖИМ БОГА: УСЕ ЧИСТО' : 'РЕЖИМ БОГА: ПРОБЛЕМ ' + fails));
await browser.close();
process.exit(fails === 0 ? 0 : 1);
