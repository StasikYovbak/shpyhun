/**
 * ДЕТАЛІЗАЦІЯ: чи справді на 24x30 щось з'явилось.
 *
 * Перевіряємо не «красиво/некрасиво», а факти, які можна порахувати:
 * скільки кольорів у спрайті (шість тонів на матеріал дають об'єм —
 * на чотирьох фігура лишається плоскою), скільки кадрів у бігу, чи є
 * побитий вигляд на двох серцях, чи ворог із 20 % HP справді змінюється,
 * і чи бос видимо міняється на другій і третій фазі.
 *   node tests/detail.mjs
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

/* ---------- 1. СПРАЙТ ГЕРОЇНІ ---------- */
const hero = await page.evaluate(() => {
  const F = window.__DEV.Gfx.frames();
  const names = Object.keys(F);
  return { names: names.filter(n => n.startsWith('hero_')),
           runs: names.filter(n => /^hero_run\d+$/.test(n)).length,
           dmg: names.filter(n => n.startsWith('hero_dmg_')).length,
           atk: names.filter(n => n.startsWith('hero_a_')).length,
           w: F.hero_idle.w, h: F.hero_idle.h };
});
console.log('СПРАЙТИ ГЕРОЇНІ\n');
console.log('  кадрів усього ' + hero.names.length + ', з них бігу ' + hero.runs +
            ', атак ' + hero.atk + ', побитих ' + hero.dmg);
console.log('  розмір кадру ' + hero.w + 'x' + hero.h + '\n');
ok(hero.w >= 24 && hero.h >= 30, 'сітка спрайта 24x30', hero.w + 'x' + hero.h);
ok(hero.runs === 8, 'вісім кадрів бігу замість трьох', String(hero.runs));
ok(hero.atk >= 38, 'кадри атаки на кожну зброю на місці', String(hero.atk));
ok(hero.dmg >= 8, 'є побита версія найчастіших поз', String(hero.dmg));

/* ---------- 2. ШІСТЬ ТОНІВ НА МАТЕРІАЛ ---------- */
const tones = await page.evaluate(async () => {
  const img = new Image();
  await new Promise(r => { img.onload = r; img.src = 'assets/atlas.png'; });
  const f = window.__DEV.Gfx.frames().hero_idle;
  const c = document.createElement('canvas'); c.width = f.w; c.height = f.h;
  const g = c.getContext('2d');
  g.drawImage(img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
  const d = g.getImageData(0, 0, f.w, f.h).data;
  const set = new Set();
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 20)
    set.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  return set.size;
});
console.log();
ok(tones >= 20, 'у спокійному кадрі не менше 20 кольорів — по шість тонів на матеріал',
   tones + ' кольорів');

/* ---------- 3. ГЕРОЇНЯ ВИГЛЯДАЄ ПОБИТОЮ ---------- */
const worn = await page.evaluate(() => {
  const D = window.__DEV, P = D.P;
  D.Game.startLevel(0, false); D.god(true);
  for (let i = 0; i < 10; i++) D.step();
  P.hp = 5; D.kb.r = 1; for (let i = 0; i < 20; i++) D.step();
  const full = P.anim;
  P.hp = 2; for (let i = 0; i < 20; i++) D.step();
  const low = P.anim;
  D.kb.r = 0;
  return { full, low, worn: P.worn };
});
ok(worn.worn && worn.low.indexOf('dmg_') === 0,
   'на двох серцях героїня переходить у побитий набір кадрів',
   worn.full + ' -> ' + worn.low);

/* ---------- 4. ШАРФ ІЗ СЕМИ ЛАНОК РЕАГУЄ НА РУХ ---------- */
const scarf = await page.evaluate(() => {
  const D = window.__DEV, P = D.P;
  D.Game.startLevel(0, false); D.god(true);
  for (let i = 0; i < 30; i++) { D.step(); D.render(); }
  const still = D.Gfx.scarfSpan();
  D.kb.r = 1; for (let i = 0; i < 60; i++) { D.step(); D.render(); }
  const run = D.Gfx.scarfSpan();
  D.kb.r = 0;
  return { still, run };
});
ok(scarf.run !== null && scarf.run.n === 7, 'шарф із семи ланок', 'ланок ' + (scarf.run && scarf.run.n));
ok(scarf.run && scarf.still && scarf.run.span > scarf.still.span + 2,
   'на бігу шарф витягується назад сильніше, ніж у спокої',
   scarf.still && (scarf.still.span.toFixed(1) + ' -> ' + scarf.run.span.toFixed(1) + ' px'));

/* ---------- 5-6. ЧИ ВИДНО РІЗНИЦЮ НА ЕКРАНІ ----------
 * Іскри, дим і оголене ядро малюються примітивами рендеру, а не
 * частками, тож рахувати об'єкти безглуздо. Міряємо чесно: знімаємо
 * той самий кадр у двох станах і рахуємо, СКІЛЬКИ ПІКСЕЛІВ змінилось.
 */
const shotAt = async (setup, clip) => {
  await page.evaluate(setup);
  await page.waitForTimeout(120);
  return page.screenshot({ clip });
};
const diff = (a, b) => {
  let n = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) n++;
  return n;
};

const CLIP = { x: 380, y: 150, width: 200, height: 160 };
const foeShot = (frac) => `(() => {
  const D = window.__DEV, P = D.P;
  D.Game.startLevel(0, false); D.god(true);
  for (let i = 0; i < 20; i++) D.step();
  D.ENEM.length = 0;
  P.x = 200; P.y = 13 * D.TS - P.h; P.inv = 9; P.hp = P.maxHp;
  const e = D.spawnEnemy('thug', P.x + 60, 13 * D.TS - 40, false);
  e.blind = 1; e.sp = 0; e.st = 'idle'; e.vx = 0; e.hp = e.maxHp * ${frac};
  for (let i = 0; i < 30; i++) { e.hp = e.maxHp * ${frac}; e.vx = 0; D.step(); }
  D.render();
})()`;
const a1 = await shotAt(foeShot(1), CLIP);
const a2 = await shotAt(foeShot(0.15), CLIP);
console.log();
ok(diff(a1, a2) > 400, 'ворог на 15 % HP виглядає інакше: іскри, дим, осідання',
   diff(a1, a2) + ' змінених байтів кадру');

const bossShot = (ph) => `(() => {
  const D = window.__DEV, B = D.BOSS;
  D.Game.startLevel(9, false); D.god(true); D.gotoBoss();
  for (let i = 0; i < 200; i++) D.step();
  B.phase = ${ph}; B.st = 'idle'; B.tm = 9; B.rage = false;
  for (let i = 0; i < 6; i++) D.step();
  D.render();
})()`;
const b1 = await shotAt(bossShot(1), CLIP);
const b2 = await shotAt(bossShot(2), CLIP);
const b3 = await shotAt(bossShot(3), CLIP);
ok(diff(b1, b2) > 400, 'на другій фазі бос ВИДИМО інший: броня розходиться щілинами',
   diff(b1, b2) + ' змінених байтів');
ok(diff(b1, b3) > diff(b1, b2), 'на третій зміна ще сильніша: ядро оголене',
   diff(b1, b3) + ' проти ' + diff(b1, b2));

ok(errors.length === 0, 'без помилок JS' + (errors.length ? ': ' + errors[0] : ''));
console.log('\n' + (fails === 0 ? 'ДЕТАЛІЗАЦІЯ: УСЕ ЧИСТО' : 'ДЕТАЛІЗАЦІЯ: ПРОБЛЕМ ' + fails));
await browser.close();
process.exit(fails === 0 ? 0 : 1);
