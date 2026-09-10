/**
 * Ехо-Призма й видача нагород за рівні:
 * рикошет із роздвоєнням, три фрагменти, збирання на чекпоінті,
 * і те, що зброя тепер приходить за проходження, а не з підлоги.
 *   node tests/prism.mjs
 */
let pw; try { pw = await import('playwright'); } catch (e) { pw = await import('/opt/node22/lib/node_modules/playwright/index.js'); }
const chromium = pw.chromium || pw.default.chromium;
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 420 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(process.env.URL || 'http://localhost:4173/');
await page.waitForFunction(() => !!window.__DEV, null, { timeout: 20000 });
await page.click('#mPlay');
await page.waitForTimeout(300);

let fails = 0;
const ok = (c, m, extra) => { if (!c) { fails++; console.log('  ✗ ' + m + (extra ? '  → ' + extra : '')); }
                              else console.log('  ✓ ' + m + (extra ? '  (' + extra + ')' : '')); };

console.log('ВИДАЧА ЗБРОЇ ЗА ПРОХОДЖЕННЯ\n');
const table = await page.evaluate(() => {
  const D = window.__DEV, out = [];
  D.Store.clear();
  for (let i = 0; i < 10; i++) {
    const before = D.Store.data.owned.slice();
    const r = D.levelReward(i);
    out.push({ lvl: i + 1, kind: r ? r.kind : null, name: r ? r.name : '—',
               added: D.Store.data.owned.filter(w => before.indexOf(w) < 0) });
  }
  return { out, hearts: D.maxHearts(), key: D.Store.data.ngKey, owned: D.Store.data.owned.length };
});
for (const r of table.out)
  console.log('  сектор ' + String(r.lvl).padStart(2) + '  ' + (r.kind || '—').padEnd(7) + '  ' + r.name);
ok(table.out.filter(r => r.kind === 'weapon').length === 8, 'вісім зброй за вісім секторів',
   String(table.out.filter(r => r.kind === 'weapon').length));
ok(table.hearts === 6, 'сектор 9 дає +1 серце назавжди', String(table.hearts) + ' сердець');
ok(table.key === 1, 'сектор 10 дає ключ і відкриває НОВУ ГРУ+');
ok(table.out[0].added[0] === 'osa' && table.out[7].added[0] === 'glitch', 'порядок видачі як у таблиці');
ok(await page.evaluate(() => window.__DEV.levelReward(0) === null), 'повторне проходження не дублює нагороду');

console.log('\nФРАГМЕНТИ ЕХО-ПРИЗМИ\n');
const frags = await page.evaluate(() => {
  const D = window.__DEV, out = [];
  for (let i = 0; i < 10; i++) {
    const rows = D.G.LEVELS[i].rows;
    for (let y = 0; y < rows.length; y++) {
      const x = rows[y].indexOf('*');
      if (x >= 0) out.push({ lvl: i + 1, tx: x, ty: y, px: x * 16, py: y * 16 });
    }
  }
  return out;
});
for (const f of frags)
  console.log('  сектор ' + String(f.lvl).padStart(2) + '  тайл (' + f.tx + ',' + f.ty + ')  піксель (' + f.px + ',' + f.py + ')');
ok(frags.length === 3, 'рівно три фрагменти', String(frags.length));
ok(frags.map(f => f.lvl).join(',') === '3,6,9', 'на секторах 3, 6 і 9', frags.map(f => f.lvl).join(','));

const pick = await page.evaluate(async () => {
  const D = window.__DEV, P = D.P;
  D.Store.clear();
  const got = [];
  for (const lvl of [2, 5, 8]) {
    D.Game.startLevel(lvl, false); D.god(true);
    const pk = D.PICKS.find(p => p.kind === 'frag');
    if (!pk) { got.push('нема пікапа на ' + (lvl + 1)); continue; }
    P.x = pk.x - 2; P.y = pk.y - 2; P.vx = 0; P.vy = 0;
    for (let i = 0; i < 6; i++) D.step();
    got.push(D.Store.data.frags.length);
  }
  return { got, owned: D.Store.data.owned.indexOf('prism') >= 0 };
});
ok(pick.got.join(',') === '1,2,3', 'фрагменти підбираються по одному', pick.got.join(','));
ok(!pick.owned, 'сама призма ще не зібрана — чекає на чекпоінт');

const asm = await page.evaluate(() => {
  const D = window.__DEV, P = D.P;
  D.Game.startLevel(0, false); D.god(true);
  const cp = D.world.cps[0];
  P.x = cp.x; P.y = cp.y; P.vx = 0; P.vy = 0;
  for (let i = 0; i < 10; i++) D.step();
  return { owned: D.Store.data.owned.indexOf('prism') >= 0, name: D.Game.pickupName };
});
ok(asm.owned, 'на чекпоінті призма збирається сама', asm.name);

console.log('\nРИКОШЕТ ІЗ РОЗДВОЄННЯМ\n');
const ric = await page.evaluate(() => {
  const D = window.__DEV, P = D.P;
  D.Game.startLevel(0, false); D.god(true);
  D.equip('arc', 'prism');
  D.ENEM.length = 0;                              // щоб промінь дожив до стіни
  P.x = 40; P.y = 194; P.vx = 0; P.vy = 0; P.face = 1; P.cores = 3;
  D.BULL.length = 0;
  for (let i = 0; i < 3; i++) D.step();
  D.kb.c = 1; D.step(); D.kb.c = 0;
  const tr = [];
  let peak = 0, minB = 5;
  for (let i = 0; i < 170; i++) {
    D.step();
    const bs = D.BULL.filter(b => b.kind === 6);
    peak = Math.max(peak, bs.length);
    for (const b of bs) minB = Math.min(minB, b.bounce);
    if (i % 20 === 0) tr.push([i, bs.length]);
  }
  return { peak, tr, cores: P.cores, used: 5 - minB };
});
console.log('  кадр/променів: ' + ric.tr.map(t => t[0] + ':' + t[1]).join('  '));
ok(ric.peak >= 2, 'промінь роздвоюється на відбитті',
   'максимум променів: ' + ric.peak + ', відбиттів витрачено: ' + ric.used);
ok(ric.cores === 2, 'постріл коштує одне ядро', String(ric.cores) + ' лишилось');

const dmg = await page.evaluate(() => {
  const D = window.__DEV, P = D.P;
  D.Game.startLevel(0, false); D.god(true); D.equip('arc', 'prism');
  P.x = 40; P.y = 194; P.face = 1; P.cores = 3; P.vx = 0; P.vy = 0;
  for (let i = 0; i < 3; i++) D.step();
  D.ENEM.length = 0;
  const e = D.spawnEnemy('thug', P.x + 70, 192, false);
  e.blind = 1; e.sp = 0; e.st = 'idle'; e.hp = e.maxHp = 1000;
  D.kb.c = 1; D.step(); D.kb.c = 0;
  for (let i = 0; i < 90; i++) { D.step(); e.x = P.x + 70; e.y = 192; e.vx = 0; }
  const hit = e.maxHp - e.hp;
  e.dead = true;
  return +hit.toFixed(2);
});
ok(dmg > 0, 'промінь наносить шкоду', dmg + ' шкоди з одного ядра');

if (errors.length) { console.log('\nПОМИЛКИ JS: ' + errors.slice(0, 5).join(' | ')); fails += errors.length; }
console.log('\n' + (fails === 0 ? 'ПРИЗМА Й НАГОРОДИ: УСЕ ЧИСТО' : 'ПРОБЛЕМ: ' + fails));
await browser.close();
process.exit(fails === 0 ? 0 : 1);
