/**
 * ХАРАКТЕР СЕКТОРІВ.
 *
 * Темрява в метро вийшла найцікавішою тому, що це МЕХАНІКА. Тут
 * перевіряємо, що тепер така є в кожного з десяти — і що вона справді
 * щось робить, а не просто оголошена: вітер зносить у повітрі, прес
 * б'є за телеграфом і давить ворогів, гаряча зона гріє зброю вдвічі
 * швидше, зона інверсії перевертає гравітацію, підлога обвалюється.
 *
 * Плюс розмір: кожен сектор має бути 8-12 екранів, з одним спавном,
 * одним виходом і одним тригером боса.
 *   node tests/levels.mjs
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
await page.waitForTimeout(300);

let fails = 0;
const ok = (c, m, extra) => { if (!c) { fails++; console.log('  ✗ ' + m + (extra ? '  → ' + extra : '')); }
                              else console.log('  ✓ ' + m + (extra ? '  (' + extra + ')' : '')); };

/* ---------- РОЗМІР І СТРУКТУРА ---------- */
const sizes = await page.evaluate(() => {
  const D = window.__DEV, out = [];
  for (let i = 0; i < D.levels(); i++) {
    D.Game.startLevel(i, false);
    const def = D.world.def, rows = def.rows, all = rows.join('');
    const c = ch => all.split(ch).length - 1;
    out.push({ i: i + 1, n: def.n, w: rows[0].length,
               screens: +(rows[0].length * D.TS / D.VW).toFixed(1),
               spawn: c('@'), exit: c('E'), boss: c('!'), frag: c('*'),
               cp: c('$'), crack: D.world.def.rows.join('').split('x').length - 1,
               fx: D.G.LFX.kind,
               // вітер і туман — механіки глобальні, вузлів на карті не мають
               parts: (D.G.LFX.signs.length + D.G.LFX.presses.length + D.G.LFX.trains.length +
                       D.G.LFX.zones.length + D.G.LFX.grav.length + D.G.LFX.crumble.length) ||
                      ((D.G.LFX.windT > 0 ? 1 : 0) + (D.G.LFX.fog ? 1 : 0)),
               vaults: D.G.LFX.vaults.length, chal: !!D.G.LFX.chal, arcade: !!D.G.LFX.arcade,
               vista: D.G.LFX.vista.length });
  }
  return out;
});
const FX = { slum: 'дощ і зламані вивіски', docks: 'крани й контейнери',
             roofs: 'вітер і зиплайни', factory: 'конвеєри та преси',
             metro: 'темрява й потяги', garden: 'туман і калюжі',
             server: 'спека й холодні острівці', virtual: 'інверсія гравітації',
             spire: 'підйом на час', core: 'усе разом' };
console.log('СЕКТОРИ: РОЗМІР І ГОЛОВНА МЕХАНІКА\n');
console.log('  #  сектор                 ширина  екранів  механіка                вузлів  ніш  виклик');
console.log('  ' + '-'.repeat(96));
for (const r of sizes)
  console.log('  ' + String(r.i).padEnd(3) + r.n.padEnd(23) + String(r.w).padStart(5) +
              String(r.screens).padStart(9) + '   ' + (FX[r.fx] || r.fx).padEnd(24) +
              String(r.parts).padStart(4) + String(r.vaults).padStart(6) +
              (r.chal ? '    так' : '    нема'));
console.log();
for (const r of sizes) {
  ok(r.screens >= 8 && r.screens <= 12, r.n + ': 8-12 екранів', r.screens + ' екрана');
  ok(r.spawn === 1 && r.exit === 1, r.n + ': один спавн і один вихід');
  ok(r.parts >= 1, r.n + ': механіка справді має вузли на карті', String(r.parts));
}
console.log();
ok(sizes.every(r => r.vaults >= 1), 'у кожному секторі є тріснута стіна із секретом',
   sizes.map(r => r.vaults).join(','));
ok(sizes.every(r => r.chal), 'у кожному секторі є кімната-виклик');
ok(sizes.filter(r => r.arcade).length === 1, 'пасхалка рівно одна на гру',
   'сектор ' + (sizes.findIndex(r => r.arcade) + 1));
ok(sizes.every(r => r.vista >= 1), 'у кожному секторі є місце-краєвид');

/* ---------- МЕХАНІКИ СПРАВДІ ПРАЦЮЮТЬ ---------- */
console.log('\nЩО МЕХАНІКА РОБИТЬ НАСПРАВДІ\n');

const wind = await page.evaluate(() => {
  const D = window.__DEV, P = D.P, L = D.G.LFX;
  D.Game.startLevel(2, false); D.god(true);           // дахи: вітер
  for (let i = 0; i < 10; i++) D.step();
  // міряємо ЗСУВ за секунду польоту, а не миттєву швидкість
  // беремо гарантовано рівне й відкрите місце — кімнату-виклик
  const x0 = L.chal.x + 60, y0 = L.chal.gy - 90;
  const fly = (w) => {
    P.x = x0; P.y = y0; P.vx = 0; P.vy = 0;
    for (let i = 0; i < 60; i++) { L.wind = w; L.windT = 9; P.vy = 0; P.y = y0; D.step(); }
    return P.x - x0;
  };
  const withWind = fly(1), noWind = fly(0);
  return { air: +withWind.toFixed(1), ground: +noWind.toFixed(1) };
});
ok(wind.air > 40, 'ВІТЕР зносить у повітрі', 'за секунду польоту зсув ' + wind.air +
   ' px проти ' + wind.ground + ' px без вітру');

const heat = await page.evaluate(() => {
  const D = window.__DEV, P = D.P, L = D.G.LFX;
  D.Game.startLevel(6, false); D.god(true);           // серверна: спека
  D.Store.data.owned = Object.keys(D.WEAPONS); D.equip('arc', 'rail');
  for (let i = 0; i < 6; i++) D.step();
  const z = L.zones.find(q => q.hot), c = L.zones.find(q => !q.hot);
  const run = (x) => { P.x = x; P.y = 12 * D.TS - P.h; P.heat = 40; P.inv = 9;
    for (let i = 0; i < 60; i++) { P.x = x; P.y = 12 * D.TS - P.h; D.step(); }
    return +P.heat.toFixed(1); };
  return { hot: run(z.x + z.w / 2), cold: run(c.x + c.w / 2) };
});
ok(heat.hot > 40 && heat.cold < 40, 'СПЕКА гріє зброю, холодний острівець її гасить',
   'тепло 40 -> ' + heat.hot + ' у гарячій, -> ' + heat.cold + ' у холодній');

const grav = await page.evaluate(() => {
  const D = window.__DEV, P = D.P, L = D.G.LFX;
  D.Game.startLevel(7, false); D.god(true);           // віртуал: інверсія
  for (let i = 0; i < 6; i++) D.step();
  const z = L.grav[0];
  P.x = 100; for (let i = 0; i < 4; i++) D.step();
  const before = D.state().grav;
  P.x = z.x + z.w / 2; for (let i = 0; i < 4; i++) D.step();
  const inside = D.state().grav;
  P.x = 100; for (let i = 0; i < 4; i++) D.step();
  return { before, inside, after: D.state().grav };
});
ok(grav.before === 1 && grav.inside === -1 && grav.after === 1,
   'ЗОНА ІНВЕРСІЇ перевертає гравітацію й повертає її на виході',
   grav.before + ' -> ' + grav.inside + ' -> ' + grav.after);

const press = await page.evaluate(() => {
  const D = window.__DEV, P = D.P, L = D.G.LFX;
  D.Game.startLevel(3, false); D.god(true);           // фабрика: преси
  for (let i = 0; i < 6; i++) D.step();
  const m = L.presses[0];
  D.ENEM.length = 0;
  P.x = m.x - 200; P.y = 12 * D.TS - P.h; P.inv = 9;
  const e = D.spawnEnemy('thug', m.x + 10, m.gy - 40, false);
  e.blind = 1; e.sp = 0; e.st = 'idle'; e.hp = e.maxHp;
  let sawTel = 0, sawZone = 0;
  for (let i = 0; i < 60 * 8; i++) {
    e.x = m.x + 10; e.y = m.gy - e.h; e.vx = 0; e.vy = 0; P.x = m.x - 200;
    D.step();
    if (D.TELE.length) sawTel = 1;
    if (D.ZONES.length) sawZone = 1;
    if (e.dead) break;
  }
  return { tel: sawTel, zone: sawZone, killed: e.dead };
});
ok(press.tel && press.zone, 'ПРЕС попереджає телеграфом і б\'є зоною');
ok(press.killed, 'пресом можна розчавити ворога — вбивство чужими руками');

const fall = await page.evaluate(() => {
  const D = window.__DEV, P = D.P, L = D.G.LFX;
  D.Game.startLevel(8, false); D.god(true);           // шпиль: підлога обвалюється
  for (let i = 0; i < 6; i++) D.step();
  const c = L.crumble[0];
  P.x = c.x + c.w * 0.6; P.y = 12 * D.TS - P.h; P.inv = 9;
  const tx = Math.floor((c.x + c.w * 0.5) / D.TS);
  const before = D.solidAtPx(tx * D.TS + 2, 13 * D.TS + 2);
  for (let i = 0; i < 120; i++) { P.x = c.x + c.w * 0.6; P.y = 12 * D.TS - P.h; D.step(); }
  const after = D.solidAtPx(tx * D.TS + 2, 13 * D.TS + 2);
  // смерть і перезапуск із чекпоінта мають повертати підлогу,
  // інакше гравець застрягне в ямі, яку сам же і зробив
  D.god(false); P.inv = 0; P.hp = 1;
  P.y = D.world.ph + 300;                                   // падіння за карту = смерть
  for (let i = 0; i < 400 && !P.dead; i++) D.step();
  const died = P.dead;
  D.Game.startLevel(8, true);                               // «продовжити з чекпоінта»
  for (let i = 0; i < 10; i++) D.step();
  return { before, after, dead: died, restored: D.solidAtPx(tx * D.TS + 2, 13 * D.TS + 2) };
});
ok(fall.before && !fall.after, 'ПІДЛОГА обвалюється позаду гравця');
ok(fall.restored, 'після смерті підлога повертається — у пастці не лишишся');

ok(errors.length === 0, 'без помилок JS' + (errors.length ? ': ' + errors[0] : ''));
console.log('\n' + (fails === 0 ? 'СЕКТОРИ: УСЕ ЧИСТО' : 'СЕКТОРИ: ПРОБЛЕМ ' + fails));
await browser.close();
process.exit(fails === 0 ? 0 : 1);
