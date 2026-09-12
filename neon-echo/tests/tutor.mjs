/**
 * Навчання й тренувальна кімната.
 *
 * Скарга була однакова на обидва: «незрозуміло, що від тебе хочуть».
 * Тому тут перевіряється не «щось з'явилось», а що на екрані в кожен
 * момент ВИДНО: який це крок із дев'яти, що саме треба зробити, і яку
 * кнопку тиснути. Плюс що ніхто не застрягне: після п'яти невдач є
 * пропуск, у будь-який момент є вихід.
 *   node tests/tutor.mjs
 */
let pw;
try { pw = await import('playwright'); }
catch (e) { pw = await import('/opt/node22/lib/node_modules/playwright/index.js'); }
const chromium = pw.chromium || pw.default.chromium;
const file = process.env.URL || 'http://localhost:4173/';

let fails = 0;
const ok = (c, m, extra) => {
  if (!c) { fails++; console.log('  ✗ ' + m + (extra ? '  → ' + extra : '')); }
  else console.log('  ✓ ' + m + (extra ? '  (' + extra + ')' : ''));
};

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 900, height: 405 }, hasTouch: true });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(file);
await page.waitForFunction(() => !!window.__DEV);

console.log('ПЕРШИЙ ЗАПУСК\n');
await page.click('#mPlay');
await page.waitForTimeout(350);
ok(await page.isVisible('#tutask'), 'перший запуск питає про навчання');
await page.click('#tuNo');
await page.waitForTimeout(450);
ok(await page.evaluate(() => window.__DEV.Game.state === 'play' && !window.__DEV.Tut.active),
   '«Ні, я знаю платформери» одразу запускає гру');

console.log('\nКРОК N З 9: ВИДНО, ЩО РОБИТИ');
await page.evaluate(() => window.__DEV.Game.startTutorial());
await page.waitForTimeout(600);
ok(await page.isVisible('#tutBar'), 'смуга навчання на екрані');

const bar = () => page.evaluate(() => ({
  no: document.getElementById('tbNo').textContent,
  task: document.getElementById('tbTask').textContent,
  pulse: [...document.querySelectorAll('.tutWant')].map(e => e.id),
  skip: !document.getElementById('tbSkip').hidden,
  quit: !document.getElementById('tbQuit').hidden,
  repeat: !document.getElementById('tbRepeat').hidden
}));
const b1 = await bar();
ok(/КРОК 1 З 9/.test(b1.no), 'видно номер кроку й скільки всього', b1.no);
ok(b1.task.length > 3, 'видно завдання одним реченням', '«' + b1.task + '»');
ok(b1.pulse.length === 1, 'пульсує рівно одна потрібна кнопка', b1.pulse.join(','));
ok(b1.quit && b1.repeat, 'вихід і «Повторити» доступні завжди');
ok(!b1.skip, 'пропуск спершу схований — його треба заслужити невдачами');

// проходимо кроки й дивимось, що лічильник і підсвітка йдуть за ними
console.log('\n  крок  завдання                                кнопка');
const seen = [];
for (let n = 1; n <= 4; n++) {
  const b = await bar();
  seen.push(b);
  console.log('  ' + String(n).padEnd(6) + b.task.slice(0, 38).padEnd(40) + (b.pulse[0] || '—'));
  // виконуємо поточний крок напряму
  await page.evaluate(() => {
    const D = window.__DEV, T = D.Tut;
    const id = T.st.step && T.st.step.id;
    if (id === 'move') { D.kb.r = 1; for (let i = 0; i < 200; i++) D.step(); D.kb.r = 0; }
    else if (id === 'jump') {
      // Тиснемо A кілька разів: після попереднього кроку героїня може
      // бути ще в повітрі, і один тап пішов би в порожнечу.
      for (let k = 0; k < 4 && !T.st.done.jumped; k++) {
        D.kb.a = 1; D.step(); D.kb.a = 0;
        for (let i = 0; i < 30; i++) D.step();
      }
    }
    else { T.note(T.st.step.need === 'hitMelee' ? 'hitMelee'
                : T.st.step.need === 'dashed' ? 'dashed'
                : T.st.step.need === 'shot' ? 'shot' : 'cooled');
           for (let i = 0; i < 5; i++) D.step(); }
  });
  await page.waitForTimeout(200);
}
ok(new Set(seen.map(s => s.no)).size === seen.length,
   'номер кроку росте, а не стоїть на місці', seen.map(s => s.no.replace('КРОК ', '').replace(' З 9', '')).join(' → '));
ok(seen.every(s => s.pulse.length === 1), 'на кожному кроці підсвічена рівно одна кнопка');

console.log('\nНІХТО НЕ ЗАСТРЯГНЕ');
const sk = await page.evaluate(() => {
  const D = window.__DEV;
  const before = document.getElementById('tbSkip').hidden;
  for (let i = 0; i < 5; i++) D.Tut.fail();
  return { before, after: document.getElementById('tbSkip').hidden, tries: D.Tut.st.tries };
});
ok(sk.before && !sk.after, 'після п`яти невдач з`являється «Пропустити цей крок»', sk.tries + ' спроб');
const jumped = await page.evaluate(async () => {
  const no = () => document.getElementById('tbNo').textContent;
  const was = no();
  document.getElementById('tbSkip').click();
  await new Promise(r => setTimeout(r, 200));
  return { was, now: no() };
});
ok(jumped.was !== jumped.now, 'пропуск справді веде далі', jumped.was + ' → ' + jumped.now);

const rep = await page.evaluate(async () => {
  const D = window.__DEV;
  const was = D.Tut.st.i;
  D.Tut.fail(); D.Tut.fail();
  const tries = D.Tut.st.tries;
  document.getElementById('tbRepeat').click();
  await new Promise(r => setTimeout(r, 200));
  return { was, now: D.Tut.st.i, triesBefore: tries, triesAfter: D.Tut.st.tries };
});
ok(rep.was === rep.now && rep.triesAfter === 0,
   '«Повторити» перезапускає той самий крок і чистить лічильник спроб',
   'спроб ' + rep.triesBefore + ' → ' + rep.triesAfter);

const quit = await page.evaluate(async () => {
  document.getElementById('tbQuit').click();
  await new Promise(r => setTimeout(r, 300));
  return { on: window.__DEV.Tut.active, bar: document.getElementById('tutBar').hidden };
});
ok(!quit.on && quit.bar, 'вихід із навчання — одним тапом');

console.log('\nПІСЛЯ НАВЧАННЯ — ВИБІР');
const fin = await page.evaluate(async () => {
  const D = window.__DEV;
  D.Game.startTutorial();
  await new Promise(r => setTimeout(r, 300));
  // проганяємо всі кроки пропуском
  for (let i = 0; i < 12 && D.Tut.active; i++) D.Tut.skip();
  await new Promise(r => setTimeout(r, 300));
  return { done: D.Store.data.tutDone,
           screen: document.getElementById('tutdone').classList.contains('on'),
           btns: [!!document.getElementById('tdRange'), !!document.getElementById('tdPlay')] };
});
ok(fin.screen, 'наприкінці показується екран вибору');
ok(fin.btns[0] && fin.btns[1], 'обидві кнопки: тренувальна кімната й почати гру');
ok(fin.done === 1, 'навчання позначене як пройдене');

console.log('\nТРЕНУВАЛЬНА КІМНАТА: ЧОТИРИ ЗОНИ');
const owned0 = await page.evaluate(() => {
  window.__DEV.Game.toMenu();
  return window.__DEV.Store.data.owned.slice();
});
await page.evaluate(() => window.__DEV.Game.startRange('menu'));
await page.waitForTimeout(500);
const room = await page.evaluate(() => {
  const D = window.__DEV;
  const map = D.rangeMap();
  return {
    zones: D.RANGE_ZONES.map(z => z.id),
    signs: D.RANGE_ZONES.every(z => z.name && z.hint && z.hint.length > 20),
    targets: D.ENEM.filter(e => e.dummy === 'target').map(e => e.infinite ? '∞' : e.maxHp),
    turret: D.ENEM.filter(e => e.dummy === 'parry').length,
    gaps: map.marks.gaps.map(g => g.n),
    walls: map.marks.walls.map(w => w.h),
    weapons: D.Store.data.owned.length, all: Object.keys(D.WEAPONS).length,
    god: D.rangeState().god,
    bar: !document.getElementById('rangeBar').hidden
  };
});
ok(room.zones.length === 4, 'чотири зони на одній карті', room.zones.join(', '));
ok(room.signs, 'над кожною зоною вивіска з одним реченням');
ok(room.targets.length === 3 && room.targets.includes(50) && room.targets.includes(100) && room.targets.includes('∞'),
   'зона шкоди: 50 / 100 / нескінченний', room.targets.join(' / '));
ok(room.turret === 1, 'зона парирування: манекен-турель');
ok(String(room.gaps) === '3,4,5,6', 'зона платформінгу: прірви 3/4/5/6 тайлів', room.gaps.join('/'));
ok(String(room.walls) === '1,2,3,4', 'і стіни 1/2/3/4 тайли', room.walls.join('/'));
ok(room.weapons === room.all, 'уся зброя розблокована', room.weapons + ' з ' + room.all);
ok(room.god === 1, 'безсмертя увімкнене за замовчуванням');
ok(room.bar, 'кнопки «Панель» і «Вийти» на екрані завжди');

console.log('\n  ЛІЧИЛЬНИКИ НАД МАНЕКЕНАМИ');
const cnt = await page.evaluate(() => {
  const D = window.__DEV;
  const t = D.ENEM.find(e => e.dummy === 'target' && e.maxHp === 100);
  D.damageEnemy(t, 30, 0, { melee: true });
  for (let i = 0; i < 20; i++) D.step();
  D.damageEnemy(t, 20, 0, { melee: true });
  for (let i = 0; i < 20; i++) D.step();
  const st = D.rangeStats(t);
  return { last: st.last, dps: +st.dps.toFixed(1), ttk: +st.ttk.toFixed(1), hp: t.hp, max: t.maxHp };
});
ok(cnt.last === 20, 'остання шкода', String(cnt.last));
ok(cnt.dps > 0, 'DPS за вікном', String(cnt.dps));
ok(cnt.ttk > 0, 'час до вбивства', cnt.ttk + ' с');

const surv = await page.evaluate(() => {
  const D = window.__DEV;
  const t = D.ENEM.find(e => e.dummy === 'target' && e.maxHp === 50);
  D.damageEnemy(t, 99999, 0, { melee: true });
  for (let i = 0; i < 10; i++) D.step();
  const alive = D.ENEM.filter(e => e.dummy === 'target').length;
  for (let i = 0; i < 90; i++) D.step();
  return { alive, hp: t.hp, max: t.maxHp };
});
ok(surv.alive === 3, 'манекен не гине навіть від найсильнішого удару');
ok(surv.hp === surv.max, 'і відновлюється сам', surv.hp + '/' + surv.max);

console.log('\n  ПАНЕЛЬ І ВИХІД');
const panel = await page.evaluate(async () => {
  const D = window.__DEV;
  D.Game.rangeSetParry(2);
  const fast = D.rangeState().parrySpeed;
  D.Game.rangeSetGod(false);
  const god0 = D.rangeState().god;
  D.Game.rangeSetGod(true);
  D.Game.rangeCallBoss('chrono', 3);
  for (let i = 0; i < 60; i++) D.step();
  return { fast, god0, boss: D.BOSS.type, phase: D.BOSS.phase, on: D.BOSS.on };
});
ok(panel.fast === 2, 'швидкість куль турелі перемикається');
ok(panel.god0 === 0, 'безсмертя вимикається');
ok(panel.on && panel.boss === 'chrono' && panel.phase === 3,
   'бос викликається одразу в потрібній фазі', panel.boss + ' фаза ' + panel.phase);

const pit = await page.evaluate(() => {
  const D = window.__DEV, P = D.P;
  const map = D.rangeMap(), g = map.marks.gaps[3];       // найширша прірва
  P.x = (g.x0 + 1) * D.TS; P.y = 13 * D.TS - P.h; P.vx = 0; P.vy = 0; P.onGround = false;
  for (let i = 0; i < 200; i++) D.step();
  return { x: Math.round(P.x / D.TS), hp: P.hp, gap: g.x0 };
});
ok(pit.x < pit.gap && pit.x > pit.gap - 6,
   'падіння в прірву ставить на край поруч, а не відкидає на початок',
   'тайл ' + pit.x + ' при прірві на ' + pit.gap);

const out = await page.evaluate(async () => {
  const D = window.__DEV;
  D.Game.leaveRange();
  await new Promise(r => setTimeout(r, 300));
  return { on: D.rangeState().on, owned: D.Store.data.owned.slice(),
           bar: document.getElementById('rangeBar').hidden };
});
ok(!out.on && out.bar, 'вихід гасить кімнату');
ok(out.owned.length === owned0.length && out.owned.every(w => owned0.includes(w)),
   'арсенал повернувся без змін — прогрес не зачеплено', out.owned.join(','));

ok(errs.length === 0, 'без помилок JS' + (errs.length ? ': ' + errs[0] : ''));
console.log('\n' + (fails === 0 ? 'НАВЧАННЯ Й КІМНАТА: УСЕ ЧИСТО' : 'НАВЧАННЯ Й КІМНАТА: ПРОБЛЕМ ' + fails));
await browser.close();
process.exit(fails === 0 ? 0 : 1);
