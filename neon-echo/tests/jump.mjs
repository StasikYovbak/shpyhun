/**
 * ДЕТЕРМІНІЗМ СТРИБКА.
 *
 * Скарга була така: «один і той самий стрибок то прискорює вперед, то
 * гальмує, і проста прірва раптом стає непрохідною». Тут це міряється, а
 * не обговорюється.
 *
 * Дві різні перевірки, і плутати їх не можна:
 *
 *  1. НЕЗАЛЕЖНІСТЬ ВІД ЧАСТОТИ КАДРІВ. Крок фізики фіксований (1/60 с з
 *     акумулятором), тож при 30, 45, 60, 120 FPS і при нерівних кадрах
 *     довжина стрибка має збігатись ДО ОСТАННЬОГО ЗНАКА. Не «майже» —
 *     рівно. Будь-який розкид тут означає, що десь загубився `dt`.
 *
 *  2. НЕЗАЛЕЖНІСТЬ ВІД ПЕРЕДІСТОРІЇ. Той самий стрибок після ривка,
 *     після удару, після пострілу має давати ту саму довжину. Саме це
 *     й було зламано: зовнішні імпульси (віддача, ривок, відкидання)
 *     підмішувались просто в `vx`, і стрибок «пам'ятав» те, що сталося
 *     секундою раніше.
 *
 * Міряємо в зоні платформінгу тренувальної кімнати: там гарантовано
 * рівна підлога потрібної довжини, а не випадкова ділянка сектора.
 *   node tests/jump.mjs
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
const page = await browser.newPage({ viewport: { width: 900, height: 420 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(file);
await page.waitForFunction(() => !!window.__DEV);
await page.evaluate(() => { window.__DEV.Store.data.tutAsked = 1; window.__DEV.Store.save(); });
await page.click('#mPlay');
await page.waitForTimeout(250);

/* Один прогін живе цілком усередині сторінки: так між кроками фізики
   не встрягає ні rAF, ні наша асинхронність. */
await page.evaluate(() => {
  const D = window.__DEV, P = D.P;
  const DT = 1 / 60;
  window.__JT = {};

  // Рівний майданчик: початок кімнати, до першої прірви.
  window.__JT.reset = () => {
    D.Game.startRange('menu');
    D.rangeSetGod(true);
    D.ENEM.length = 0; D.BULL.length = 0;
    P.x = 6 * D.TS; P.y = 13 * D.TS - P.h;
    P.vx = 0; P.vy = 0; P.evx = 0; P.evxT = 0;
    P.onGround = true; P.jumps = 0; P.coyote = 0; P.jbuf = 0;
    P.dashT = 0; P.dashCd = 0; P.heat = 0; P.lock = false;
    D.kb.l = D.kb.r = D.kb.a = D.kb.b = D.kb.c = 0;
    for (let i = 0; i < 6; i++) D.step();
  };
  const dash = () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft' }));
  window.__JT.dash = dash;

  /**
   * Прогін. `fps` і `jitter` годують АКУМУЛЯТОР, як справжній цикл гри;
   * усередині акумулятора кроки завжди фіксовані.
   *
   * Міряти теж треба ПОКРОКОВО, а не покадрово: на 30 FPS в одному
   * кадрі два кроки фізики, і якщо ловити приземлення на межі кадру,
   * можна спізнитись на крок — а це рівно 3,5 px при швидкості бігу.
   * Розкид у 3,5 px був би не в грі, а в лінійці.
   */
  window.__JT.run = (opt) => {
    opt = opt || {};
    const fps = opt.fps || 60, jit = !!opt.jitter;
    window.__JT.reset();
    if (opt.setup) opt.setup();

    let acc = 0, flick = 0, prevG = P.onGround;
    let phase = 'run', stepsInPhase = 0, air = 0;
    let x0 = 0, len = null, guard = 0;
    D.kb.r = 1;                                    // напрямок тримаємо весь прогін

    /** Один крок фізики + уся логіка сценарію. Викликається лише з акумулятора. */
    const one = () => {
      const wasAir = !P.onGround;
      D.step(); guard++; stepsInPhase++;
      if (P.onGround !== prevG) { flick++; prevG = P.onGround; }
      if (phase === 'run') {
        if (stepsInPhase >= (opt.runSteps === undefined ? 30 : opt.runSteps)) {
          phase = 'prep'; stepsInPhase = 0;
          if (opt.prep) opt.prep();
        }
        return;
      }
      if (phase === 'prep') {
        // Сценарії, що чекають закінчення ривка, тримають паузу тут.
        if (opt.waitDash && P.dashT > 0) return;
        if (opt.prepSteps && stepsInPhase < opt.prepSteps) return;
        phase = 'air'; stepsInPhase = 0; air = 0;
        x0 = P.x; D.kb.a = 1;
        return;
      }
      if (!P.onGround) air++;
      if (opt.mid && air === 6 && !opt.midDone) { opt.midDone = 1; opt.mid(); }
      // Приземлення ловиться на тому САМОМУ кроці, де воно сталось.
      if (wasAir && P.onGround && air > 4 && len === null) len = P.x - x0;
    };

    while (len === null && guard < 2000) {
      let dt = 1 / fps;
      if (jit) dt *= 0.5 + Math.random();
      if (dt > 0.25) dt = 0.25;
      acc += dt;
      let n = 0;
      while (acc >= DT && n < 6 && len === null) { one(); acc -= DT; n++; }
      if (acc > DT * 6) acc = 0;
    }
    D.kb.r = 0; D.kb.a = 0;
    opt.midDone = 0;
    return { len: +(len === null ? -1 : len).toFixed(6), air, flick, steps: guard };
  };
});

const run = (opt) => page.evaluate(o => {
  // функції не переживають серіалізацію — збираємо їх за іменем
  const D = window.__DEV, P = D.P, T = window.__JT;
  const cfg = { fps: o.fps, jitter: o.jitter };
  // Ривок триває 0,18 с, і стрибок під час нього штатно заблокований.
  // Тому міряємо два чесні випадки: стрибок РІВНО як ривок скінчився
  // (чи лишився по ньому надлишок швидкості?) і через 0,25 с після.
  if (o.kind === 'dash')      { cfg.prep = () => T.dash(); cfg.waitDash = 1; }
  if (o.kind === 'dashLate')  { cfg.prep = () => T.dash(); cfg.waitDash = 1; cfg.prepSteps = 15; }
  if (o.kind === 'shot')      { cfg.setup = () => D.equip('arc', 'shot');
                                cfg.mid = () => { D.kb.c = 1; D.step(); D.kb.c = 0; }; }
  if (o.kind === 'hurt')      cfg.prep = () => { D.rangeSetGod(false); D.playerHurt(1, P.x - 40); D.rangeSetGod(true); };
  if (o.kind === 'wall')      cfg.setup = () => {
    const W = D.world, tx = Math.floor(P.x / D.TS) + 9;
    for (let ty = 9; ty < 13; ty++) W.tiles[ty * W.tw + tx] = 1;
  };
  if (o.kind === 'conv')      cfg.setup = () => {
    // конвеєр під ногами: перевіряємо, що він не лишає післядії в повітрі
    const W = D.world;
    for (let tx = Math.floor(P.x / D.TS) - 2; tx < Math.floor(P.x / D.TS) + 8; tx++)
      W.tiles[13 * W.tw + tx] = D.T_CONVR;
  };
  if (o.kind === 'mp')        {
    // Платформа всього три тайли завширшки, тож розбігу тут немає:
    // стаємо, дочікуємось, поки гра визнає нас пасажиром, і стрибаємо.
    cfg.runSteps = 0;
    cfg.setup = () => {
      const m = D.world.mp[0];
      P.x = m.x + m.w / 2 - P.w / 2; P.y = m.y - P.h - 1; P.vx = 0; P.vy = 0;
      for (let i = 0; i < 60 && !P.ride; i++) D.step();
    };
  }
  return T.run(cfg);
}, opt);

console.log('1. НЕЗАЛЕЖНІСТЬ ВІД ЧАСТОТИ КАДРІВ\n');
console.log('  умова          прогонів   довжина стрибка        розкид');
const FPS = [['60 FPS', 60, 0], ['30 FPS', 30, 0], ['45 FPS', 45, 0],
             ['120 FPS', 120, 0], ['нерівні кадри', 60, 1]];
let allLens = [];
for (const [name, fps, jit] of FPS) {
  const lens = [];
  for (let i = 0; i < 20; i++) lens.push((await run({ kind: 'plain', fps, jitter: jit })).len);
  const spread = Math.max(...lens) - Math.min(...lens);
  allLens = allLens.concat(lens);
  console.log('  ' + name.padEnd(15) + String(lens.length).padEnd(11) +
              lens[0].toFixed(4).padEnd(23) + spread.toFixed(6));
}
const allSpread = Math.max(...allLens) - Math.min(...allLens);
ok(allSpread === 0, 'розкид по ста прогонах на п`яти частотах — РІВНО нуль',
   allLens.length + ' прогонів, розкид ' + allSpread);

console.log('\n2. НЕЗАЛЕЖНІСТЬ ВІД ПЕРЕДІСТОРІЇ\n');
console.log('  сценарій                     довжина      розкид   кадрів у повітрі');
const CASES = [
  ['звичайний',                  'plain'],
  ['ривок за кадр до стрибка',   'dash'],
  ['ривок за 0,33 с до стрибка', 'dashLate'],
  ['постріл дробовика в польоті', 'shot'],
  ['після отриманого удару',     'hurt'],
  ['уздовж стіни',               'wall'],
  ['з рухомої платформи',        'mp'],
  ['з конвеєра',                 'conv']
];
const res = {};
for (const [name, kind] of CASES) {
  const rs = [];
  for (let i = 0; i < 10; i++) rs.push(await run({ kind, fps: 60, jitter: 0 }));
  const lens = rs.map(r => r.len);
  const spread = +(Math.max(...lens) - Math.min(...lens)).toFixed(6);
  res[kind] = { len: lens[0], spread, air: rs[0].air, flick: Math.max(...rs.map(r => r.flick)) };
  console.log('  ' + name.padEnd(29) + lens[0].toFixed(2).padEnd(13) +
              String(spread).padEnd(9) + rs[0].air);
}
ok(Object.values(res).every(r => r.spread === 0),
   'кожен сценарій сам по собі відтворюється точно',
   'максимальний розкид ' + Math.max(...Object.values(res).map(r => r.spread)));

// Головне: стрибок після ривка має збігатись зі звичайним. Саме це було
// зламано — ривок лишав по собі 450 px/с у `vx`, і стрибок летів далі.
ok(res.dash.len === res.plain.len,
   'стрибок рівно на виході з ривка = звичайний стрибок',
   res.dash.len.toFixed(2) + ' проти ' + res.plain.len.toFixed(2) + ' px');
ok(res.dashLate.len === res.plain.len,
   'стрибок через 0,25 с після ривка = звичайний стрибок',
   res.dashLate.len.toFixed(2) + ' px');
ok(res.conv.len === res.plain.len,
   'конвеєр під ногами не тягне героїню в польоті',
   res.conv.len.toFixed(2) + ' px');
// Платформа стрибає без розбігу, тож із звичайним стрибком її не
// порівняти — важливо, що вона взагалі відбулась і відтворюється точно.
ok(res.mp.len > 0 && res.mp.spread === 0,
   'стрибок із рухомої платформи відбувається й відтворюється точно',
   res.mp.len.toFixed(2) + ' px, розкид ' + res.mp.spread);
ok(res.hurt.len === res.plain.len,
   'стрибок після отриманого удару = звичайний стрибок',
   res.hurt.len.toFixed(2) + ' px');

// Віддача дробовика — це НАВМИСНА механіка зброї, і вона має вкорочувати
// стрибок. Але тепер вона обмежена й згасає за 0,25 с, а не з'їдає його
// повністю: раніше 136 px перетворювались на 36.
const cut = 1 - res.shot.len / res.plain.len;
ok(cut > 0.05 && cut < 0.55, 'віддача дробовика вкорочує стрибок, але не з`їдає його',
   res.plain.len.toFixed(1) + ' → ' + res.shot.len.toFixed(1) + ' px, це -' +
   Math.round(cut * 100) + '% (було -74%)');

console.log('\n3. onGround НЕ МЕРЕХТИТЬ');
const og = await page.evaluate(() => {
  const D = window.__DEV, P = D.P, T = window.__JT;
  T.reset();
  D.kb.r = 1; for (let i = 0; i < 30; i++) D.step();
  T.dash();
  let s = '', dashFrames = 0, groundedDuringDash = 0;
  for (let i = 0; i < 26; i++) {
    D.step();
    if (P.dashT > 0) { dashFrames++; if (P.onGround) groundedDuringDash++; }
    s += (P.onGround ? 'G' : '.');
  }
  // а тепер стрибок одразу після ривка: наземний чи повітряний?
  T.reset();
  D.kb.r = 1; for (let i = 0; i < 30; i++) D.step();
  T.dash(); for (let i = 0; i < 13; i++) D.step();
  const og = P.onGround, jumps = P.jumps;
  D.kb.a = 1; D.step(); D.kb.a = 0; D.kb.r = 0;
  return { s, dashFrames, groundedDuringDash, og, jumps, vy: +P.vy.toFixed(0),
           JUMP: +D.PH.JUMP.toFixed(0), JUMP2: +D.PH.JUMP2.toFixed(0) };
});
console.log('  ривок по підлозі, кадр за кадром: ' + og.s);
ok(og.groundedDuringDash === og.dashFrames,
   'під час ривка ПО ПІДЛОЗІ героїня весь час вважається наземною',
   og.groundedDuringDash + ' з ' + og.dashFrames + ' кадрів');
ok(og.og === true && og.jumps === 0,
   'одразу після ривка вона все ще на землі', 'jumps=' + og.jumps);
ok(Math.abs(og.vy) > og.JUMP * 0.9,
   'і стрибок виходить НАЗЕМНИЙ, а не слабший повітряний',
   'vy=' + og.vy + ' (наземний ≈ -' + og.JUMP + ', повітряний ≈ -' + og.JUMP2 + ')');

console.log('\n4. ЗОВНІШНІЙ ІМПУЛЬС ЖИВЕ ОКРЕМО Й ЗГАСАЄ');
const ext = await page.evaluate(() => {
  const D = window.__DEV, P = D.P, T = window.__JT;
  T.reset();
  D.kb.r = 1; for (let i = 0; i < 30; i++) D.step();
  const vxRun = +P.vx.toFixed(2);
  D.pushX(-600);
  const e0 = +P.evx.toFixed(1), vx0 = +P.vx.toFixed(2);
  let frames = 0;
  while (Math.abs(P.evx) > 0.001 && frames < 120) { D.step(); frames++; }
  D.kb.r = 0;
  // і стеля: величезний імпульс має обрізатись
  D.pushX(99999);
  const capped = +P.evx.toFixed(0);
  return { vxRun, e0, vx0, sec: +(frames / 60).toFixed(3), vxAfter: +P.vx.toFixed(2),
           capped, RUN: +D.PH.RUN.toFixed(0) };
});
ok(ext.vx0 === ext.vxRun, 'імпульс НЕ чіпає власну швидкість гравця',
   'vx лишився ' + ext.vx0);
ok(Math.abs(ext.sec - 0.25) < 0.02, 'імпульс згасає рівно за 0,25 с', ext.sec + ' с');
ok(ext.capped <= ext.RUN * 3 + 1, 'імпульс обрізається по стелі',
   ext.capped + ' при стелі ' + (ext.RUN * 3));

console.log('\n5. ЗОНА ПЛАТФОРМІНГУ: ЩО РЕАЛЬНО БЕРЕТЬСЯ');
const gaps = await page.evaluate(() => {
  const D = window.__DEV, P = D.P, T = window.__JT;
  const map = D.rangeMap(), out = [];
  for (const g of map.marks.gaps) {
    let cleared = false;
    for (let attempt = 0; attempt < 3 && !cleared; attempt++) {
      T.reset();
      // розбіг: ставимо за 4 тайли до краю прірви
      P.x = (g.x0 - 4) * D.TS; P.y = 13 * D.TS - P.h; P.vx = 0; P.vy = 0;
      for (let i = 0; i < 4; i++) D.step();
      D.kb.r = 1;
      let jumped = false;
      for (let i = 0; i < 200; i++) {
        // стрибаємо рівно на краю
        if (!jumped && P.x + P.w >= g.x0 * D.TS - 2) { D.kb.a = 1; jumped = true; }
        D.step();
        if (jumped && P.onGround && P.x > (g.x1 + 1) * D.TS) { cleared = true; break; }
        if (P.y > 14 * D.TS) break;                 // впала в прірву
      }
      D.kb.r = 0; D.kb.a = 0;
    }
    out.push({ n: g.n, cleared });
  }
  return out;
});
console.log('  прірва   береться');
for (const g of gaps) console.log('  ' + (g.n + ' тайли').padEnd(9) + (g.cleared ? 'так' : 'ні'));
const maxOk = Math.max(...gaps.filter(g => g.cleared).map(g => g.n));
const minBad = Math.min(...gaps.filter(g => !g.cleared).map(g => g.n), 99);
ok(maxOk >= 4 && minBad > maxOk,
   'межа проходить чітко: до ' + maxOk + ' тайлів включно — так, від ' + minBad + ' — ні');

ok(errs.length === 0, 'без помилок JS' + (errs.length ? ': ' + errs[0] : ''));
console.log('\n' + (fails === 0 ? 'СТРИБОК: УСЕ ЧИСТО' : 'СТРИБОК: ПРОБЛЕМ ' + fails));
await browser.close();
process.exit(fails === 0 ? 0 : 1);
