/**
 * Нові екрани: Керування (живе прев'ю, повзунки, перетягування, пресети)
 * та Арсенал (дві комірки, вкладки, замки, правило зміни зброї).
 *   node tests/ui.mjs
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
let fails = 0;
const ok = (c, m, extra) => { if (!c) { fails++; console.log('  ✗ ' + m + (extra ? '  → ' + extra : '')); }
                              else console.log('  ✓ ' + m + (extra ? '  (' + extra + ')' : '')); };
const box = sel => page.evaluate(s => { const e = document.querySelector(s); const r = e.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, op: +getComputedStyle(e).opacity }; }, sel);

/* Екран керування став ПОЕЛЕМЕНТНИМ редактором розкладки (промт №13):
   спільних повзунків «розмір стрілок» і «прозорість кнопок» більше
   немає, у кожного з восьми елементів свої параметри. Сам редактор
   перевіряється в tests/padedit.mjs — тут лишилось те, що не залежить
   від розкладки: що екран відкривається, живе прев'ю вмикається, і
   хітбокс не стає меншим за базовий навіть на найдрібнішому розмірі. */
console.log('ЕКРАН КЕРУВАННЯ\n');
await page.click('#mSet'); await page.click('#sCtrl'); await page.waitForTimeout(200);
ok(await page.isVisible('#controls'), 'екран відкривається');
ok(await page.evaluate(() => document.getElementById('touch').classList.contains('prev')),
   'живе прев\'ю: керування показано поверх гри');

// найдрібніший дозволений розмір (60%) — хітбокс усе одно не менший за базовий
const hit = await page.evaluate(() => {
  const D = window.__DEV;
  for (const k of ['L', 'R', 'A', 'B', 'C', 'D']) D.Pad.el(k).s = 60;
  D.Input.layout();
  return { padHw: D.pad.hw, padHh: D.pad.hh, padW: D.pad.w, padH: D.pad.h,
           btn: D.btn.A.hit, btnR: D.btn.A.r,
           baseW: D.CONFIG.ARROW_W, baseH: D.CONFIG.ARROW_H,
           gap: D.CONFIG.ARROW_GAP, baseB: D.CONFIG.BTN / 2 };
});
ok(hit.padHw >= (hit.baseW * 2 + hit.gap) / 2 * 1.29 && hit.padHh >= hit.baseH / 2 * 1.29,
   'стрілки: хітбокс ≥ 130% базового навіть на мінімумі',
   (hit.padW / 2).toFixed(0) + 'x' + (hit.padH / 2).toFixed(0) + ' px видимо / ' +
   hit.padHw.toFixed(0) + 'x' + hit.padHh.toFixed(0) + ' px хітбокс');
ok(hit.btn >= hit.baseB * 1.24, 'кнопка: хітбокс ≥ 125% базового навіть на мінімумі',
   hit.btnR.toFixed(0) + ' px видимо / ' + hit.btn.toFixed(0) + ' px хітбокс');
await page.evaluate(() => { window.__DEV.Input.preset('standard'); });
await page.click('#cDone'); await page.waitForTimeout(150);
ok(!await page.evaluate(() => document.getElementById('touch').classList.contains('prev')),
   'вихід з екрана вимикає прев\'ю');

console.log('\nЕКРАН АРСЕНАЛУ\n');
// «Арсенал» живе у вкладці «Гра» (промт №13: налаштування розбиті на
// п'ять категорій), тож спершу перемикаємо вкладку.
await page.click('#sTabs button[data-v="game"]'); await page.waitForTimeout(150);
await page.click('#sInv'); await page.waitForTimeout(150);
ok(await page.isVisible('#inv'), 'екран відкривається');
const grid = await page.evaluate(() => Array.from(document.querySelectorAll('#iGrid .wit'))
  .map(b => ({ lock: b.classList.contains('lock'), on: b.classList.contains('on'),
               src: b.querySelector('img').getAttribute('src') })));
ok(grid.length === 5, 'у вкладці «Ближній бій» рівно 5 зброй', String(grid.length));
ok(grid.filter(g => g.lock).length === 4, 'чотири з них замкнені на старті',
   String(grid.filter(g => g.lock).length));
ok(grid.some(g => g.on && !g.lock), 'екіпірована підсвічена');
ok(grid.every(g => /assets\/wpn\/\w+\.png$/.test(g.src)), 'у кожної своя іконка-PNG');
const lockIdx = grid.findIndex(g => g.lock);
await page.evaluate(i => document.querySelectorAll('#iGrid .wit')[i].click(), lockIdx);
await page.waitForTimeout(80);
ok(/Нагорода за сектор|фрагменти/i.test(await page.textContent('#iCard')),
   'тап по замкненій показує умову відкриття', (await page.textContent('#iCard')).slice(0, 60));
ok(await page.evaluate(() => window.__DEV.EQ.m.id === 'arc'), 'замкнена не екіпірується');

await page.evaluate(() => document.querySelector('#iTabs button[data-v="ranged"]').click());
await page.waitForTimeout(80);
const g2 = await page.evaluate(() => Array.from(document.querySelectorAll('#iGrid .wit')).length);
ok(g2 === 6, 'у вкладці «Дальній бій» шість (з Ехо-Призмою)', String(g2));

// видаємо всю зброю і міняємо комірки
await page.evaluate(() => { window.__DEV.Store.data.owned =
  ['arc', 'whip', 'brand', 'chrono', 'claws', 'rail', 'osa', 'swarm', 'shot', 'glitch', 'prism'];
  document.querySelector('#iTabs button[data-v="ranged"]').click(); });
await page.waitForTimeout(80);
await page.evaluate(() => document.querySelectorAll('#iGrid .wit')[3].click());
await page.waitForTimeout(80);
ok(await page.evaluate(() => window.__DEV.EQ.r.id === 'shot'), 'вибір у сітці міняє дальню комірку',
   await page.evaluate(() => window.__DEV.EQ.r.id));
ok((await page.textContent('#slotRanged')).indexOf('КАРТЕЧ') >= 0, 'комірка показує нову зброю');
ok(await page.evaluate(() => window.__DEV.EQ.m.id === 'arc'), 'ближня комірка не зачеплена');

// правило: у грі поза чекпоінтом міняти не можна
await page.click('#iDone'); await page.click('#settings [data-back="menu"]');
await page.click('#mPlay'); await page.waitForTimeout(400);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
ok(await page.isVisible('#pause'), 'пауза відкрита');
await page.click('#pInv'); await page.waitForTimeout(150);
ok((await page.textContent('#iHint')).indexOf('доступна') >= 0, 'у паузі зміна дозволена');
const swapped = await page.evaluate(() => {
  window.__DEV.Store.data.freeSwap = 0;
  window.__DEV.Game.state = 'play';                       // ніби посеред бою
  const before = window.__DEV.EQ.m.id;
  document.querySelector('#iTabs button[data-v="melee"]').click();
  document.querySelectorAll('#iGrid .wit')[2].click();
  const after = window.__DEV.EQ.m.id;
  window.__DEV.Game.state = 'pause';
  return { before, after, hint: document.getElementById('iHint').textContent };
});
ok(swapped.before === swapped.after, 'посеред бою зброя НЕ міняється', swapped.before + ' → ' + swapped.after);
ok(swapped.hint.indexOf('чекпоінт') >= 0, 'підказка пояснює правило');
const free = await page.evaluate(() => {
  window.__DEV.Store.data.freeSwap = 1;
  window.__DEV.Game.state = 'play';
  document.querySelector('#iFree button[data-v="1"]').click();
  document.querySelectorAll('#iGrid .wit')[2].click();
  const after = window.__DEV.EQ.m.id;
  window.__DEV.Game.state = 'pause';
  return after;
});
ok(free === 'brand', 'з увімкненою «вільною зміною» — міняється будь-коли', free);

if (errors.length) { console.log('\nПОМИЛКИ JS: ' + errors.slice(0, 5).join(' | ')); fails += errors.length; }
console.log('\n' + (fails === 0 ? 'ЕКРАНИ КЕРУВАННЯ Й АРСЕНАЛУ: УСЕ ЧИСТО' : 'ПРОБЛЕМ: ' + fails));
await browser.close();
process.exit(fails === 0 ? 0 : 1);
