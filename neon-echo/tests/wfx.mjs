/**
 * Візуальний почерк зброї: кожна з десяти лишає на екрані свій набір
 * ефектів і додає спрайтів у кадр. Перевіряємо, що ефекти реально
 * народжуються й малюються, а не існують лише в описі.
 *   node tests/wfx.mjs
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
await page.waitForTimeout(250);

let fails = 0;
const ok = (c, m, extra) => { if (!c) { fails++; console.log('  ✗ ' + m + (extra ? '  → ' + extra : '')); }
                              else console.log('  ✓ ' + m + (extra ? '  (' + extra + ')' : '')); };

// Кожній зброї — очікуваний набір ефектів (хоч один із перелічених).
const CASES = [
  { id: 'rail',   melee: 0, want: ['ray', 'rings'],  hold: 0, name: 'РЕЙКОСТРИЛ' },
  { id: 'rail',   melee: 0, want: ['rift'],          hold: 1, name: 'РЕЙКОСТРИЛ (заряд)' },
  { id: 'osa',    melee: 0, want: [],                hold: 0, name: 'ОСА', trail: 1 },
  { id: 'shot',   melee: 0, want: ['muzzle'],        hold: 0, name: 'КАРТЕЧ' },
  { id: 'glitch', melee: 0, want: [],                hold: 0, name: 'ГЛІЧ-КОД', pix: 1 },
  { id: 'prism',  melee: 0, want: ['node', 'grid'],  hold: 0, name: 'ЕХО-ПРИЗМА', bounce: 1, face: -1 },
  { id: 'swarm',  melee: 0, want: [],                hold: 0, name: 'РІЙ', drones: 1 },
  { id: 'brand',  melee: 1, want: ['plates'],        hold: 0, name: 'ТАВРО' },
  { id: 'brand',  melee: 1, want: ['crack'],         hold: 2, name: 'ТАВРО (хвиля)' },
  { id: 'claws',  melee: 1, want: ['cut'],           hold: 0, name: 'ПЛАЗМОВІ КІГТІ' },
  { id: 'chrono', melee: 1, want: ['phant', 'rip'],  hold: 0, name: 'ХРОНОРІЗ', foe: 1 }
];

console.log('ПОЧЕРК ЗБРОЇ\n');
for (const c of CASES) {
  const r = await page.evaluate(async (c) => {
    const D = window.__DEV, P = D.P;
    D.Game.startLevel(0, false); D.god(true);
    D.equip(c.melee ? c.id : 'arc', c.melee ? 'rail' : c.id);
    for (let i = 0; i < 3; i++) D.step();
    P.x = 60; P.y = 13 * D.TS - P.h; P.vy = 0; P.face = c.face || 1; P.cores = 3; P.shells = 6;
    P.heat = 0; P.fireCd = 0; P.chronoCd = 0; P.droneCd = 0;
    D.kb.l = D.kb.r = D.kb.a = D.kb.b = D.kb.c = 0;
    let foe = null;
    if (c.foe || c.drones || c.pix || c.trail) {
      foe = D.spawnEnemy('thug', P.x + (c.foe ? 26 : 90), 192, false);
      if (foe) { foe.blind = 1; foe.sp = 0; foe.st = 'idle'; foe.hp = foe.maxHp = 1e6; }
    }
    const key = c.melee ? 'b' : 'c';
    const kinds = new Set();
    let maxTr = 0, maxPix = 0, bounced = 0, drones = 0, sprites = 0;
    const base = D.Gfx.entCount ? 0 : 0;
    for (let f = 0; f < 200; f++) {
      // hold 1 — тримаємо кнопку (заряд рейкострила / хвиля Тавра)
      D.kb[key] = (c.hold ? (f < 70) : (f % 30 === 0)) ? 1 : 0;
      if (c.face) P.face = c.face;
      if (c.hold === 1 && f === 70) D.kb[key] = 0;
      D.step();
      D.render();
      sprites = Math.max(sprites, D.Gfx.entCount());
      for (const k of D.wfxKinds()) kinds.add(k);
      for (const b of D.BULL) {
        if (b.tr) maxTr = Math.max(maxTr, b.tr.length);
        if (b.pix) maxPix = Math.max(maxPix, b.pix.length);
        if (b.bounce !== undefined && b.bounce < 5) bounced = 1;
      }
      drones = Math.max(drones, D.DRONES.length);
    }
    D.kb[key] = 0;
    return { kinds: [...kinds], maxTr, maxPix, bounced, drones, sprites };
  }, c);
  const got = c.want.filter(w => r.kinds.indexOf(w) >= 0);
  if (c.want.length)
    ok(got.length === c.want.length, c.name + ': ефекти ' + c.want.join('+'),
       'знайдено ' + (got.join('+') || '—'));
  if (c.trail) ok(r.maxTr >= 6, c.name + ': куля лишає вигнутий трасер', 'точок ' + r.maxTr / 2);
  if (c.pix) ok(r.maxPix >= 5, c.name + ': постріл летить розсипом пікселів', r.maxPix + ' шт.');
  if (c.bounce) ok(r.bounced === 1, c.name + ': промінь реально відбивається й ділиться');
  if (c.drones) ok(r.drones === 3, c.name + ': три дрони існують постійно', r.drones + ' шт.');
  ok(r.sprites > 20, c.name + ': кадр малюється', r.sprites + ' спрайтів');
}

// Хроноріз: знебарвлення на телепорті й синє сповільнення
const chr = await page.evaluate(() => {
  const D = window.__DEV, P = D.P;
  D.Game.startLevel(0, false); D.god(true);
  D.equip('chrono', 'rail');
  for (let i = 0; i < 3; i++) D.step();
  P.x = 60; P.y = 13 * D.TS - P.h; P.vy = 0; P.face = 1;
  let desat = 0, slow = 0;
  for (let k = 0; k < 6; k++) {
    const e = D.spawnEnemy('thug', P.x + D.TS * 1.6, 13 * D.TS - 20, false);
    if (e) { e.blind = 1; e.sp = 0; e.hp = e.maxHp = 1e6; }
    P.chronoCd = 0;
    D.kb.b = 1; D.step(); D.kb.b = 0;
    for (let f = 0; f < 8; f++) { D.step(); desat = Math.max(desat, D.getDesat()); slow = Math.max(slow, D.getSlow()); }
  }
  return { desat, slow };
});
ok(chr.desat > 0.2, 'ХРОНОРІЗ: кадр знебарвлюється на телепорті', chr.desat.toFixed(2));
ok(chr.slow > 0, 'ХРОНОРІЗ: п\'яте влучання вмикає сповільнення', chr.slow.toFixed(2) + ' с');

ok(errors.length === 0, 'без помилок JS' + (errors.length ? ': ' + errors[0] : ''));
console.log('\n' + (fails === 0 ? 'ПОЧЕРК ЗБРОЇ: УСЕ ЧИСТО' : 'ПОЧЕРК ЗБРОЇ: ПРОБЛЕМ ' + fails));
await browser.close();
process.exit(fails === 0 ? 0 : 1);
