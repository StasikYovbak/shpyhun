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

let fails = 0;
const ok = (c, m, extra) => { if (!c) { fails++; console.log('  ✗ ' + m + (extra ? '  → ' + extra : '')); }
                              else console.log('  ✓ ' + m + (extra ? '  (' + extra + ')' : '')); };
const box = sel => page.evaluate(s => { const e = document.querySelector(s); const r = e.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, op: +getComputedStyle(e).opacity }; }, sel);

console.log('ЕКРАН КЕРУВАННЯ\n');
await page.click('#mSet'); await page.click('#sCtrl'); await page.waitForTimeout(150);
ok(await page.isVisible('#controls'), 'екран відкривається');
ok(await page.evaluate(() => document.getElementById('touch').classList.contains('prev')),
   'живе прев\'ю: шар керування показано поверх панелі');

const d0 = await box('#dpad'), b0 = await box('#btnA');
await page.evaluate(() => { const s = document.getElementById('cDpadSize'); s.value = 160;
                            s.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(80);
const d1 = await box('#dpad');
ok(d1.w > d0.w * 1.4, 'повзунок розміру стрілок діє одразу', d0.w.toFixed(0) + ' → ' + d1.w.toFixed(0) + ' px');
ok(Math.abs((await box('#btnA')).w - b0.w) < 0.5, 'розмір кнопок при цьому не змінився');

await page.evaluate(() => { const s = document.getElementById('cBtnOp'); s.value = 100;
                            s.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(80);
ok((await box('#btnA')).op > 0.95, 'повзунок прозорості кнопок діє одразу',
   b0.op.toFixed(2) + ' → ' + (await box('#btnA')).op.toFixed(2));
ok((await box('#dpad')).op < 0.95, 'прозорість стрілок лишилась своєю');

// перетягування стрілок пальцем (на звичайному розмірі — є куди рухати)
await page.evaluate(() => { const s = document.getElementById('cDpadSize'); s.value = 100;
                            s.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(80);
const drag = async (sel, dx, dy) => {
  const b = await box(sel);
  await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.w / 2 + dx, b.y + b.h / 2 + dy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(80);
  return b;
};
const before = await drag('#dpad', 60, -70);
const after = await box('#dpad');
ok(after.x > before.x + 40 && after.y < before.y - 40, 'блок стрілок тягнеться пальцем',
   `(${before.x.toFixed(0)},${before.y.toFixed(0)}) → (${after.x.toFixed(0)},${after.y.toFixed(0)})`);
// і не дає кинути себе поверх панелі — інакше її кнопки стануть недосяжні
await drag('#dpad', 400, 0);
const onPanel = await box('#dpad'), panel = await box('#controls .inner');
ok(onPanel.x + onPanel.w <= panel.x + 1 || onPanel.x >= panel.x + panel.w - 1,
   'блок не лягає поверх панелі налаштувань',
   `хрест ${onPanel.x.toFixed(0)}..${(onPanel.x + onPanel.w).toFixed(0)}, панель ${panel.x.toFixed(0)}..${(panel.x + panel.w).toFixed(0)}`);
await page.click('#cResetPos'); await page.waitForTimeout(80);
await drag('#dpad', 60, -70);
// ключ слота беремо в самої гри: при DEV_MODE вона пише в окремий
ok(await page.evaluate(() => { const p = JSON.parse(localStorage.getItem(window.__DEV.SAVE_KEY) || '{}');
     return !!(p.dpadPos && typeof p.dpadPos.x === 'number'); }), 'позиція збережена в localStorage');

await page.click('#cResetPos'); await page.waitForTimeout(80);
const reset = await box('#dpad');
ok(Math.abs(reset.x - before.x) < 2 && Math.abs(reset.y - before.y) < 2, '«Скинути позиції» повертає в кут');

await page.evaluate(() => document.querySelector('#cPreset button[data-v="compact"]').click());
await page.waitForTimeout(80);
ok((await box('#dpad')).w < d0.w, 'пресет «Компакт» зменшує керування');
await page.evaluate(() => document.querySelector('#cPreset button[data-v="lefty"]').click());
await page.waitForTimeout(80);
ok((await box('#dpad')).x > 450, 'пресет «Ліворукий» переносить стрілки праворуч');
await page.evaluate(() => document.querySelector('#cPreset button[data-v="default"]').click());
await page.waitForTimeout(80);

// мінімальний розмір: хітбокс усе одно не менший за базовий
await page.evaluate(() => { for (const [id, v] of [['cDpadSize', 70], ['cBtnSize', 70]]) {
  const s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event('input', { bubbles: true })); } });
await page.waitForTimeout(80);
const hit = await page.evaluate(() => ({ padHw: window.__DEV.pad.hw, padHh: window.__DEV.pad.hh,
  padW: window.__DEV.pad.w, padH: window.__DEV.pad.h,
  btn: window.__DEV.btn.A.hit, btnR: window.__DEV.btn.A.r,
  baseW: window.__DEV.CONFIG.ARROW_W, baseH: window.__DEV.CONFIG.ARROW_H,
  gap: window.__DEV.CONFIG.ARROW_GAP, baseB: window.__DEV.CONFIG.BTN / 2 }));
ok(hit.padHw >= (hit.baseW * 2 + hit.gap) / 2 * 1.29 && hit.padHh >= hit.baseH / 2 * 1.29,
   'стрілки: хітбокс ≥ 130% базового навіть на мінімумі',
   (hit.padW / 2).toFixed(0) + 'x' + (hit.padH / 2).toFixed(0) + ' px видимо / ' +
   hit.padHw.toFixed(0) + 'x' + hit.padHh.toFixed(0) + ' px хітбокс');
ok(hit.btn >= hit.baseB * 1.24, 'кнопка: хітбокс ≥ 125% базового навіть на мінімумі',
   hit.btnR.toFixed(0) + ' px видимо / ' + hit.btn.toFixed(0) + ' px хітбокс');
await page.evaluate(() => document.querySelector('#cPreset button[data-v="default"]').click());
await page.click('#cDone'); await page.waitForTimeout(80);
ok(!await page.evaluate(() => document.getElementById('touch').classList.contains('prev')),
   'вихід з екрана вимикає прев\'ю');

console.log('\nЕКРАН АРСЕНАЛУ\n');
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
