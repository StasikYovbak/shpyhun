/**
 * АУДИТ: чи є в кожного боса гарантоване вікно, коли до нього дістає
 * ближня зброя.
 *
 * Питання просте: гравець, що взяв клинок, не має впертися в боса, по
 * якому фізично не влучити. Бот по-справжньому б'ється (інакше Матка й
 * Хроноклинок ніколи не відкриються), а скрипт щокадру записує кожну
 * коробку, по якій у цю мить проходить шкода, і рахує, чи дістає до неї
 * дуга клинка: стоячи на підлозі, у вершині стрибка або з платформи під
 * самою коробкою.
 *   node tests/melee-audit.mjs
 */
let pw; try { pw = await import('playwright'); } catch (e) { pw = await import('/opt/node22/lib/node_modules/playwright/index.js'); }
const chromium = pw.chromium || pw.default.chromium;
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 460 } });
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

const res = await page.evaluate(() => {
  const D = window.__DEV, G = D.G, P = D.P;
  // розмір героїні беремо в гри: після збільшення спрайтів
  // зашитий 14 давав би зону ураження від старого зросту
  const FLOOR = 13 * D.TS, PH = P.h;

  // Справжня висота стрибка — міряємо грою, а не беремо з константи.
  D.Game.startLevel(0, false); D.god(true);
  P.x = 60; P.y = FLOOR - PH; P.vy = 0; P.jumps = 0;
  for (let i = 0; i < 6; i++) D.step();
  P.y = FLOOR - PH; P.vy = 0; P.jumps = 0;
  D.kb.a = 1;
  let apexY = P.y;
  for (let i = 0; i < 60; i++) { D.step(); apexY = Math.min(apexY, P.y); if (P.vy > 0) break; }
  D.kb.a = 0;
  const jumpH = (FLOOR - PH) - apexY;

  /**
   * Чи дістає клинок до коробки — і з яким запасом.
   *
   * Дуга клинка по вертикалі дорівнює тілу героїні (14 px), але за один
   * стрибок це тіло проходить УСІ висоти від вершини до поверхні, з якої
   * стрибнули. Тож зона ураження з поверхні на висоті sy — це смуга
   * [sy - 14 - висота стрибка, sy]. Беремо найкращу смугу з усіх
   * поверхонь: підлога плюс будь-який тайл поблизу коробки.
   */
  const reach = (hb) => {
    const band = sy => Math.min(sy, hb.y + hb.h) - Math.max(sy - PH - jumpH, hb.y);
    let best = band(FLOOR);
    const txc = Math.floor((hb.x + hb.w / 2) / D.TS);
    for (let tx = txc - 5; tx <= txc + 5; tx++)
      for (let ty = 0; ty <= 13; ty++) {
        const c = D.tAt(tx, ty);
        if (c === 1 || c === 2) { best = Math.max(best, band(ty * D.TS)); break; }
      }
    return best;
  };

  const out = [];
  for (const lvl of [1, 3, 5, 7, 9]) {
    D.Game.startLevel(lvl, false); D.god(true); D.gotoBoss();
    D.equip('arc', 'rail');
    for (let i = 0; i < 160; i++) D.step();
    const B = D.BOSS;
    B.hp = B.maxHp = 4000;                           // бій має дожити до всіх станів
    const rec = { lvl: lvl + 1, name: B.def.name, hp: B.def.hp, opens: 0, secs: 0,
                  top: 1e9, bot: -1e9, best: -1e9, reachF: 0, maxGap: 0,
                  states: {}, gaps: [] };
    let open = false, lastOpen = -1, reachN = 0, vulnN = 0, gapN = 0;

    for (let f = 0; f < 60 * 120; f++) {
      // Бот б'ється: підходить до найближчої коробки, по якій іде шкода,
      // і мотлошить B. Для Хроноклинка це ще й парирування.
      const boxes = G.bossHitBoxes().filter(hb => hb.part ? hb.part.alive : !G.bossInvulnerable());
      const tgt = boxes.length ? boxes[0] : (G.bossHitBoxes()[0] || null);
      if (tgt) {
        P.x = tgt.x + tgt.w / 2 + 14;
        P.y = Math.max(20, Math.min(FLOOR - PH, tgt.y + tgt.h / 2 - PH / 2));
        P.vy = 0; P.face = -1; P.inv = 1;
      }
      D.kb.b = (f % 2) ? 1 : 0;
      D.step();

      if (boxes.length) {
        rec.secs += 1 / 60;
        rec.states[B.st] = 1;
        // Ціль, що крутиться чи літає, не мусить бути в зоні клинка
        // ЩОМИТІ — важливо, щоб вона там бувала й не зникала надовго.
        let bestNow = -1e9;
        for (const hb of boxes) {
          rec.top = Math.min(rec.top, hb.y);
          rec.bot = Math.max(rec.bot, hb.y + hb.h);
          bestNow = Math.max(bestNow, reach(hb));
        }
        rec.best = Math.max(rec.best, bestNow);
        vulnN++;
        if (bestNow > 0) { reachN++; gapN = 0; }
        else { gapN++; rec.maxGap = Math.max(rec.maxGap, gapN); }
        if (!open) {
          rec.opens++;
          if (lastOpen >= 0) rec.gaps.push((f - lastOpen) / 60);
          lastOpen = f;
        }
        open = true;
      } else open = false;
      if (B.done || B.st === 'die') break;
    }
    D.kb.b = 0;
    rec.gapAvg = rec.gaps.length ? +(rec.gaps.reduce((a, b) => a + b, 0) / rec.gaps.length).toFixed(1)
                                 : (rec.secs > 0 ? 0 : -1);
    rec.secs = +rec.secs.toFixed(1);
    rec.reachF = vulnN ? Math.round(reachN / vulnN * 100) : 0;
    rec.maxGap = +(rec.maxGap / 60).toFixed(1);
    rec.best = rec.best === -1e9 ? null : Math.round(rec.best * 10) / 10;
    rec.states = Object.keys(rec.states).join('/');
    out.push(rec);
  }
  return { jumpH: +jumpH.toFixed(1), apexY: +apexY.toFixed(1), ph: PH, floor: FLOOR, rows: out };
});

console.log('АУДИТ ДОСЯЖНОСТІ БЛИЖНЬОЮ ЗБРОЄЮ\n');
console.log('  висота стрибка ' + res.jumpH + ' px, дуга клинка по вертикалі ' + res.ph + ' px,');
console.log('  підлога арен y=' + res.floor + ' (стоячи y=' + (res.floor - res.ph) + ', вершина стрибка y=' + res.apexY + ')\n');
console.log('  бос                       HP   вікно раз на  вразлива зона  дістає  запас   у зоні  пауза');
console.log('  ' + '-'.repeat(90));
for (const r of res.rows) {
  console.log('  ' + ('СЕКТОР ' + r.lvl + ' ' + r.name).padEnd(26).slice(0, 26) +
              String(r.hp).padEnd(5) +
              (r.gapAvg > 0 ? r.gapAvg + ' c' : 'постійно').padEnd(14) +
              (r.top === 1e9 ? '—' : Math.round(r.top) + '..' + Math.round(r.bot)).padEnd(15) +
              (r.best > 0 ? 'так' : 'НІ').padEnd(8) +
              ((r.best === null ? '—' : r.best + ' px')).padEnd(8) +
              (r.reachF + '%').padEnd(8) +
              r.maxGap + ' c');
}
console.log('\n  «запас»  — найкращий перетин зони ураження клинка з вразливою коробкою.');
console.log('  «у зоні» — яку частку вразливого часу до боса взагалі можна дотягнутись.');
console.log('  «пауза»  — найдовший відрізок вразливого часу, коли дотягнутись не можна.');
console.log('  Зона ураження з поверхні на висоті sy — смуга [sy-' + res.ph + '-' + res.jumpH + ', sy]:');
console.log('  за один стрибок тіло героїні (а з ним і дуга) проходить усі ці висоти.\n');

for (const r of res.rows) {
  ok(r.opens > 0, r.name + ': вікно вразливості відкривається',
     r.opens + ' разів, стани: ' + r.states);
  ok(r.best !== null && r.best > 0, r.name + ': клинок дістає вразливу зону',
     r.best === null ? 'зона не з’являлась' : 'запас ' + r.best + ' px');
  ok(r.maxGap <= 8, r.name + ': недосяжних пауз довших за 8 с немає',
     'найдовша ' + r.maxGap + ' c, у зоні ' + r.reachF + '% часу');
}

ok(errors.length === 0, 'без помилок JS' + (errors.length ? ': ' + errors[0] : ''));
console.log('\n' + (fails === 0 ? 'АУДИТ: УСІ П’ЯТЬ БОСІВ ДІСТАЮТЬСЯ КЛИНКОМ'
                                : 'АУДИТ: ПРОБЛЕМ ' + fails));
await browser.close();
process.exit(fails === 0 ? 0 : 1);
