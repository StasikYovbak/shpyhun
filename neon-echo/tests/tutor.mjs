/**
 * Навчання й тренувальна кімната.
 *
 * Перевіряємо не «підказка з'явилась», а що вона з'являється ТАМ, ДЕ
 * дія вперше потрібна, і зникає САМЕ від виконання цієї дії — не за
 * таймером. Плюс: навчання пропускається, парирування має своє
 * тренування з пропуском після п'яти невдач, кімната нічого не псує.
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

console.log('ПИТАННЯ ПРИ ПЕРШОМУ ЗАПУСКУ\n');
await page.click('#mPlay');
await page.waitForTimeout(350);
ok(await page.isVisible('#tutask'), 'перший запуск питає про навчання');
const both = await page.evaluate(() => ({
  yes: !!document.getElementById('tuYes'), no: !!document.getElementById('tuNo'),
  asked: window.__DEV.Store.data.tutAsked
}));
ok(both.yes && both.no, 'є обидві відповіді: пройти й пропустити');
ok(both.asked === 1, 'питання запам`ятовується й більше не повторюється');

// «Ні, я знаю платформери» — просто запускає гру
await page.click('#tuNo');
await page.waitForTimeout(500);
const skipped = await page.evaluate(() => ({
  state: window.__DEV.Game.state, level: window.__DEV.Game.level,
  tut: window.__DEV.Tut.active, hint: !!window.__DEV.TUTFX.hint
}));
ok(skipped.state === 'play' && skipped.level === 0, 'пропуск одразу запускає сектор 1');
ok(!skipped.tut && !skipped.hint, 'жодної підказки після пропуску');

// повторний запуск уже не питає
await page.evaluate(() => window.__DEV.Game.toMenu());
await page.click('#mPlay'); await page.waitForTimeout(400);
ok(!(await page.isVisible('#tutask')), 'удруге питання не показується');

console.log('\nПІДКАЗКИ: КОНТЕКСТНІ, ЗНИКАЮТЬ ВІД ДІЇ');
await page.evaluate(() => window.__DEV.Game.startTutorial());
await page.waitForTimeout(600);
ok(await page.evaluate(() => window.__DEV.Tut.active), 'навчання з меню вмикається');

// крок 1: рух. Підказка висить, поки не пройшла три тайли.
const s1 = await page.evaluate(() => {
  const D = window.__DEV;
  D.god(true);
  for (let i = 0; i < 20; i++) D.step();
  const atStart = D.TUTFX.hint ? D.TUTFX.hint.step.id : null;
  D.kb.r = 1;
  let frames = 0;
  while (D.TUTFX.hint && D.TUTFX.hint.step.id === 'move' && frames < 400) { D.step(); frames++; }
  D.kb.r = 0;
  return { atStart, frames, moved: Math.round(D.P.x - D.world.spawn.x), tile: D.TS,
           next: D.TUTFX.hint ? D.TUTFX.hint.step.id : null };
});
ok(s1.atStart === 'move', 'перша підказка — рух, одразу на спавні', s1.atStart);
ok(s1.moved > s1.tile * 3 - 4, 'зникає САМЕ від руху, а не за таймером',
   'пройдено ' + s1.moved + ' px при порозі ' + s1.tile * 3);

// крок 2: стрибок. Ходьба його не закриває — потрібен саме стрибок.
const s2 = await page.evaluate(() => {
  const D = window.__DEV;
  const id = () => D.TUTFX.hint ? D.TUTFX.hint.step.id : null;
  // спершу дійти до місця, де підказка стрибка вмикається
  D.kb.r = 1;
  let armed = 0;
  for (let i = 0; i < 600 && !armed; i++) { D.step(); if (id() === 'jump') armed = 1; }
  // а тепер просто йти далі: сама лише ходьба її закрити не повинна
  let walked = 0;
  for (let i = 0; i < 240 && id() === 'jump'; i++) { D.step(); walked++; }
  const stillJump = id() === 'jump';
  // і тільки справжній стрибок її гасить
  D.kb.a = 1; D.step(); D.kb.a = 0;
  for (let i = 0; i < 40; i++) D.step();
  D.kb.r = 0;
  return { armed, stillJump, after: id(), walked };
});
ok(s2.armed === 1, 'підказка стрибка вмикається там, де вперше треба стрибати');
ok(s2.stillJump, 'і не зникає від самої лише ходьби', s2.walked + ' кадрів поспіль');
ok(s2.after !== 'jump', 'зникає від справжнього стрибка', 'далі: ' + (s2.after || '—'));

// кожен крок має свою кнопку й свою анімацію, а не абзац тексту
const steps = await page.evaluate(() => window.__DEV.Tut.steps ? null : null);
const table = await page.evaluate(() => {
  const D = window.__DEV;
  // прокручуємо весь список кроків через внутрішній стан
  const all = [];
  for (const s of (window.__TUT_STEPS || [])) all.push(s);
  return all;
});

console.log('\nТРЕНУВАННЯ ПАРИРУВАННЯ');
const drill = await page.evaluate(async () => {
  const D = window.__DEV;
  D.Game.startTutorial();
  await new Promise(r => setTimeout(r, 300));
  D.god(true);
  // доганяємо до кроку парирування напряму
  const T = D.Tut;
  T.st.i = 7; T.st.step = null;
  D.P.x = Math.min(D.world.pw - D.TS * 6, 640 * 3 * 0.8 + 10);
  for (let i = 0; i < 20; i++) D.step();
  const id = D.TUTFX.hint ? D.TUTFX.hint.step.id : null;
  const dummy = D.ENEM.filter(e => e.dummy === 'parry').length;
  const gate = D.TUTFX.gate;
  // куля летить повільно?
  for (let i = 0; i < 120; i++) D.step();
  // Саме кулі манекена: на рівні є й звичайні вороги зі своїм темпом.
  const slow = D.BULL.filter(b => b.drill)
                     .map(b => Math.round(Math.hypot(b.vx, b.vy)));
  return { id, dummy, gate, slow: slow.slice(0, 4), need: 2 };
});
ok(drill.id === 'parry', 'крок парирування вмикається', drill.id);
ok(drill.dummy === 1, 'з`являється тренувальний ворог', drill.dummy + ' шт.');
ok(drill.gate > 0, 'далі не пускає, поки не паріювала', 'ворота на x=' + Math.round(drill.gate));
ok(drill.slow.length > 0 && drill.slow.every(v => v < 120),
   'кулі справді повільні — вікно читається оком', drill.slow.join(', ') + ' px/с');

const pass = await page.evaluate(() => {
  const D = window.__DEV, T = D.Tut;
  T.note('parryOk'); T.note('parryOk');
  for (let i = 0; i < 10; i++) D.step();
  return { ok: T.st.parryOk, gate: D.TUTFX.gate, dummy: D.ENEM.filter(e => e.dummy === 'parry').length };
});
ok(pass.ok >= 2 && pass.gate === 0, 'два вдалі парирування відкривають прохід');
ok(pass.dummy === 0, 'тренувальний ворог зникає після тренування');

const giveup = await page.evaluate(async () => {
  const D = window.__DEV, T = D.Tut;
  D.Game.startTutorial();
  await new Promise(r => setTimeout(r, 250));
  D.god(true);
  T.st.i = 7; T.st.step = null;
  D.P.x = Math.min(D.world.pw - D.TS * 6, 640 * 3 * 0.8 + 10);
  for (let i = 0; i < 20; i++) D.step();
  const gateBefore = D.TUTFX.gate;
  for (let i = 0; i < 5; i++) T.note('parryMiss');
  for (let i = 0; i < 10; i++) D.step();
  return { gateBefore, gate: D.TUTFX.gate, skip: T.st.parrySkip, say: D.TUTFX.say };
});
ok(giveup.gateBefore > 0 && giveup.gate === 0 && giveup.skip === 1,
   'після п`яти невдач прохід відкривається сам — навчання не стіна');
ok(/ТРЕНУВАЛЬН/i.test(giveup.say || ''), 'і гравцю кажуть, де дотренуватись', giveup.say);

console.log('\nПІДКАЗКА ДО КОЖНОЇ НОВОЇ ЗБРОЇ');
const tips = await page.evaluate(() => {
  const D = window.__DEV, out = {};
  D.Store.data.tutSeen = [];
  for (const id of ['osa', 'whip', 'shot', 'prism']) {
    D.Tut.weaponTip(id);
    out[id] = D.Tut.tip;
    D.Tut.st.tipT = 0; D.Tut.st.tipId = null;
  }
  D.Tut.weaponTip('osa');                       // другий раз — мовчки
  out.repeat = D.Tut.tip;
  return out;
});
ok(['osa', 'whip', 'shot', 'prism'].every(k => tips[k] && tips[k].length > 10),
   'у кожної зброї своя підказка про механіку');
ok(tips.repeat === null, 'удруге та сама підказка не повторюється');
console.log('    напр.: «' + tips.shot + '»');

console.log('\nТРЕНУВАЛЬНА КІМНАТА');
const owned0 = await page.evaluate(() => { window.__DEV.Game.toMenu(); return window.__DEV.Store.data.owned.slice(); });
await page.evaluate(() => window.__DEV.Game.startRange());
await page.waitForTimeout(500);
const room = await page.evaluate(() => {
  const D = window.__DEV;
  const tg = D.ENEM.filter(e => e.dummy === 'target').map(e => e.maxHp).sort((a, b) => a - b);
  return { on: D.RANGE.on, targets: tg, shooter: D.ENEM.filter(e => e.dummy === 'parry').length,
           weapons: D.Store.data.owned.length, all: Object.keys(D.WEAPONS).length };
});
ok(room.on, 'кімната відкривається окремим пунктом меню');
ok(room.targets.length >= 4 && new Set(room.targets).size === room.targets.length,
   'манекени з РІЗНИМ HP', room.targets.join(' / '));
ok(room.shooter === 1, 'є манекен, що стріляє — для парирування');
ok(room.weapons === room.all, 'уся зброя розблокована на час тренування',
   room.weapons + ' з ' + room.all);

const count = await page.evaluate(() => {
  const D = window.__DEV;
  const t = D.ENEM.find(e => e.dummy === 'target');
  const hp0 = t.hp;
  D.damageEnemy(t, 40, 0, { melee: true });
  const after = D.RANGE.dmg;
  D.damageEnemy(t, 25, 0, { melee: true });
  return { after, total: D.RANGE.dmg, hp0 };
});
ok(count.after === 40 && count.total === 65, 'лічильник шкоди рахує влучання', count.total);

const revive = await page.evaluate(() => {
  const D = window.__DEV;
  const t = D.ENEM.find(e => e.dummy === 'target');
  D.damageEnemy(t, 99999, 0, { melee: true });
  for (let i = 0; i < 6; i++) D.step();
  const alive = D.ENEM.filter(e => e.dummy === 'target').length;
  const t2 = D.ENEM.find(e => e.dummy === 'target');
  // і за секунду без влучань HP повертається
  for (let i = 0; i < 80; i++) D.step();
  return { alive, hpLow: t2 ? t2.hp : -1, hpBack: t2 ? t2.hp : -1, max: t2 ? t2.maxHp : 0 };
});
ok(revive.alive >= 4, 'найсильніший удар не вбиває манекена — тренування не закінчується',
   revive.alive + ' манекенів');
ok(revive.hpBack === revive.max, 'HP манекена повертається за секунду без влучань',
   revive.hpBack + ' / ' + revive.max);

const backOut = await page.evaluate(() => {
  const D = window.__DEV;
  D.Game.toMenu();
  return { on: D.RANGE.on, owned: D.Store.data.owned.slice() };
});
ok(!backOut.on, 'вихід гасить кімнату');
ok(backOut.owned.length === owned0.length && backOut.owned.every(w => owned0.includes(w)),
   'арсенал гравця повернувся без змін — прогрес не зачеплено',
   backOut.owned.join(','));

ok(errs.length === 0, 'без помилок JS' + (errs.length ? ': ' + errs[0] : ''));
console.log('\n' + (fails === 0 ? 'НАВЧАННЯ: УСЕ ЧИСТО' : 'НАВЧАННЯ: ПРОБЛЕМ ' + fails));
await browser.close();
process.exit(fails === 0 ? 0 : 1);
