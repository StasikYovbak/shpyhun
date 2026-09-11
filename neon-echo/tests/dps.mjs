/**
 * Заміряний DPS усієї зброї на трьох дистанціях: 20, 60 і 120 px.
 *
 * Мішень — «громила» з нескінченним HP, який не рухається й не б'ється;
 * щокадру його ставлять на потрібну відстань, знята шкода додається до
 * лічильника. Герой у режимі бога, щоб бій не переривався.
 *
 * Перевіряє три правила з ТЗ:
 *   1. Дробовик сильніший за пістолет на ВСІХ дистанціях до 70 px,
 *      і помітно — не на 5 %.
 *   2. Пістолет виграє в дробовика на 120 px.
 *   3. Жодна зброя не найкраща на всіх трьох дистанціях одразу.
 *   node tests/dps.mjs
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

const SECS = Number(process.env.SECS || 10);
const DIST = [20, 60, 120];
const MELEE = ['arc', 'whip', 'brand', 'chrono', 'claws'];
const RANGED = ['rail', 'osa', 'swarm', 'shot', 'glitch', 'prism'];

async function measure(id, dist) {
  return page.evaluate(({ id, dist, secs }) => {
    const D = window.__DEV, P = D.P;
    const melee = ['arc', 'whip', 'brand', 'chrono', 'claws'].indexOf(id) >= 0;
    D.Game.startLevel(0, false); D.god(true);
    D.Store.data.owned = Object.keys(D.WEAPONS);
    D.equip(melee ? id : 'arc', melee ? 'rail' : id);
    for (let i = 0; i < 3; i++) D.step();
    P.x = 80; P.y = 208 - P.h; P.vy = 0; P.face = 1;
    P.heat = 0; P.cores = 3; P.shells = 6; P.reloadT = 0; P.droneCd = 0;
    D.kb.l = D.kb.r = D.kb.a = D.kb.b = D.kb.c = 0;

    const e = D.spawnEnemy('thug', P.x + dist, 208 - 20, false);
    if (!e) return { dps: 0 };
    e.blind = 1; e.sp = 0; e.st = 'idle'; e.alertSt = 'calm'; e.tm = 999;
    e.hp = e.maxHp = 1e7;

    let dealt = 0, before = e.hp;
    const key = melee ? 'b' : 'c';
    const N = Math.round(secs * 60);
    for (let f = 0; f < N; f++) {
      // мішень тримаємо строго на місці й на потрібній дистанції
      e.x = P.x + P.w / 2 + dist; e.y = 208 - e.h; e.vx = 0; e.vy = 0;
      e.dead = false; e.stun = 0; e.charm = 0; e.thrown = 0; e.hs = 0;
      if (e.hp < before) { dealt += before - e.hp; }
      before = e.hp = 1e7;
      P.x = 80; P.y = 208 - P.h; P.vy = 0; P.face = 1; P.hp = P.maxHp; P.inv = 1;
      D.kb[key] = (f % 2) ? 1 : 0;
      D.step();
    }
    if (e.hp < before) dealt += before - e.hp;
    D.kb[key] = 0;
    return { dps: +(dealt / secs).toFixed(2) };
  }, { id, dist, secs: SECS });
}

console.log('DPS УСІЄЇ ЗБРОЇ НА ТРЬОХ ДИСТАНЦІЯХ (' + SECS + ' с по нерухомій мішені)\n');
const rows = [];
for (const id of [...MELEE, ...RANGED]) {
  const r = { id, name: await page.evaluate(i => window.__DEV.WEAPONS[i].name, id), d: {} };
  for (const dist of DIST) r.d[dist] = (await measure(id, dist)).dps;
  rows.push(r);
}

console.log('  зброя                  20 px    60 px   120 px   тип');
console.log('  ' + '-'.repeat(58));
for (const r of rows) {
  const melee = MELEE.indexOf(r.id) >= 0;
  console.log('  ' + r.name.padEnd(22) +
              String(r.d[20]).padStart(6) + String(r.d[60]).padStart(9) +
              String(r.d[120]).padStart(9) + '   ' + (melee ? 'ближня' : 'дальня'));
}

const shot = rows.find(r => r.id === 'shot'), osa = rows.find(r => r.id === 'osa');
console.log();
ok(shot.d[20] > osa.d[20] * 1.3, 'дробовик помітно сильніший за пістолет на 20 px',
   shot.d[20] + ' проти ' + osa.d[20]);
ok(shot.d[60] > osa.d[60] * 1.3, 'дробовик помітно сильніший за пістолет на 60 px',
   shot.d[60] + ' проти ' + osa.d[60]);
ok(osa.d[120] > shot.d[120], 'пістолет виграє на 120 px',
   osa.d[120] + ' проти ' + shot.d[120]);

// жодна зброя не найкраща на всіх трьох дистанціях
const best = d => rows.reduce((a, b) => (b.d[d] > a.d[d] ? b : a));
const b20 = best(20), b60 = best(60), b120 = best(120);
console.log('  найкраща на 20 px: ' + b20.name + ', на 60 px: ' + b60.name +
            ', на 120 px: ' + b120.name);
ok(!(b20.id === b60.id && b60.id === b120.id),
   'жодна зброя не найкраща на всіх трьох дистанціях');

// Кожна зброя мусить мати дистанцію, де вона реально працює.
// Два винятки, і вони чесні: ГЛІЧ-КОД має dmg = 0 за задумом (він
// перехоплює ворога, а не вбиває), а ЕХО-ПРИЗМІ потрібні стіни для
// рикошету — на рівній підлозі їй нема від чого відбиватись.
const NODPS = ['glitch', 'prism'];
for (const r of rows) {
  if (NODPS.indexOf(r.id) >= 0) continue;
  const peak = Math.max(r.d[20], r.d[60], r.d[120]);
  ok(peak > 1.5, r.name + ': має дистанцію, де реально працює', 'пік ' + peak + ' DPS');
}
console.log('  (ГЛІЧ-КОД і ЕХО-ПРИЗМА не міряються DPS: перший перехоплює ворога,');
console.log('   друга живе з рикошетів від стін — на рівній підлозі їх нема)');

ok(errors.length === 0, 'без помилок JS' + (errors.length ? ': ' + errors[0] : ''));
console.log('\nJSON: ' + JSON.stringify(rows.map(r => ({ id: r.id, name: r.name, ...r.d }))));
console.log('\n' + (fails === 0 ? 'DPS: УСЕ ЧИСТО' : 'DPS: ПРОБЛЕМ ' + fails));
await browser.close();
process.exit(fails === 0 ? 0 : 1);
