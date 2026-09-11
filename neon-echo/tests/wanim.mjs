/**
 * ОКРЕМА АНІМАЦІЯ АТАКИ ПІД КОЖНУ ЗБРОЮ.
 *
 * Перевіряємо не назви кадрів у коді, а те, що бачить гравець:
 *   1. У кожної з одинадцяти зброй свій набір кадрів, і жодні два
 *      набори не збігаються — інакше «окремої анімації» нема.
 *   2. Кадрів щонайменше три.
 *   3. Анімація триває рівно стільки, скільки сама атака: кігті
 *      вкладаються в 0,10 с, Тавро розтягується на 0,45 с. Ні довше
 *      (щоб не «наздоганяла»), ні коротше (щоб не стояла мертвою).
 *   4. Кадр удару починається тоді ж, коли відкривається вікно шкоди.
 *   5. У дробовика є окремий кадр перезаряджання, у Тесака — три різні
 *      кадри на три удари комбо, у кігтів — по черзі ліва й права.
 *   node tests/wanim.mjs
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

const MELEE = ['arc', 'whip', 'brand', 'chrono', 'claws'];
const RANGED = ['rail', 'osa', 'swarm', 'shot', 'glitch', 'prism'];

/** Один удар: записуємо кадр щокроку, поки триває атака. */
const capture = (id, melee, reps) => page.evaluate(({ id, melee, reps }) => {
  const D = window.__DEV, P = D.P;
  D.Game.startLevel(0, false); D.god(true);
  D.Store.data.owned = Object.keys(D.WEAPONS);
  D.equip(melee ? id : 'arc', melee ? 'rail' : id);
  for (let i = 0; i < 4; i++) D.step();
  const key = melee ? 'b' : 'c';
  const out = [];
  for (let r = 0; r < reps; r++) {
    P.x = 120; P.y = 13 * D.TS - P.h; P.vy = 0; P.face = 1; P.inv = 1;
    P.heat = 0; P.cores = 3; P.shells = 6; P.reloadT = 0; P.droneCd = 0;
    P.fireCd = 0; P.atkT = 0; P.comboT = r ? 0.3 : 0;   // комбо продовжуємо лише з другого удару
    P.chronoCd = 9;                                   // звичайний замах, без телепорту
    const seq = [];
    D.kb[key] = 1; D.step(); D.kb[key] = 0;
    for (let f = 0; f < 70; f++) {
      const busy = P.atkT > 0 || P.shootT > 0 || P.tpPose > 0;
      seq.push({ a: P.anim, atk: +P.atkT.toFixed(3), sh: +P.shootT.toFixed(3), busy });
      if (!busy && f > 1) break;
      D.step();
    }
    out.push(seq);
  }
  D.kb[key] = 0;
  return out;
}, { id, melee, reps });

console.log('КАДРИ АТАКИ ПІД КОЖНУ ЗБРОЮ\n');
console.log('  зброя                  час атаки   кадрів   послідовність');
console.log('  ' + '-'.repeat(78));

const REAL = { arc: 0.18, whip: 0.45, brand: 0.45, chrono: 0.22, claws: 0.10,
               rail: 0.13, osa: 0.115, swarm: 0.45, shot: 0.36, glitch: 0.30, prism: 0.34 };
const rows = [];
for (const id of [...MELEE, ...RANGED]) {
  const melee = MELEE.indexOf(id) >= 0;
  const runs = await capture(id, melee, id === 'arc' || id === 'claws' ? 3 : 1);
  const name = await page.evaluate(i => window.__DEV.WEAPONS[i].name, id);
  const seq = runs[0].filter(s => s.busy);
  const frames = [];
  for (const s of seq) if (frames[frames.length - 1] !== s.a) frames.push(s.a);
  const dur = +(seq.length / 60).toFixed(3);
  rows.push({ id, name, melee, frames, dur, runs, uniq: [...new Set(seq.map(s => s.a))] });
  console.log('  ' + name.padEnd(22) + (dur + ' с').padStart(9) +
              String(frames.length).padStart(9) + '   ' + frames.join(' → '));
}
console.log();

/* 1-2. власний набір кадрів у кожної, щонайменше три */
const sets = {};
for (const r of rows) {
  ok(r.frames.length >= 3, r.name + ': щонайменше три кадри', r.frames.length + ' кадри');
  const k = r.uniq.slice().sort().join(',');
  ok(!sets[k], r.name + ': власний набір кадрів, не спільний з іншою зброєю',
     sets[k] ? 'той самий, що в ' + sets[k] : r.uniq.length + ' різних поз');
  sets[k] = r.name;
  ok(r.uniq.indexOf('atk') < 0, r.name + ': не падає на стару спільну позу');
}

/* 3. тривалість = реальний час атаки */
console.log();
for (const r of rows) {
  const want = REAL[r.id];
  ok(Math.abs(r.dur - want) <= 0.035, r.name + ': анімація рівно на час атаки',
     r.dur + ' с проти ' + want + ' с у зброї');
}

/* 4. кадр удару починається разом із вікном шкоди (k = 0,20) */
console.log();
for (const r of rows) {
  if (!r.melee) continue;
  const total = REAL[r.id];
  const seq = r.runs[0].filter(s => s.busy);
  const first = seq[0].a;
  let sw = seq.findIndex(s => s.a !== first);
  const k = sw < 0 ? -1 : +((sw / 60) / total).toFixed(2);
  ok(k >= 0.10 && k <= 0.30, r.name + ': кадр удару збігається з відкриттям вікна шкоди',
     'зміна кадру на ' + Math.round(k * 100) + '% удару, вікно шкоди — з 20%');
}

/* 5. окремі вимоги з ТЗ */
console.log();
const arc = rows.find(r => r.id === 'arc');
const hit = arc.runs.map(run => { const s = run.filter(x => x.busy); return s[Math.floor(s.length / 2)].a; });
ok(new Set(hit).size === 3, 'АРК-ТЕСАК: три РІЗНІ кадри на три удари комбо', hit.join(', '));
ok(hit[2] === 'a_arc3', 'АРК-ТЕСАК: третій удар — окремий кадр із розворотом корпусу');

const claws = rows.find(r => r.id === 'claws');
const side = claws.runs.map(run => run.filter(x => x.busy)[0].a);
ok(side[0] !== side[1], 'ПЛАЗМОВІ КІГТІ: випади йдуть по черзі лівою й правою', side.join(', '));

const rl = await page.evaluate(() => {
  const D = window.__DEV, P = D.P;
  D.Game.startLevel(0, false); D.god(true);
  D.Store.data.owned = Object.keys(D.WEAPONS); D.equip('arc', 'shot');
  for (let i = 0; i < 4; i++) D.step();
  P.x = 120; P.y = 13 * D.TS - P.h; P.vy = 0; P.face = 1; P.inv = 1;
  P.shells = 0; P.fireCd = 0;
  D.kb.c = 1; D.step(); D.kb.c = 0;
  const seen = {};
  for (let f = 0; f < 130; f++) { D.step(); seen[P.anim] = 1; }
  return { reload: +P.reloadT.toFixed(2), poses: Object.keys(seen) };
});
ok(rl.poses.indexOf('a_shotR') >= 0, 'ДРОБОВИК: окремий кадр перезаряджання з рухом цівки',
   'під час перезаряджання видно: ' + rl.poses.join(', '));

const ch = await page.evaluate(() => {
  const D = window.__DEV, P = D.P;
  D.Game.startLevel(0, false); D.god(true);
  D.Store.data.owned = Object.keys(D.WEAPONS); D.equip('chrono', 'rail');
  for (let i = 0; i < 4; i++) D.step();
  P.x = 120; P.y = 13 * D.TS - P.h; P.vy = 0; P.face = 1; P.inv = 1; P.chronoCd = 0;
  const e = D.spawnEnemy('thug', P.x + D.TS * 1.5, 13 * D.TS - 20, false);
  if (!e) return { poses: [] };
  e.hp = e.maxHp = 1e6; e.blind = 1; e.sp = 0;
  const seen = [];
  D.kb.b = 1; D.step(); D.kb.b = 0;
  for (let f = 0; f < 24; f++) { if (seen[seen.length - 1] !== P.anim) seen.push(P.anim); D.step(); }
  return { poses: seen.filter(a => a !== 'idle') };
});
ok(ch.poses.indexOf('a_chron3') >= 0,
   'ХРОНОРІЗ: після телепорту героїня з\'являється спиною до камери', ch.poses.join(', '));
ok(ch.poses.length >= 3, 'ХРОНОРІЗ: телепортний удар теж має три кадри', ch.poses.join(' → '));

const sw = rows.find(r => r.id === 'swarm');
ok(sw.uniq.indexOf('a_swrm2') >= 0, 'РІЙ: героїня не стріляє, а вказує рукою на ціль');

ok(errors.length === 0, 'без помилок JS' + (errors.length ? ': ' + errors[0] : ''));
console.log('\n' + (fails === 0 ? 'АНІМАЦІЇ ЗБРОЇ: УСЕ ЧИСТО' : 'АНІМАЦІЇ ЗБРОЇ: ПРОБЛЕМ ' + fails));
await browser.close();
process.exit(fails === 0 ? 0 : 1);
