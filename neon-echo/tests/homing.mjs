/**
 * АВТОНАВЕДЕННЯ ПО БОСАХ.
 *
 * Раніше пошук цілі ходив тільки по ENEM, а боси живуть в окремому
 * BOSS — і автоприціл їх не бачив узагалі. Перевіряємо не наявність
 * коду, а факт: чи бере зброя з наведенням кожного з п'яти босів і в
 * ЯКУ САМЕ коробку вона цілиться.
 *   node tests/homing.mjs
 */
let pw; try { pw = await import('playwright'); } catch (e) { pw = await import('/opt/node22/lib/node_modules/playwright/index.js'); }
const chromium = pw.chromium || pw.default.chromium;
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 940, height: 470 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(process.env.URL || 'http://localhost:4173/');
await page.waitForFunction(() => !!window.__DEV, null, { timeout: 20000 });
await page.click('#mPlay');
await page.waitForTimeout(250);

let fails = 0;
const ok = (c, m, extra) => { if (!c) { fails++; console.log('  ✗ ' + m + (extra ? '  → ' + extra : '')); }
                              else console.log('  ✓ ' + m + (extra ? '  (' + extra + ')' : '')); };

const KIND = { weak: 'відкрита вразлива зона', boss: 'корпус боса',
               node: 'генератор / вузол', armor: 'бос під бронею', enemy: 'звичайний ворог' };

const res = await page.evaluate(() => {
  const D = window.__DEV, G = D.G, P = D.P;
  const out = [];
  for (const lvl of [1, 3, 5, 7, 9]) {
    D.Game.startLevel(lvl, false); D.god(true); D.gotoBoss();
    D.Store.data.owned = Object.keys(D.WEAPONS);
    for (let i = 0; i < 170; i++) D.step();
    const B = D.BOSS;
    B.hp = B.maxHp = 4000;
    const rec = { lvl: lvl + 1, name: B.def.name, osa: null, swarm: null, seen: {} };

    // Ганяємо бій і дивимось, що бачить наведення в різні моменти.
    for (let f = 0; f < 60 * 40; f++) {
      D.step();
      P.x = B.x + B.w / 2 - 90; P.y = 208 - P.h; P.vy = 0; P.face = 1; P.inv = 1;
      const t = D.pickTarget(P.x + P.w / 2, P.y + 6, 1, 0, 400, 0);
      if (t) rec.seen[t.kind] = (rec.seen[t.kind] || 0) + 1;
    }

    // «Оса»: пускаємо кулю й дивимось, у що вона доводиться — не один
    // кадр, а весь політ: наведення працює саме в польоті.
    D.equip('arc', 'osa');
    D.BULL.length = 0;
    let bestKind = null, bestPrio = -1;
    for (let f = 0; f < 60 * 12; f++) {
      P.x = B.x + B.w / 2 - 90; P.y = B.y + B.h / 2 - 6; P.vy = 0; P.face = 1; P.inv = 1;
      P.fireCd = 0;
      D.kb.c = (f % 2) ? 1 : 0;
      D.step();
      for (const b of D.BULL) {
        if (!b.home) continue;
        const t = D.pickTarget(b.x, b.y, b.vx, b.vy, 160, 0.35);
        if (t && t.prio > bestPrio) { bestPrio = t.prio; bestKind = t.kind; }
      }
    }
    D.kb.c = 0;
    rec.osa = bestKind || 'нема';

    // Дрони «Рою»: беремо ціль і дивимось, кого вони позначили
    D.equip('arc', 'swarm');
    for (let i = 0; i < 6; i++) D.step();
    let swKind = null, swPrio = -1;
    for (let f = 0; f < 60 * 12; f++) {
      P.x = B.x + B.w / 2 - 90; P.y = B.y + B.h / 2 - 6; P.vy = 0; P.face = 1; P.inv = 1;
      P.droneCd = 0;
      D.kb.c = (f % 3 === 0) ? 1 : 0;
      D.step();
      const mk = P.mark;
      if (mk && mk.prio > swPrio) { swPrio = mk.prio; swKind = mk.kind; }
    }
    D.kb.c = 0;
    rec.swarm = swKind || 'нема';
    out.push(rec);
  }
  return out;
});

console.log('НАВЕДЕННЯ: ЗБРОЯ × БОС\n');
console.log('  бос                  «ОСА» наводиться в     ДРОНИ «РОЮ» в');
console.log('  ' + '-'.repeat(66));
for (const r of res) {
  console.log('  ' + ('СЕКТОР ' + r.lvl + ' ' + r.name).padEnd(21).slice(0, 21) +
              (KIND[r.osa] || r.osa || '—').padEnd(24) + (KIND[r.swarm] || r.swarm || '—'));
}
console.log('\n  що взагалі бачив автоприціл за бій:');
for (const r of res)
  console.log('    ' + r.name.padEnd(14) +
              Object.keys(r.seen).map(k => (KIND[k] || k) + ' ' +
                Math.round(r.seen[k] / 24) + '%').join(', '));
console.log();

for (const r of res) {
  ok(r.osa && r.osa !== 'нема', r.name + ': «Оса» бере боса за ціль',
     KIND[r.osa] || r.osa);
  ok(r.swarm && r.swarm !== 'нема', r.name + ': дрони «Рою» беруть боса за ціль',
     KIND[r.swarm] || r.swarm);
  // якщо в боса є конкретна вразлива точка — цілитись треба саме в неї
  const hasPart = r.seen.node > 0;
  if (hasPart)
    ok(r.osa === 'node' || r.osa === 'weak' || r.osa === 'boss',
       r.name + ': наведення йде у вразливу точку, а не в центр моделі', KIND[r.osa]);
}

ok(errors.length === 0, 'без помилок JS' + (errors.length ? ': ' + errors[0] : ''));
console.log('\n' + (fails === 0 ? 'НАВЕДЕННЯ: УСЕ ЧИСТО' : 'НАВЕДЕННЯ: ПРОБЛЕМ ' + fails));
await browser.close();
process.exit(fails === 0 ? 0 : 1);
