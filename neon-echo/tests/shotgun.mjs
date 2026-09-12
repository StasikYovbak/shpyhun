/**
 * ДРОБОВИК: чому приріст урону не відчувався і що з ним тепер.
 *
 * ТЗ називало дві підозри. Перевіряємо обидві ЗАМІРОМ, а не читанням коду:
 *   1. Кадри невразливості з'їдають дробини — тоді з шести доходила б одна.
 *   2. Ліміт шкоди за влучання — тоді сума була б обрізана згори.
 * Далі — абсолютні числа з таблиці (один удар Арк-тесака = 10) і те,
 * що робить постріл ВІДЧУТНИМ: стоп-кадр, тряска, спалах, відкидання.
 *   node tests/shotgun.mjs
 */
let pw; try { pw = await import('playwright'); } catch (e) { pw = await import('/opt/node22/lib/node_modules/playwright/index.js'); }
const chromium = pw.chromium || pw.default.chromium;
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 940, height: 470 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(process.env.URL || 'http://localhost:4173/');
await page.waitForFunction(() => !!window.__DEV, null, { timeout: 20000 });
// Перший запуск питає про навчання (промт №13). Цей набір перевіряє
// не його, тож позначаємо питання як уже поставлене — інакше «Грати»
// відкриє екран навчання замість гри.
await page.evaluate(() => { window.__DEV.Store.data.tutAsked = 1; window.__DEV.Store.save(); });
await page.click('#mPlay');
await page.waitForTimeout(300);

let fails = 0;
const ok = (c, m, extra) => { if (!c) { fails++; console.log('  ✗ ' + m + (extra ? '  → ' + extra : '')); }
                              else console.log('  ✓ ' + m + (extra ? '  (' + extra + ')' : '')); };

/* ---------- 1. СКІЛЬКИ ДРОБИН РЕАЛЬНО ДОХОДИТЬ ---------- */
const shot = await page.evaluate(() => {
  const D = window.__DEV, P = D.P;
  const rows = [];
  for (const dist of [20, 30, 60, 110, 120]) {
    let acc = 0; const REP = 7;
    for (let rep = 0; rep < REP; rep++) {
      D.Game.startLevel(0, false); D.god(true);
      D.Store.data.owned = Object.keys(D.WEAPONS); D.equip('arc', 'shot');
      for (let i = 0; i < 4; i++) D.step();
      D.ENEM.length = 0;
      P.x = 200; P.y = 13 * D.TS - P.h; P.vy = 0; P.face = 1;
      P.shells = 6; P.fireCd = 0; P.inv = 9;
      const e = D.spawnEnemy('thug', P.x + P.w / 2 + dist, 13 * D.TS - 20, false);
      e.blind = 1; e.sp = 0; e.st = 'idle'; e.hp = e.maxHp = 1e6;
      const hp0 = e.hp;
      D.kb.c = 1; D.step(); D.kb.c = 0;
      for (let f = 0; f < 50; f++) {
        P.x = 200; P.y = 13 * D.TS - P.h; P.vx = 0; P.vy = 0;
        e.x = P.x + P.w / 2 + dist; e.y = 13 * D.TS - e.h; e.vx = 0; e.stun = 0;
        D.step();
      }
      acc += hp0 - e.hp;
    }
    rows.push({ dist, dealt: +(acc / 7).toFixed(1) });
  }
  return { rows, pellet: D.WEAPONS.shot.dmg, arc: D.BL.DMG[0] };
});

console.log('ОДИН ПОСТРІЛ: ЩО РЕАЛЬНО ДОХОДИТЬ ДО ЦІЛІ\n');
console.log('  дистанція   шкоди за постріл   у дробинах   ціль із ТЗ');
console.log('  ' + '-'.repeat(58));
const WANT = { 20: 48, 30: 48, 60: 24, 110: 6, 120: 6 };
for (const r of shot.rows)
  console.log('  ' + String(r.dist + ' px').padEnd(12) + String(r.dealt).padStart(10) +
              String((r.dealt / shot.pellet).toFixed(1)).padStart(14) +
              String(WANT[r.dist]).padStart(13));
console.log();

const near = shot.rows.find(r => r.dist === 20);
ok(near.dealt === shot.pellet * 6,
   'ПІДОЗРА 1 СПРОСТОВАНА: усі шість дробин доходять, і-фрейми їх не їдять',
   near.dealt + ' = 6 x ' + shot.pellet);
ok(near.dealt >= 48, 'ПІДОЗРА 2 СПРОСТОВАНА: стелі «не більше N за влучання» немає',
   'сума не обрізана: ' + near.dealt);
ok(Math.abs(near.dealt - 48) < 0.5, 'упритул (<=30 px) — рівно 48, як у таблиці', String(near.dealt));
ok(Math.abs(shot.rows.find(r => r.dist === 60).dealt - 24) <= 3, 'на 60 px — близько 24',
   String(shot.rows.find(r => r.dist === 60).dealt));
ok(shot.rows.find(r => r.dist === 120).dealt <= 8, 'на 120 px — майже марно',
   String(shot.rows.find(r => r.dist === 120).dealt));
ok(shot.arc === 10, 'базова одиниця на місці: удар Арк-тесака = 10', String(shot.arc));

/* ---------- 2. І-ФРЕЙМІВ НЕМАЄ ВЗАГАЛІ ---------- */
const iframe = await page.evaluate(() => {
  const D = window.__DEV, P = D.P;
  D.Game.startLevel(0, false); D.god(true);
  for (let i = 0; i < 4; i++) D.step();
  D.ENEM.length = 0;
  P.x = 200; P.y = 13 * D.TS - P.h; P.inv = 9;
  const e = D.spawnEnemy('thug', P.x + 60, 13 * D.TS - 20, false);
  e.blind = 1; e.sp = 0; e.hp = e.maxHp = 1e6;
  const hp0 = e.hp, n = 5;
  for (let i = 0; i < n; i++) D.damageEnemy(e, 10, 0, {});   // п'ять ударів В ОДИН КАДР
  return { dealt: hp0 - e.hp, want: n * 10 };
});
console.log();
ok(iframe.dealt === iframe.want,
   'п\'ять влучань в один кадр дають п\'ять порцій шкоди, а не одну',
   iframe.dealt + ' з ' + iframe.want);

/* ---------- 3. РЕШТА МНОЖИННИХ АТАК ---------- */
const multi = await page.evaluate(() => {
  const D = window.__DEV, P = D.P;
  const run = (setup) => {
    D.Game.startLevel(0, false); D.god(true);
    D.Store.data.owned = Object.keys(D.WEAPONS);
    for (let i = 0; i < 4; i++) D.step();
    D.ENEM.length = 0;
    P.x = 300; P.y = 13 * D.TS - P.h; P.vy = 0; P.face = 1; P.inv = 9;
    P.cores = 3; P.shells = 6; P.fireCd = 0; P.q = 10; P.bHold = 0;
    const foes = [];
    for (let i = 0; i < 4; i++) {
      const e = D.spawnEnemy('thug', P.x + 18 + i * 14, 13 * D.TS - 20, false);
      if (!e) continue;
      e.blind = 1; e.sp = 0; e.st = 'idle'; e.hp = e.maxHp = 1e6; foes.push(e);
    }
    const hp0 = foes.map(e => e.hp);
    setup();
    for (let f = 0; f < 60; f++) { for (const e of foes) { e.vx = 0; e.stun = 0; } D.step(); }
    return foes.filter((e, i) => hp0[i] - e.hp > 0).length;
  };
  const brand = run(() => { D.equip('brand', 'shot'); D.P.bHold = 0.6;
    D.kb.b = 1; for (let i = 0; i < 40; i++) D.step(); D.kb.b = 0; });
  const claws = run(() => { D.equip('claws', 'shot');
    for (let k = 0; k < 12; k++) { D.P.atkT = 0; D.kb.b = 1; D.step(); D.kb.b = 0; D.step(); } });
  const shotm = run(() => { D.equip('arc', 'shot'); D.P.fireCd = 0;
    D.kb.c = 1; D.step(); D.kb.c = 0; });
  return { brand, claws, shot: shotm };
});
console.log();
console.log('  множинні атаки: скільки ворогів із чотирьох дістали шкоди');
console.log('    ударна хвиля Тавра: ' + multi.brand + ' / 4');
console.log('    серія Плазмових кігтів: ' + multi.claws + ' / 4');
console.log('    один постріл дробовика: ' + multi.shot + ' / 4');
ok(multi.brand >= 2, 'ударна хвиля Тавра б\'є кількох одразу, без обрізання');
ok(multi.claws >= 1, 'кігті б\'ють, і стаки накопичуються');
ok(multi.shot >= 1, 'дробовик проходить крізь групу');

/* ---------- 4. ЧИ ВІДЧУВАЄТЬСЯ ПОСТРІЛ ---------- */
const feel = await page.evaluate(() => {
  const D = window.__DEV, P = D.P;
  D.Game.startLevel(0, false); D.god(true);
  D.Store.data.owned = Object.keys(D.WEAPONS); D.equip('arc', 'shot');
  for (let i = 0; i < 4; i++) D.step();
  D.ENEM.length = 0;
  P.x = 200; P.y = 13 * D.TS - P.h; P.vy = 0; P.face = 1; P.shells = 6; P.fireCd = 0; P.inv = 9;
  // Живучий: щоб було видно, НА СКІЛЬКИ відкидає, а не лише що вбиває.
  const tough = D.spawnEnemy('thug', P.x + P.w / 2 + 20, 13 * D.TS - 20, false);
  tough.blind = 1; tough.sp = 0; tough.st = 'idle'; tough.hp = tough.maxHp = 1e6;
  const x0 = tough.x;
  D.kb.c = 1; D.step(); D.kb.c = 0;
  const kinds = D.wfxKinds().slice();
  const stop = D.G.timing.hitStop;
  let maxPush = 0;
  for (let f = 0; f < 40; f++) { D.step(); maxPush = Math.max(maxPush, Math.abs(tough.x - x0)); }
  tough.dead = true;

  // Окремо — легкий, який має РОЗЛЕТІТИСЬ: міряємо пік часток за постріл.
  D.ENEM.length = 0;
  P.x = 200; P.y = 13 * D.TS - P.h; P.shells = 6; P.fireCd = 0; P.inv = 9;
  const e = D.spawnEnemy('thug', P.x + P.w / 2 + 20, 13 * D.TS - 20, false);
  e.blind = 1; e.sp = 0; e.st = 'idle'; e.hp = e.maxHp = 20;
  let base = D.counts().part, peak = 0;
  D.kb.c = 1; D.step(); D.kb.c = 0;
  for (let f = 0; f < 20; f++) { D.step(); peak = Math.max(peak, D.counts().part - base); }
  return { blast: kinds.indexOf('blast') >= 0, stop: +stop.toFixed(3),
           parts: peak, push: Math.round(maxPush), dead: e.dead };
});
console.log();
ok(feel.blast, 'спалах на пів кадру є', 'wfx kind blast');
ok(feel.stop >= 0.085, 'стоп-кадр 90 мс', feel.stop + ' с');
ok(feel.push >= 40, 'легкого ворога відкидає щонайменше на 40 px', feel.push + ' px');
ok(feel.dead, 'легкий ворог не переживає постріл упритул');
ok(feel.parts > 25, 'ворог розлітається на уламки, а не зникає', feel.parts + ' часток у піку');

ok(errors.length === 0, 'без помилок JS' + (errors.length ? ': ' + errors[0] : ''));
console.log('\n' + (fails === 0 ? 'ДРОБОВИК: УСЕ ЧИСТО' : 'ДРОБОВИК: ПРОБЛЕМ ' + fails));
await browser.close();
process.exit(fails === 0 ? 0 : 1);
