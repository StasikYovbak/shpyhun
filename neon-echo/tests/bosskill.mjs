/**
 * Чи можна взагалі вбити кожного боса ЗВИЧАЙНИМИ засобами гри?
 * Скриптований бот б'ється тільки клинком і рейкострилом (жодних
 * службових команд), а тест дивиться, чи доходить бос до нуля HP.
 *   node tools/bosskill.mjs
 */
import { fileURLToPath } from 'url';
import path from 'path';
let pw;
try { pw = await import('playwright'); }
catch (e) { pw = await import('/opt/node22/lib/node_modules/playwright/index.js'); }
const chromium = pw.chromium || pw.default.chromium;
const file = process.env.URL || 'http://localhost:4173/';

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 420 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(file);
await page.waitForFunction(() => !!window.__DEV);
// Перший запуск питає про навчання (промт №13). Цей набір перевіряє
// не його, тож позначаємо питання як уже поставлене — інакше «Грати»
// відкриє екран навчання замість гри.
await page.evaluate(() => { window.__DEV.Store.data.tutAsked = 1; window.__DEV.Store.save(); });
await page.click('#mPlay');
await page.waitForTimeout(200);

let fails = 0;
console.log('ЧИ ВБИВАЮТЬСЯ БОСИ ЗВИЧАЙНОЮ ЗБРОЄЮ\n');
for (const lvl of [1, 3, 5, 7, 9]) {
  const r = await page.evaluate(({ lvl, secs }) => {
    const D = window.__DEV, P = D.P;
    D.Game.startLevel(lvl, false); D.god(true); D.gotoBoss();
    let minHp = 1e9, done = false, frames = 0, partsDead = 0;
    for (let i = 0; i < secs * 60; i++) {
      frames = i;
      const hbs = D.hitboxes();
      let t = null, best = 1e9, hasParts = false;
      for (const hb of hbs) if (hb.part) hasParts = true;
      for (const hb of hbs) {
        if (hasParts && !hb.part) continue;                 // спершу вузли/ядра
        const d = Math.abs((hb.x + hb.w / 2) - (P.x + P.w / 2)) + Math.abs((hb.y) - P.y) * 0.4;
        if (d < best) { best = d; t = hb; }
      }
      if (t) {
        const cx = P.x + P.w / 2, cy = P.y + P.h / 2;
        const tx = t.x + t.w / 2, ty = t.y + t.h / 2;
        const dx = tx - cx, dy = ty - cy;
        // повертатись до цілі треба точно: клинок б'є тільки вперед
        D.kb.r = dx > 3 ? 1 : 0;
        D.kb.l = dx < -3 ? 1 : 0;
        // тримати стрибок треба довго, інакше спрацьовує змінна висота і вийде підскок
        D.kb.a = ((dy < -14 || (P.onGround && Math.abs(P.vx) < 6)) && (i % 46) < 28) ? 1 : 0;
        // кнопки треба саме ТИСКАТИ (утримання B — це заряд, а не серія ударів)
        const near = Math.abs(dx) < 30 && Math.abs(dy) < 24;
        D.kb.b = ((near ? (i % 12) < 2 : (i % 26) < 2)) ? 1 : 0;
        D.kb.c = (!near && Math.abs(dy) < 14 && (i % 10) < 2) ? 1 : 0;
        // ціль унизу — зістрибуємо крізь платформу
        D.kb.d = (dy > 26 && P.onGround && (i % 20) < 4) ? 1 : 0;
      }
      D.step();
      const s = D.state();
      if (s.bossOn && s.bossHp < minHp) minHp = s.bossHp;
      if (s.bossDone) { done = true; break; }
    }
    D.kb.r = D.kb.l = D.kb.a = D.kb.b = D.kb.c = 0;
    for (let i = 0; i < D.BOSS.parts.length; i++) if (!D.BOSS.parts[i].alive) partsDead++;
    return { done, minHp, secs: (frames / 60).toFixed(1), maxHp: D.BOSS.maxHp, partsDead,
             parts: D.BOSS.parts.length, phase: D.BOSS.phase, hp: D.BOSS.hp };
  }, { lvl, secs: 200 });
  const good = r.done;
  if (!good) fails++;
  console.log((good ? '  ✓ ' : '  ✗ ') + 'СЕКТОР ' + (lvl + 1) + ': ' +
    (r.done ? 'боса вбито за ' + r.secs + ' c' : 'НЕ ВБИТО, лишилось HP ' + r.hp + '/' + r.maxHp +
     ' (фаза ' + r.phase + ', знищено вузлів ' + r.partsDead + '/' + r.parts + ')'));
}
if (errors.length) { console.log('\nПОМИЛКИ: ' + errors.slice(0, 5).join(' | ')); fails += errors.length; }
console.log('\n' + (fails === 0 ? 'УСІ БОСИ ВБИВАЮТЬСЯ ЗВИЧАЙНОЮ ЗБРОЄЮ' : 'ПРОБЛЕМНИХ БОСІВ: ' + fails));
await browser.close();
process.exit(fails === 0 ? 0 : 1);
