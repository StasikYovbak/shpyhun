/**
 * Катсцени: система кроків, тригер перед босом, блокування вводу,
 * приглушення музики, пропуск одним тапом і те, що другий перегляд
 * не обов'язковий.
 *   node tests/cut.mjs
 */
let pw; try { pw = await import('playwright'); } catch (e) { pw = await import('/opt/node22/lib/node_modules/playwright/index.js'); }
const chromium = pw.chromium || pw.default.chromium;
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 900, height: 420 }, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(process.env.URL || 'http://localhost:4173/');
await page.waitForFunction(() => !!window.__DEV, null, { timeout: 20000 });
// Перший запуск питає про навчання (промт №13). Цей набір перевіряє
// не його, тож позначаємо питання як уже поставлене — інакше «Грати»
// відкриє екран навчання замість гри.
await page.evaluate(() => { window.__DEV.Store.data.tutAsked = 1; window.__DEV.Store.save(); });
await page.click('#mPlay');
await page.waitForTimeout(250);

let fails = 0;
const ok = (c, m, extra) => { if (!c) { fails++; console.log('  ✗ ' + m + (extra ? '  → ' + extra : '')); }
                              else console.log('  ✓ ' + m + (extra ? '  (' + extra + ')' : '')); };

console.log('КАТСЦЕНИ\n');

// --- сценарій демо існує й має чотири репліки ---
const sc = await page.evaluate(() => {
  const S = window.__DEV.SCRIPTS['pre:1'];
  if (!S) return null;
  return { id: S.id, steps: S.steps.length,
           lines: S.steps.filter(x => x.say !== undefined).length,
           kinds: [...new Set(S.steps.flatMap(x => Object.keys(x)))],
           portraits: [...new Set(S.steps.filter(x => x.p).map(x => x.p))],
           anims: [...new Set(S.steps.filter(x => x.anim).map(x => x.anim))] };
});
ok(!!sc, 'демо-сценарій перед Сервотавром існує');
ok(sc && sc.lines === 4, 'у ньому рівно чотири репліки', sc ? sc.lines + '' : '—');
ok(sc && sc.portraits.length === 2, 'два портрети — героїні й боса', sc ? sc.portraits.join(', ') : '—');
ok(sc && sc.anims.length >= 2, 'у кроків є поле анімації появи', sc ? sc.anims.join('/') : '—');
for (const need of ['say', 'cam', 'shake', 'music', 'flash', 'fade', 'sfx'])
  ok(sc && sc.kinds.indexOf(need) >= 0, 'сценарій уміє крок «' + need + '»');

// --- тригер перед босом ---
const run = await page.evaluate(async () => {
  const D = window.__DEV;
  D.Store.data.seenCuts = [];                       // дивимось уперше
  D.Game.startLevel(1, false); D.god(true);
  const P = D.P;
  P.x = D.world.bossX - 30; P.y = 176; P.vy = 0;
  const before = { state: D.Game.state, boss: D.BOSS.on };
  for (let i = 0; i < 120 && D.Game.state !== 'cut'; i++) { P.x += 1; D.step(); }
  const cut = { state: D.Game.state, on: D.Cut.on, boss: D.BOSS.on,
                say: D.Cut.say, by: D.Cut.by, portrait: D.Cut.portrait };
  // ввід під час катсцени заблоковано, керування сховане
  const touchOn = document.getElementById('touch').classList.contains('on');
  // кроки йдуть самі
  for (let i = 0; i < 300; i++) { D.Cut.step(1 / 60); D.render(); }
  const mid = { i: D.Cut.i, on: D.Cut.on, say: D.Cut.say, by: D.Cut.by, portrait: D.Cut.portrait };
  return { before, cut, touchOn, mid };
});
ok(run.cut.state === 'cut' && run.cut.on, 'перетин межі арени запускає катсцену, а не бій одразу',
   'стан ' + run.cut.state);
ok(run.cut.boss === false, 'бос не з\'являється, поки йде катсцена');
ok(run.touchOn === false, 'шар керування схований на час катсцени');
ok(run.mid.by.length > 0 && run.mid.portrait.length > 0 && run.mid.say.length > 0,
   'репліка йде з іменем і портретом',
   run.mid.by + ' / ' + run.mid.portrait);
ok(run.mid.i > 0, 'кроки перемикаються самі', 'крок ' + run.mid.i);

// --- пропуск одним тапом будь-де ---
await page.mouse.click(450, 210);
await page.waitForTimeout(120);
const after = await page.evaluate(() => ({ state: window.__DEV.Game.state, on: window.__DEV.Cut.on,
                                           boss: window.__DEV.BOSS.on,
                                           seen: (window.__DEV.Store.data.seenCuts || []).slice() }));
ok(after.on === false && after.state === 'play', 'тап у будь-якому місці пропускає катсцену',
   'стан ' + after.state);
ok(after.boss === true, 'після катсцени бій із босом усе одно починається');
ok(after.seen.indexOf('pre-servotaur') >= 0, 'катсцену позначено як переглянуту',
   after.seen.join(','));

// --- другий перегляд не обов'язковий ---
const again = await page.evaluate(() => {
  const D = window.__DEV;
  D.Game.startLevel(1, false); D.god(true);
  const P = D.P;
  P.x = D.world.bossX - 30; P.y = 176; P.vy = 0;
  for (let i = 0; i < 120 && D.Game.state !== 'cut'; i++) { P.x += 1; D.step(); }
  return { state: D.Game.state, boss: D.BOSS.on };
});
ok(again.state === 'play' && again.boss === true,
   'уже бачену катсцену вдруге не показуємо — одразу бій', 'стан ' + again.state);

// --- пропуск працює й з клавіатури ---
const kb = await page.evaluate(() => {
  const D = window.__DEV;
  D.Store.data.seenCuts = [];
  D.Game.startLevel(1, false); D.god(true);
  const P = D.P;
  P.x = D.world.bossX - 30; P.y = 176; P.vy = 0;
  for (let i = 0; i < 120 && D.Game.state !== 'cut'; i++) { P.x += 1; D.step(); }
  return D.Game.state;
});
ok(kb === 'cut', 'катсцена знову запустилась після скидання позначки');
await page.keyboard.press('KeyZ');
await page.waitForTimeout(120);
const kbAfter = await page.evaluate(() => window.__DEV.Game.state);
ok(kbAfter === 'play', 'клавіша теж пропускає катсцену', 'стан ' + kbAfter);

ok(errors.length === 0, 'без помилок JS' + (errors.length ? ': ' + errors[0] : ''));
console.log('\n' + (fails === 0 ? 'КАТСЦЕНИ: УСЕ ЧИСТО' : 'КАТСЦЕНИ: ПРОБЛЕМ ' + fails));
await browser.close();
process.exit(fails === 0 ? 0 : 1);
