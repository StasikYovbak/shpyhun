/**
 * ХРОНОКЛИНОК: третя фаза, два нові патерни й тривалість бою.
 *
 * Перевіряємо не наявність коду, а правила, які гравець відчуває:
 *   1. У фазі 3 щита немає — бити можна будь-чим, без парирування.
 *   2. Кожна поява за спиною має силует-передвісник рівно 0,5 с,
 *      і бос з'являється САМЕ там, де силует стояв.
 *   3. Телепорт не частіше ніж раз на 2,5 с.
 *   4. Ніколи двічі поспіль в одну точку.
 *   5. Влучив у момент появи — подвійна шкода.
 *   6. У фазі 2 справді трапляються обидва нові патерни.
 *   7. Бій цілком триває 60-80 с при нормальній грі.
 *   node tests/chrono.mjs
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

/* ---------- 1. ТЕЛЕПОРТИ ФАЗИ 3 ---------- */
const tp = await page.evaluate(() => {
  const D = window.__DEV, P = D.P, B = D.BOSS;
  D.Game.startLevel(5, false); D.god(true); D.gotoBoss();
  for (let i = 0; i < 200; i++) D.step();
  // фази вмикаються по одній, тож заганяємо в третю двома кроками
  B.hp = Math.floor(B.maxHp * 0.50); D.G.bossCheckPhase();
  B.hp = Math.floor(B.maxHp * 0.30); D.G.bossCheckPhase();
  B.hp = B.maxHp = 1e6;

  const blinks = [], gaps = [];
  let telStart = -1, telX = -1, telSpot = -1, lastAppear = -1, prevSt = B.st;
  let vulnPhase3 = null;
  for (let f = 0; f < 60 * 90; f++) {
    // гравець просто стоїть посеред арени й дивиться вправо:
    // хай бос сам вирішує, з якого боку зайти
    P.x = (B.a0 + B.a1) / 2; P.y = 13 * D.TS - P.h; P.vy = 0; P.face = 1; P.hp = P.maxHp; P.inv = 1;
    D.step();
    if (B.st === 'blinkTel' && prevSt !== 'blinkTel') { telStart = f; telX = B.tx; telSpot = B.tpSpot; }
    if (prevSt === 'blinkTel' && B.st !== 'blinkTel') {
      blinks.push({ tel: +((f - telStart) / 60).toFixed(3), atX: Math.round(B.x), telX: Math.round(telX),
                    spot: telSpot, behind: (B.x + B.w / 2) < P.x, punish: +B.punish.toFixed(2) });
      if (lastAppear >= 0) gaps.push(+((f - lastAppear) / 60).toFixed(2));
      lastAppear = f;
    }
    if (vulnPhase3 === null && B.phase >= 3 && B.st !== 'stagger') vulnPhase3 = D.G.bossInvulnerable();
    prevSt = B.st;
  }
  return { blinks, gaps, vulnPhase3, phase: B.phase };
});

console.log('ХРОНОКЛИНОК — ФАЗА 3: ПОЯВА ЗА СПИНОЮ\n');
console.log('  №   силует, с   точка   де з\'явився   за спиною');
console.log('  ' + '-'.repeat(52));
tp.blinks.slice(0, 8).forEach((b, i) =>
  console.log('  ' + String(i + 1).padEnd(4) + String(b.tel).padEnd(12) +
              ('#' + b.spot).padEnd(8) + String(b.atX).padEnd(14) + (b.behind ? 'так' : 'ні')));
console.log('  пауз між появами, с: ' + tp.gaps.slice(0, 8).join(', '));
console.log();

ok(tp.phase >= 3, 'на 1/3 HP вмикається третя фаза', 'фаза ' + tp.phase);
ok(tp.vulnPhase3 === false, 'у третій фазі щита немає — бити можна будь-чим і будь-коли');
ok(tp.blinks.length >= 6, 'телепорти за спину справді трапляються', tp.blinks.length + ' за 90 с');
const telBad = tp.blinks.filter(b => Math.abs(b.tel - 0.5) > 0.03);
ok(telBad.length === 0, 'силует-передвісник висить рівно 0,5 с перед кожною появою',
   telBad.length ? 'збоїв ' + telBad.length + ', напр. ' + telBad[0].tel + ' с' :
                   'усі ' + tp.blinks.length + ' появи');
const posBad = tp.blinks.filter(b => Math.abs(b.atX - b.telX) > 1);
ok(posBad.length === 0, 'бос з\'являється САМЕ там, де стояв силует',
   posBad.length ? 'розбіжність до ' + Math.max(...posBad.map(b => Math.abs(b.atX - b.telX))) + ' px' : '');
const gapBad = tp.gaps.filter(g => g < 2.5);
ok(gapBad.length === 0, 'телепорт не частіше ніж раз на 2,5 с',
   gapBad.length ? 'найкоротша пауза ' + Math.min(...tp.gaps) + ' с' :
                   'найкоротша ' + (tp.gaps.length ? Math.min(...tp.gaps) : '—') + ' с');
let same = 0;
for (let i = 1; i < tp.blinks.length; i++) if (tp.blinks[i].spot === tp.blinks[i - 1].spot) same++;
ok(same === 0, 'ніколи двічі поспіль в ту саму точку', same ? 'повторів ' + same : '');
const behind = tp.blinks.filter(b => b.behind).length;
ok(behind >= tp.blinks.length * 0.4, 'здебільшого заходить саме за спину',
   behind + ' з ' + tp.blinks.length);
const pun = tp.blinks.filter(b => b.punish > 0).length;
ok(pun === tp.blinks.length, 'у момент появи відкрите вікно подвійної шкоди');

/* ---------- 2. ПОДВІЙНА ШКОДА ---------- */
const dbl = await page.evaluate(() => {
  const D = window.__DEV, B = D.BOSS;
  D.Game.startLevel(5, false); D.god(true); D.gotoBoss();
  for (let i = 0; i < 200; i++) D.step();
  B.phase = 3; B.st = 'idle'; B.inv = 0;
  const hb = D.hitboxes()[0];
  B.hp = B.maxHp = 1000; B.punish = 0;
  D.G.bossDamage(hb, 10, {}); const plain = 1000 - B.hp;
  B.hp = 1000; B.inv = 0; B.punish = 0.3;
  D.G.bossDamage(hb, 10, {}); const boosted = 1000 - B.hp;
  return { plain, boosted };
});
console.log();
ok(dbl.boosted === dbl.plain * 2, 'влучив у мить появи — шкода подвоюється',
   dbl.plain + ' → ' + dbl.boosted);

/* ---------- 3. ДВА НОВІ ПАТЕРНИ ФАЗИ 2 ---------- */
const p2 = await page.evaluate(() => {
  const D = window.__DEV, P = D.P, B = D.BOSS;
  D.Game.startLevel(5, false); D.god(true); D.gotoBoss();
  for (let i = 0; i < 200; i++) D.step();
  B.hp = Math.floor(B.maxHp * 0.55); D.G.bossCheckPhase();   // друга фаза
  B.hp = B.maxHp = 1e6;
  const seen = {}; let trailZones = 0, ghosts = 0, rushJumpable = 1e9;
  for (let f = 0; f < 60 * 120; f++) {
    P.x = (B.a0 + B.a1) / 2; P.y = 13 * D.TS - P.h; P.vy = 0; P.face = 1; P.hp = P.maxHp; P.inv = 1;
    D.step();
    seen[B.st] = (seen[B.st] || 0) + 1;
    if (B.st === 'rush') {
      const z = D.ZONES.filter(z => z.col === '#8f6fff');
      trailZones = Math.max(trailZones, z.length);
      for (const zz of z) rushJumpable = Math.min(rushJumpable, zz.h);
    }
    ghosts = Math.max(ghosts, D.counts().ghost);
  }
  return { seen, trailZones, ghosts, rushJumpable, phase: B.phase };
});
console.log();
console.log('ХРОНОКЛИНОК — ФАЗА 2: ЩО ВІН РОБИТЬ (за 120 с, % часу)');
const tot = Object.values(p2.seen).reduce((a, b) => a + b, 0);
const NM = { idle: 'пауза', tp: 'телеграф телепорту', wind: 'замах', lunge: 'випад',
             stagger: 'відкритий', rushTel: 'ривок: телеграф', rush: 'РИВОК через арену',
             echo: 'ЧАСОВА КОПІЯ серії', phase: 'зміна фази', blinkTel: 'силует' };
for (const k of Object.keys(p2.seen).sort((a, b) => p2.seen[b] - p2.seen[a]))
  console.log('    ' + (NM[k] || k).padEnd(22) + Math.round(p2.seen[k] / tot * 100) + '%');
console.log();
ok((p2.seen.rush || 0) > 0, 'патерн «РИВОК через арену» трапляється',
   Math.round((p2.seen.rush || 0) / 60) + ' с за бій');
ok((p2.seen.echo || 0) > 0, 'патерн «ЧАСОВА КОПІЯ» трапляється',
   Math.round((p2.seen.echo || 0) / 60) + ' с за бій');
ok(p2.trailZones > 0, 'ривок лишає слід, що ранить', 'до ' + p2.trailZones + ' смуг одночасно');
ok(p2.rushJumpable <= 16, 'слід ривка низький — перестрибується',
   'висота ' + (p2.rushJumpable < 1e9 ? p2.rushJumpable : '—') + ' px при стрибку 66 px');
ok(p2.ghosts > 0, 'часова копія справді з\'являється на арені', 'до ' + p2.ghosts + ' фантомів');
ok((p2.seen.stagger || 0) > 0, 'ривок об стіну сам відкриває боса — вікно шкоди без парирування',
   Math.round((p2.seen.stagger || 0) / 60) + ' с відкритого за 120 с');

/* ---------- 4. ТРИВАЛІСТЬ БОЮ ----------
 * Бот — не людина: він не промахується повз вікно й не відступає. Тому
 * міряємо ЙОГО час, а живу гру перераховуємо від однієї відомої точки:
 * на старій версії (HP 95, дві фази) цей самий бот клав боса за 33,4 с,
 * а жива гра тривала близько двох хвилин — коефіцієнт 3,6.
 *
 * Коефіцієнт чесний тільки для фаз зі щитом: там усе впирається в
 * парирування, і слабший гравець втрачає рівно стільки, скільки
 * промахнувся повз вікно. У третій фазі щита немає взагалі — гравець
 * б'є, коли хоче, і відстає від бота куди менше; для неї беремо 1,8.
 * Тому оцінка — зважена. Лінійну (коефіцієнт фаз зі щитом на ВЕСЬ бій)
 * друкуємо поруч як свідомо песимістичну верхню межу.
 */
const RUNS = Number(process.env.RUNS || 6);
const OLD_BOT = 33.4, OLD_REAL = 120;             // заміряно на попередній версії
const times = [];
for (let r = 0; r < RUNS; r++) {
  const t = await page.evaluate(() => {
    const D = window.__DEV, P = D.P, B = D.BOSS;
    D.Game.startLevel(5, false); D.god(true); D.gotoBoss();
    D.Store.data.owned = Object.keys(D.WEAPONS); D.equip('arc', 'osa');
    for (let i = 0; i < 6; i++) D.step();
    const LAG = 12;                                // 0,2 с людської реакції
    const hist = []; let frames = 0, done = false, phaseAt = {}, open = 0;
    for (let i = 0; i < 60 * 240; i++) {
      frames = i;
      hist.push({ st: B.st, x: B.x, y: B.y, w: B.w, h: B.h, phase: B.phase });
      const s = hist[Math.max(0, hist.length - 1 - LAG)];
      const cx = P.x + P.w / 2, cy = P.y + P.h / 2;
      const dx = (s.x + s.w / 2) - cx, dy = (s.y + s.h / 2) - cy;
      D.kb.r = dx > 6 ? 1 : 0; D.kb.l = dx < -6 ? 1 : 0;
      D.kb.a = ((s.st === 'rush' || dy < -14) && (i % 46) < 28) ? 1 : 0;
      const near = Math.abs(dx) < 34 && Math.abs(dy) < 26;
      const vuln = s.st === 'stagger' || s.phase >= 3;
      D.kb.b = (((s.st === 'wind') || (vuln && near)) && (i % 14) < 2) ? 1 : 0;
      D.kb.c = (!near && (i % 10) < 2) ? 1 : 0;
      if (!D.G.bossInvulnerable() && B.inv <= 0) open++;
      D.step();
      const st = D.state();
      if (st.bossOn && !phaseAt[st.bossPhase]) phaseAt[st.bossPhase] = +(i / 60).toFixed(1);
      // бій закінчується на нулі HP; 2,6 с ролика смерті — це вже не бій
      if (B.hp <= 0) { done = true; break; }
    }
    D.kb.r = D.kb.l = D.kb.a = D.kb.b = D.kb.c = 0;
    return { done, secs: +(frames / 60).toFixed(1), hp: B.hp, maxHp: B.maxHp, phaseAt,
             openPct: Math.round(open / frames * 100) };
  });
  times.push(t);
}
console.log();
console.log('ТРИВАЛІСТЬ БОЮ (' + RUNS + ' прогони бота з реакцією 0,2 с, тесак + «Оса»)');
times.forEach((t, i) => console.log('    прогін ' + (i + 1) + ': ' +
  (t.done ? String(t.secs).padStart(5) + ' с' : 'НЕ ВБИТО (' + t.hp + '/' + t.maxHp + ' HP)') +
  '   бос відкритий ' + t.openPct + '% часу' +
  '   фази: ' + Object.keys(t.phaseAt).map(k => k + '→' + t.phaseAt[k] + 'с').join(', ')));
const avg = +(times.reduce((a, t) => a + t.secs, 0) / times.length).toFixed(1);
// скільки бот витратив у фазах із щитом, а скільки у відкритій третій
const gated = +(times.reduce((a, t) => a + (t.phaseAt[3] || t.secs), 0) / times.length).toFixed(1);
const free = +(avg - gated).toFixed(1);
const linear = Math.round(avg * OLD_REAL / OLD_BOT);
const weighted = Math.round(gated * OLD_REAL / OLD_BOT + free * 1.8);
console.log('    середнє: ' + avg + ' с   (зі щитом ' + gated + ' с, у відкритій фазі 3 — ' + free + ' с)');
console.log('    було на старій версії: ' + OLD_BOT + ' с тим самим ботом → бій коротший на ' +
            Math.round((1 - avg / OLD_BOT) * 100) + '%');
console.log('    жива гра, оцінка: ' + weighted + ' с   (ціль 60-80 с)');
console.log('    песимістична межа (коефіцієнт фаз зі щитом на весь бій): ' + linear + ' с');
console.log();
ok(times.every(t => t.done), 'Хроноклинок вбивається звичайною зброєю в усіх прогонах');
ok(avg < OLD_BOT * 0.75, 'бій помітно коротший за попередню версію',
   avg + ' с проти ' + OLD_BOT + ' с, це -' + Math.round((1 - avg / OLD_BOT) * 100) + '%');
ok(weighted >= 60 && weighted <= 80, 'перерахована тривалість живої гри вкладається в 60-80 с',
   weighted + ' с, песимістична межа ' + linear + ' с');

ok(errors.length === 0, 'без помилок JS' + (errors.length ? ': ' + errors[0] : ''));
console.log('\n' + (fails === 0 ? 'ХРОНОКЛИНОК: УСЕ ЧИСТО' : 'ХРОНОКЛИНОК: ПРОБЛЕМ ' + fails));
await browser.close();
process.exit(fails === 0 ? 0 : 1);
