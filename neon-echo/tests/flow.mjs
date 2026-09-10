/**
 * Наскрізний тест у справжньому браузері: реальний цикл rAF, реальна клавіатура,
 * реальні кліки по кнопках меню. Меню -> гра -> пауза -> вихід з рівня ->
 * наступний сектор -> смерть -> перезапуск із чекпоінта.
 *   node tools/flow.mjs
 */
import { fileURLToPath } from 'url';
import path from 'path';
let pw; try { pw = await import('playwright'); } catch(e){ pw = await import('/opt/node22/lib/node_modules/playwright/index.js'); }
const chromium = pw.chromium || pw.default.chromium;
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({viewport:{width:900,height:420}});
const errs=[]; page.on('pageerror',e=>errs.push(e.message)); page.on('console',m=>{if(m.type()==='error'&&!/GL Driver Message|GPU stall|WebGL-0x/i.test(m.text()))errs.push(m.text())});
await page.goto(process.env.URL || 'http://localhost:4173/');
await page.waitForFunction(()=>!!window.__DEV);
const ok=(c,m)=>console.log((c?'  ✓ ':'  ✗ ')+m);

// реальний цикл rAF, реальна клавіатура
await page.click('#mPlay'); await page.waitForTimeout(300);
await page.keyboard.down('ArrowRight'); await page.waitForTimeout(700);
await page.keyboard.down('KeyJ'); await page.waitForTimeout(120); await page.keyboard.up('KeyJ');
await page.keyboard.down('Space'); await page.waitForTimeout(200); await page.keyboard.up('Space');
await page.keyboard.up('ArrowRight');
let s = await page.evaluate(()=>window.__DEV.state());
ok(s.x>60 && s.state==='play', 'реальний rAF-цикл рухає героя клавіатурою (x='+Math.round(s.x)+')');

// пауза клавішею
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
s = await page.evaluate(()=>window.__DEV.Game.state);
ok(s==='pause','Escape ставить на паузу');
await page.click('#pRes'); await page.waitForTimeout(200);
s = await page.evaluate(()=>window.__DEV.Game.state);
ok(s==='play','кнопка «Продовжити» повертає в гру');

// доходимо до виходу
await page.evaluate(()=>{ const D=window.__DEV; D.P.x=D.world.exit.x-30; D.P.y=D.world.exit.y+16; D.god(true); });
await page.keyboard.down('ArrowRight'); await page.waitForTimeout(1600); await page.keyboard.up('ArrowRight');
await page.waitForTimeout(600);
s = await page.evaluate(()=>window.__DEV.Game.state);
ok(s==='clear','дотик до виходу завершує рівень');
const unlocked = await page.evaluate(()=>window.__DEV.Store.data.unlocked);
ok(unlocked>=2,'наступний сектор відкрито (unlocked='+unlocked+')');
// сектор 1 віддає «Осу» — спершу сцена нагороди, потім екран сектора
const onReward = await page.isVisible('#reward');
ok(onReward, 'нагорода за сектор показується окремою сценою: ' + (await page.textContent('#rwName')));
await page.waitForTimeout(2200);
await page.click('#rwEquip'); await page.waitForTimeout(300);
ok(await page.evaluate(()=>window.__DEV.EQ.r.id==='osa'), '«Екіпірувати зараз» ставить зброю в комірку');
await page.click('#clNext'); await page.waitForTimeout(400);
s = await page.evaluate(()=>window.__DEV.state());
ok(s.state==='play' && s.level===1,'кнопка «Далі» запускає сектор 2');

// смерть і перезапуск
await page.evaluate(()=>{ const D=window.__DEV; D.god(false); D.P.hp=1; D.P.y=99999; });
await page.waitForTimeout(1500);
s = await page.evaluate(()=>window.__DEV.Game.state);
ok(s==='dead','смерть показує екран смерті');
await page.click('#dRetry'); await page.waitForTimeout(400);
s = await page.evaluate(()=>window.__DEV.state());
ok(s.state==='play' && s.hp===5,'перезапуск із чекпоінта відновлює гру');
ok(errs.length===0,'жодної помилки в консолі'+(errs.length?': '+errs[0]:''));
await browser.close();

process.exit(errs.length === 0 ? 0 : 1);
