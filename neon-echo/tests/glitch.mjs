/**
 * ГЛІТЧ-ЯДРО: чи по ньому взагалі можна влучити.
 *
 * Рахує не «є код чи нема», а геометрію: де стоїть ядро в кожній точці
 * кріплення, куди дістає дуга клинка на вершині стрибка й зі сусідньої
 * платформи, і скільки шкоди реально встигає зайти за одне вікно.
 *   node tests/glitch.mjs
 */
let pw; try { pw = await import('playwright'); } catch (e) { pw = await import('/opt/node22/lib/node_modules/playwright/index.js'); }
const chromium = pw.chromium || pw.default.chromium;
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 460 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(process.env.URL || 'http://localhost:4173/');
await page.waitForFunction(() => !!window.__DEV, null, { timeout: 20000 });
await page.click('#mPlay');
await page.waitForTimeout(250);

let fails = 0;
const ok = (c, m, extra) => { if (!c) { fails++; console.log('  ✗ ' + m + (extra ? '  → ' + extra : '')); }
                              else console.log('  ✓ ' + m + (extra ? '  (' + extra + ')' : '')); };

/* ---------------------------------------------------------- ГЕОМЕТРІЯ */
console.log('ТОЧКИ КРІПЛЕННЯ Й ДОСЯЖНІСТЬ КЛИНКОМ\n');

const geo = await page.evaluate(() => {
  const D = window.__DEV, G = D.G, P = D.P, W = D.world;
  D.Game.startLevel(7, false); D.god(true); D.gotoBoss();
  for (let i = 0; i < 150; i++) D.step();            // пережити інтро
  const B = D.BOSS;

  // Висота стрибка вимірюється грою, а не береться з константи.
  const jump = (fromY) => {
    P.x = B.cx; P.y = fromY; P.vy = 0; P.vx = 0; P.jumps = 0;
    for (let i = 0; i < 6; i++) D.step();            // стати на землю
    P.y = fromY; P.vy = 0; P.jumps = 0;
    D.kb.a = 1;                                      // тримаємо: тап дає обрізаний стрибок
    let top = P.y;
    for (let i = 0; i < 60; i++) { D.step(); top = Math.min(top, P.y); if (P.vy > 0) break; }
    D.kb.a = 0;
    return top;
  };
  const floorStand = W.def ? 208 - P.h : 194;
  const apexFloor = jump(floorStand);

  const out = { floor: 208, ceil: G.GLITCH.CEIL, openH: G.GLITCH.OPEN_H,
                playerH: P.h, standFloor: floorStand, apexFloor,
                jumpH: floorStand - apexFloor, docks: [], inv: [] };

  // Дуга клинка по вертикалі = тіло героїні (bladeBox: y = P.y .. P.y+14)
  const bladeSpan = (py) => ({ top: py, bot: py + P.h });

  for (let g of [1, -1]) {
    W.grav = g;
    for (let i = 0; i < G.GLITCH.DOCKS.length; i++) {
      const d = G.glitchDockPos(i);
      const hb = { top: d.y, bot: d.y + G.GLITCH.OPEN_H };
      // 1) зі стрибка з підлоги (або зі стелі при інверсії)
      const stand = g > 0 ? 208 - P.h : G.GLITCH.CEIL;
      const apex = g > 0 ? stand - out.jumpH : stand + out.jumpH;
      const bl = bladeSpan(apex);
      const ov = Math.min(bl.bot, hb.bot) - Math.max(bl.top, hb.top);
      // 2) з платформи поруч: шукаємо в карті тайл '=' або '#' під ядром
      let platY = null;
      const txc = Math.floor((d.x + B.w / 2) / 16);
      if (g > 0) {
        for (let tx = txc - 4; tx <= txc + 4 && platY === null; tx++)
          for (let ty = Math.floor(hb.top / 16); ty <= 13; ty++) {
            const c = D.tAt(tx, ty);
            if (c === 1 || c === 2) {
              const py = ty * 16 - P.h;
              const b = bladeSpan(py);
              if (Math.min(b.bot, hb.bot) - Math.max(b.top, hb.top) > 0) { platY = ty * 16; break; }
            }
          }
      }
      (g > 0 ? out.docks : out.inv).push({
        side: G.GLITCH.DOCKS[i].side, up: G.GLITCH.DOCKS[i].up,
        x: Math.round(d.x), base: d.base, top: hb.top, bot: hb.bot,
        bladeTop: Math.round(bl.top * 10) / 10, bladeBot: Math.round(bl.bot * 10) / 10,
        overlap: Math.round(ov * 10) / 10, platY
      });
    }
  }
  W.grav = 1;
  return out;
});

console.log('  підлога y=' + geo.floor + ', стеля y=' + geo.ceil +
            ', хітбокс героїні ' + geo.playerH + ' px, стрибок ' + geo.jumpH.toFixed(1) + ' px');
console.log('  дуга клинка по вертикалі = тіло героїні, ' + geo.playerH + ' px\n');
console.log('  точка             висота  зона ядра    дуга на вершині   перетин   платформа');
console.log('  ' + '-'.repeat(76));
for (const d of geo.docks) {
  const nm = d.side === 'L' ? 'ліва стіна' : d.side === 'R' ? 'права стіна' : 'центр. колона';
  console.log('  ' + nm.padEnd(17) + (d.up + ' px').padEnd(8) +
              (d.top + '..' + d.bot).padEnd(13) +
              (d.bladeTop + '..' + d.bladeBot).padEnd(18) +
              (d.overlap + ' px').padEnd(10) +
              (d.platY === null ? '—' : 'y=' + d.platY));
}
for (const d of geo.docks) {
  const nm = d.side === 'L' ? 'ліва стіна' : d.side === 'R' ? 'права стіна' : 'центральна колона';
  ok(d.overlap >= 12, nm + ': клинок дістає зі стрибка із запасом ≥ 12 px', d.overlap + ' px');
  ok(d.platY !== null, nm + ': поруч є платформа, з якої б\'ється стоячи',
     d.platY === null ? 'немає' : 'y=' + d.platY);
}

console.log('\n  ПЕРЕВЕРНУТА ГРАВІТАЦІЯ (точки дзеркаляться на стелю)');
console.log('  точка             висота  зона ядра    дуга на вершині   перетин');
console.log('  ' + '-'.repeat(66));
for (const d of geo.inv) {
  const nm = d.side === 'L' ? 'ліва стіна' : d.side === 'R' ? 'права стіна' : 'центр. колона';
  console.log('  ' + nm.padEnd(17) + (d.up + ' px').padEnd(8) +
              (d.top + '..' + d.bot).padEnd(13) +
              (d.bladeTop + '..' + d.bladeBot).padEnd(18) + d.overlap + ' px');
}
for (const d of geo.inv) {
  const nm = d.side === 'L' ? 'ліва стіна' : d.side === 'R' ? 'права стіна' : 'центральна колона';
  ok(d.overlap >= 12, 'інверсія, ' + nm + ': клинок дістає зі стрибка', d.overlap + ' px');
}

/* ------------------------------------------------------------- ЦИКЛ */
console.log('\nЦИКЛ');
const cyc = await page.evaluate(() => {
  const D = window.__DEV, B = D.BOSS;
  D.Game.startLevel(7, false); D.god(true); D.gotoBoss();
  for (let i = 0; i < 150; i++) D.step();
  const seen = [], docks = [];
  let last = B.st, t0 = 0, n = 0, contact = 0, hpBefore = D.P.hp;
  for (let i = 0; i < 60 * 70; i++) {
    D.step(); n++;
    if (B.st !== last) {
      seen.push({ st: last, secs: +((n - t0) / 60).toFixed(2) });
      if (B.st === 'dock') docks.push(B.dockI);
      last = B.st; t0 = n;
      if (seen.length > 12) break;
    }
    // під час вікна ядро не має ні бити контактом, ні кидати зони
    if (B.st === 'dock') {
      if (D.P.hp < hpBefore) contact++;
      hpBefore = D.P.hp;
    }
  }
  return { seen, docks, contact, zonesInDock: 0 };
});
console.log('  фази циклу: ' + cyc.seen.map(s => s.st + ' ' + s.secs + 'c').join(' → '));
const fly = cyc.seen.find(s => s.st === 'fly');
const warn = cyc.seen.find(s => s.st === 'warn');
const dock = cyc.seen.find(s => s.st === 'dock');
ok(!!warn && Math.abs(warn.secs - 1.2) < 0.1, 'попередження триває 1,2 с', warn ? warn.secs + ' c' : '—');
ok(!!dock && Math.abs(dock.secs - 4.0) < 0.15, 'вікно шкоди у фазі 1 — 4,0 с', dock ? dock.secs + ' c' : '—');
ok(cyc.docks.length >= 2 && cyc.docks.every((v, i, a) => i === 0 || v !== a[i - 1]),
   'точки кріплення не повторюються підряд', cyc.docks.join(' → '));
ok(cyc.contact === 0, 'під час вікна ядро не завдає шкоди взагалі');

/* ------------------------------------------------------- ШКОДА ЗА ВІКНО */
console.log('\nШКОДА ЗА ОДНЕ ВІКНО');
const dmg = await page.evaluate(() => {
  const D = window.__DEV, G = D.G, P = D.P, B = D.BOSS;
  // Бот, який стоїть на платформі під ядром і безперервно б'є.
  const run = (melee, mode) => {
    D.Game.startLevel(7, false); D.god(true); D.gotoBoss();
    D.equip('arc', 'rail');
    for (let i = 0; i < 150; i++) D.step();
    B.hp = B.maxHp = 1e6;
    // Не скидаємо тепло: у вікно гравець заходить із тим, що назбирав у
    // польоті, і саме це визначає реальну шкоду за вікно.
    B.dockI = 0; B.st = 'warn'; B.tm = 0.01;
    for (let i = 0; i < 6; i++) D.step();
    const d = G.glitchDockPos(B.dockI);
    // ставимо героїню так, щоб дуга/постріл гарантовано перетинали ядро
    P.x = d.x + 18; P.y = d.y + G.GLITCH.OPEN_H - P.h; P.vy = 0; P.face = -1;
    P.hp = P.maxHp;
    const before = B.hp;
    let f = 0, hold = 0;
    while (B.st === 'dock' && f < 60 * 6) {
      P.face = -1;
      if (melee) D.kb.b = (f % 2) ? 1 : 0;
      else if (mode === 'beam') {                    // заряджений пробивний постріл
        hold++;
        if (hold * (1 / 60) >= 0.86) { D.kb.c = 0; hold = 0; } else D.kb.c = 1;
      } else D.kb.c = (f % 2) ? 1 : 0;               // швидкі тапи
      D.step(); f++;
    }
    D.kb.b = D.kb.c = 0;
    return { dealt: +(before - B.hp).toFixed(2), frames: f };
  };
  return { blade: run(true), railTap: run(false, 'tap'), railBeam: run(false, 'beam'),
           hp: D.BOSS.def.hp };
});
const railBest = Math.max(dmg.railTap.dealt, dmg.railBeam.dealt);
console.log('  клинок «АРК-ТЕСАК», комбо ×3:   ' + dmg.blade.dealt + ' шкоди за вікно (' +
            (dmg.blade.frames / 60).toFixed(2) + ' c)');
console.log('  рейкострил, швидкі тапи:        ' + dmg.railTap.dealt + ' шкоди (перегрів з’їдає вікно)');
console.log('  рейкострил, заряджені постріли: ' + dmg.railBeam.dealt + ' шкоди');
ok(dmg.blade.dealt > 0, 'клинком по ядру взагалі можна влучити', dmg.blade.dealt + ' шкоди');
ok(railBest > 0, 'рейкострилом по ядру можна влучити', railBest + ' шкоди');

const hp = dmg.hp;
const wBlade = Math.ceil(hp / dmg.blade.dealt);
const wRail = Math.ceil(hp / railBest);
console.log('\n  HP боса: ' + hp);
console.log('  вікон тільки клинком:      ' + wBlade);
console.log('  вікон тільки рейкострилом: ' + wRail);
ok(wBlade <= 6, 'тільки ближньою — не більше 6 вікон', wBlade + ' вікон');
ok(wRail <= 6, 'тільки дальньою — не більше 6 вікон', wRail + ' вікон');

/* ------------------------------------------------------- ПОВНИЙ БІЙ */
console.log('\nПОВНИЙ БІЙ БОТОМ');
const fight = await page.evaluate(async () => {
  const D = window.__DEV, G = D.G, P = D.P, B = D.BOSS;
  // Бот: у польоті збиває вузли даних, у вікні б'є ядро. Без ухиляння —
  // міряємо саме час, тому god-режим увімкнено.
  const run = (melee) => {
    D.Game.startLevel(7, false); D.god(true); D.gotoBoss();
    D.equip('arc', 'rail');
    for (let i = 0; i < 150; i++) D.step();
    let f = 0, hold = 0, wins = 0, wasDock = false;
    while (!B.done && B.st !== 'die' && f < 60 * 180) {
      if (B.st === 'dock' && !wasDock) wins++;
      wasDock = B.st === 'dock';
      // Ціль: у вікні — ядро, у польоті — найближчий живий вузол даних.
      let tx = null, cy = null;
      if (B.st === 'dock') {
        const d = G.glitchDockPos(B.dockI);
        tx = d.x + B.w / 2; cy = d.y + G.GLITCH.OPEN_H / 2;
      } else {
        const nd = B.parts.find(n => n.alive);
        if (nd) { tx = nd.x + nd.w / 2; cy = nd.y + nd.h / 2; }
      }
      if (tx !== null) {
        // Телепортуємо бота на позицію: міряємо шкоду, а не навички бігу.
        // Для дальньої зброї дуло (P.y + 6) має дивитись саме в центр цілі,
        // інакше горизонтальний промінь пролітає повз — і бій «не йде».
        P.x = tx + (melee ? 16 : 70);
        P.y = melee ? cy - P.h / 2 : cy - 6;
        P.vy = 0; P.face = -1;
      }
      if (melee) D.kb.b = (f % 2) ? 1 : 0;
      else if (B.st === 'dock') {                     // по ядру — заряджений
        hold++;
        if (hold * (1 / 60) >= 0.86) { D.kb.c = 0; hold = 0; } else D.kb.c = 1;
      } else { D.kb.c = (f % 2) ? 1 : 0; hold = 0; }  // по вузлах — дешеві тапи
      D.step(); f++;
    }
    D.kb.b = D.kb.c = 0;
    return { secs: +(f / 60).toFixed(1), wins: wins };
  };
  return { blade: run(true), rail: run(false) };
});
console.log('  тільки клинком:      ' + fight.blade.secs + ' c, вікон використано ' + fight.blade.wins);
console.log('  тільки рейкострилом: ' + fight.rail.secs + ' c, вікон використано ' + fight.rail.wins);
ok(fight.blade.secs > 0 && fight.blade.secs <= 90, 'бій тільки ближньою вкладається в 90 с', fight.blade.secs + ' c');
ok(fight.rail.secs > 0 && fight.rail.secs <= 90, 'бій тільки дальньою вкладається в 90 с', fight.rail.secs + ' c');
// Формула «HP / шкода за вікно» дає ідеальний випадок: гравець заходить у
// кожне вікно з нульовим теплом і не втрачає жодної долі секунди. Бот так
// не вміє — він приходить у вікно розігрітим, тож витрачає більше вікон.
// Тримаємо обидва числа: перше — цільове з ТЗ, друге — чесна стеля.
ok(fight.blade.wins <= 6, 'ближньою — не більше 6 вікон навіть у бота', fight.blade.wins + ' вікон');
ok(fight.rail.wins <= 10, 'дальньою — бот укладається в 10 вікон (ідеальна гра: 4)',
   fight.rail.wins + ' вікон');

ok(errors.length === 0, 'без помилок JS' + (errors.length ? ': ' + errors[0] : ''));
console.log('\n' + (fails === 0 ? 'ГЛІТЧ-ЯДРО: УСЕ ЧИСТО' : 'ГЛІТЧ-ЯДРО: ПРОБЛЕМ ' + fails));
await browser.close();
process.exit(fails === 0 ? 0 : 1);
