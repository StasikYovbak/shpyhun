/**
 * Перевірка ігрових механік за технічним завданням:
 * комбо, парирування, розряд клинка, тепло/перегрів/активне перезаряджання,
 * заряджений постріл крізь щит, coyote time, буфер стрибка, і-фрейми ривка,
 * мультитач (рух + стрибок + постріл одночасно).
 *   node tools/mechanics.mjs
 */
import { fileURLToPath } from 'url';
import path from 'path';
let pw;
try { pw = await import('playwright'); }
catch (e) { pw = await import('/opt/node22/lib/node_modules/playwright/index.js'); }
const chromium = pw.chromium || pw.default.chromium;
const here = path.dirname(fileURLToPath(import.meta.url));
const file = 'file://' + path.resolve(here, '..', 'index.html');

let fails = 0;
const ok = (c, m, extra) => { if (!c) { fails++; console.log('  ✗ ' + m + (extra ? '  → ' + extra : '')); }
                              else console.log('  ✓ ' + m + (extra ? '  (' + extra + ')' : '')); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 900, height: 420 }, hasTouch: true, isMobile: false });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(file);
await page.waitForFunction(() => !!window.__DEV);
await page.click('#mPlay');
await page.waitForTimeout(200);

const R = await page.evaluate(() => {
  const D = window.__DEV, P = D.P, out = {};
  const reset = () => { D.Game.startLevel(0, false); D.god(false); P.inv = 0; P.x = 60; P.y = 194; P.vy = 0;
                        D.kb.l = D.kb.r = D.kb.a = D.kb.b = D.kb.c = D.kb.d = 0; for (let i = 0; i < 3; i++) D.step(); };
  const steps = n => { for (let i = 0; i < n; i++) D.step(); };

  // --- комбо з 3 ударів ---
  reset();
  const combo = [];
  for (let k = 0; k < 3; k++) {
    D.kb.b = 1; D.step(); combo.push({ idx: P.atkIdx, dur: P.atkT });
    D.kb.b = 0; steps(Math.round(D.BL.DUR[Math.min(k, 2)] * 60) + 4);
  }
  out.combo = combo;

  // --- парирування ворожої кулі ---
  reset();
  P.face = 1;
  const b = D.shoot(P.x + 26, P.y + 7, -130, 0, { own: 'e', dmg: 1, col: '#f00', w: 5, h: 5, life: 3 });
  const dmg0 = b.dmg;
  D.kb.b = 1; D.step(); D.kb.b = 0;               // натиснули B ЗА мить до влучання
  steps(8);
  out.parry = { own: b.own, dmg: b.dmg, dmg0: dmg0, vx: b.vx, charge: P.q };

  // --- шкала клинка + розряд ---
  reset();
  P.q = D.BL.MAXQ;
  const e1 = D.spawnEnemy('skreb', P.x + 20, 192, false);
  const hp0 = e1.hp;
  D.kb.b = 1; steps(40);                           // утримуємо B 0.66 c
  D.kb.b = 0; steps(4);
  out.discharge = { q: P.q, enemyHp: e1.hp, hp0: hp0, stun: e1.stun > 0 };

  // --- тепло й перегрів ---
  reset();
  let shots = 0, lockAt = 0;
  for (let i = 0; i < 12 && !P.lock; i++) {
    D.kb.c = 1; D.step(); D.kb.c = 0; shots++;
    if (P.lock) { lockAt = P.lockT; break; }
    steps(9);
  }
  out.heat = { shots: shots, heat: Math.round(P.heat), lock: P.lock, lockT: +lockAt.toFixed(2),
               zoneA: +P.arA.toFixed(2), zoneB: +P.arB.toFixed(2) };
  // блокування пострілу під час перегріву
  const bullBefore = D.BULL.length;
  D.kb.c = 1; D.step(); D.kb.c = 0;
  out.heat.blocked = D.BULL.length === bullBefore;
  // чекаємо кінець блокування
  steps(130);
  out.heat.afterLock = { lock: P.lock, heat: Math.round(P.heat) };

  // --- активне перезаряджання ---
  reset();
  for (let i = 0; i < 12 && !P.lock; i++) { D.kb.c = 1; D.step(); D.kb.c = 0; steps(9); }
  let tries = 0;
  while (P.lock && P.arMark < P.arA && tries++ < 200) D.step();
  D.kb.c = 1; D.step(); D.kb.c = 0;                // тап рівно в зеленій зоні
  out.reload = { lock: P.lock, heat: Math.round(P.heat), mark: +P.arMark.toFixed(2) };

  // --- заряджений постріл пробиває щит ---
  reset();
  P.face = 1;
  const sh = D.spawnEnemy('shield', P.x + 60, 192, false);
  sh.face = -1;                                    // щитом до гравця
  const shHp0 = sh.hp;
  const nb = D.shoot(P.x + 20, sh.y + 6, 300, 0, { own: 'p', dmg: 1, w: 6, h: 3, col: '#fff', life: 2 });
  steps(20);
  const afterNormal = sh.hp;
  D.kb.c = 1; steps(56); D.kb.c = 0; D.step(); steps(6);   // утримання 0.9 c -> промінь
  out.shield = { hp0: shHp0, afterNormal: afterNormal, afterBeam: sh.hp, beamFired: true };

  // --- coyote time ---
  reset();
  P.x = 176; P.y = 194; P.vy = 0; P.vx = 0;        // майданчик обривається на x=192
  D.kb.r = 1;
  let air = 0;
  for (let i = 0; i < 60; i++) { D.step(); if (!P.onGround) { air = 1; break; } }
  D.kb.r = 0;
  D.step();                                         // 1 кадр у повітрі (16 мс < 100 мс)
  D.kb.a = 1; D.step(); D.kb.a = 0;
  out.coyote = { airborne: air === 1, vy: Math.round(P.vy), jumped: P.vy < -100 };

  // --- буфер стрибка ---
  reset();
  P.y = 182; P.vy = 160; P.onGround = false; P.coyote = 0; P.jbuf = 0;   // до землі ~0.07 с
  D.kb.a = 1; D.step();                             // натиснули ЩЕ в повітрі й тримаємо
  let jumped = false, landed = false, air0 = P.vy;
  for (let i = 0; i < 14; i++) { D.step(); if (P.vy < -300) jumped = true; if (P.onGround) landed = true; }
  D.kb.a = 0;
  out.buffer = { jumped: jumped, landed: landed, air0: Math.round(air0) };

  // --- і-фрейми ривка ---
  reset();
  P.face = 1;
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft' }));
  D.step();
  const inDash = P.dashT > 0, cd = P.dashCd, x0 = P.x;
  // і-фрейми: шкода під час ривка не проходить
  P.inv = 0;
  const hpBefore = P.hp;
  const blocked = D.hurtNow ? false : (function () {
    const h0 = P.hp; P.inv = 0;
    // імітуємо ворожу кулю впритул
    D.shoot(P.x + 2, P.y + 6, 0, 0, { own: 'e', dmg: 1, col: '#f00', w: 6, h: 6, life: 0.5 });
    D.step();
    return P.hp === h0;
  })();
  steps(14);
  out.dash = { inDash: inDash, dashT: 0.18, cd: +cd.toFixed(2), moved: Math.round(P.x - x0),
               iframes: blocked };

  // --- змінна висота стрибка ---
  reset();
  let hiTop = 999; D.kb.a = 1;
  for (let i = 0; i < 70; i++) { D.step(); hiTop = Math.min(hiTop, P.y); }
  D.kb.a = 0; steps(5);
  reset();
  let loTop = 999; D.kb.a = 1; D.step(); D.kb.a = 0;
  for (let i = 0; i < 70; i++) { D.step(); loTop = Math.min(loTop, P.y); }
  out.varJump = { holdY: Math.round(hiTop), tapY: Math.round(loTop),
                  height: Math.round(194 - hiTop) };

  return out;
});

console.log('МЕХАНІКИ ЗБРОЇ Й КЕРУВАННЯ\n');
ok(R.combo.length === 3 && R.combo[0].idx === 0 && R.combo[1].idx === 1 && R.combo[2].idx === 2,
   'комбо клинка перемикає удари 1→2→3', JSON.stringify(R.combo.map(c => c.idx)));
ok(Math.abs(R.combo[2].dur - 0.30) < 0.02 && Math.abs(R.combo[0].dur - 0.18) < 0.02,
   'тривалості ударів 0.18 / 0.18 / 0.30 c', R.combo.map(c => c.dur.toFixed(2)).join(' / '));
ok(R.parry.own === 'p' && R.parry.dmg === R.parry.dmg0 * 2 && R.parry.vx > 0,
   'парирування розвертає кулю з подвійною шкодою', JSON.stringify(R.parry));
ok(R.parry.charge >= 1, 'парирування заряджає клинок');
ok(R.discharge.q === 0 && R.discharge.enemyHp < R.discharge.hp0,
   'розряд на повній шкалі б\'є по колу й скидає заряд', JSON.stringify(R.discharge));
ok(R.heat.shots === 9 && R.heat.lock === true,
   'перегрів настає рівно на 9-му пострілі (12% за постріл)', JSON.stringify(R.heat));
ok(R.heat.blocked, 'під час перегріву зброя не стріляє');
ok(Math.abs(R.heat.lockT - 2.0) < 0.06, 'блокування триває 2 с', String(R.heat.lockT));
ok(R.heat.afterLock.lock === false && R.heat.afterLock.heat === 0, 'після блокування тепло скинуто');
ok(R.reload.lock === false && R.reload.heat === 0,
   'активне перезаряджання в зеленій зоні миттєво скидає тепло', JSON.stringify(R.reload));
ok(R.shield.afterNormal === R.shield.hp0, 'щит тримає звичайну кулю');
ok(R.shield.afterBeam < R.shield.hp0, 'заряджений постріл пробиває щит',
   R.shield.hp0 + ' → ' + R.shield.afterBeam);
ok(R.coyote.airborne && R.coyote.jumped, 'coyote time: стрибок працює після сходу з краю',
   'vy=' + R.coyote.vy);
ok(R.buffer.jumped && R.buffer.air0 > 0,
   'буфер стрибка: натиснуто в польоті — стрибок на приземленні', JSON.stringify(R.buffer));
ok(R.dash.inDash && Math.abs(R.dash.cd - 0.8) < 0.02, 'ривок стартує, кулдаун 0.8 с',
   JSON.stringify(R.dash));
ok(R.dash.iframes, 'і-фрейми: під час ривка шкода не проходить');
ok(R.dash.moved > 40, 'ривок переносить героя на ' + R.dash.moved + ' px');
ok(R.varJump.holdY < R.varJump.tapY - 10, 'змінна висота стрибка (утримання вище за тап)',
   'утримання y=' + R.varJump.holdY + ', тап y=' + R.varJump.tapY);
ok(Math.abs(R.varJump.height - 48) <= 3, 'висота повного стрибка = 48 px (3 тайли)',
   R.varJump.height + ' px');

// --- мультитач: рух + стрибок + постріл одночасно ---
console.log('\nМУЛЬТИТАЧ');
const pos = await page.evaluate(() => {
  const b = window.__DEV.btn;
  return { A: { x: b.A.x, y: b.A.y }, C: { x: b.C.x, y: b.C.y } };
});
await page.evaluate(() => {
  const D = window.__DEV;
  D.Game.startLevel(0, false); D.god(true);
  const before = { x: D.P.x, bull: 0 };
  D.multi = null;
  let n = 0, maxBull = 0, jumped = false;
  const tick = () => {
    n++;
    maxBull = Math.max(maxBull, D.BULL.length);
    if (!D.P.onGround || D.P.vy < 0) jumped = true;
    if (n < 26) requestAnimationFrame(tick);
    else D.multi = { ax: D.S.ax, a: D.S.a, c: D.S.c, moved: D.P.x - before.x,
                     jumped: jumped, shot: maxBull > 0 };
  };
  requestAnimationFrame(tick);
});
const cdp = await ctx.newCDPSession(page);
await cdp.send('Input.dispatchTouchEvent', {
  type: 'touchStart',
  touchPoints: [{ x: 120, y: 300, id: 1 }, { x: pos.A.x, y: pos.A.y, id: 2 }, { x: pos.C.x, y: pos.C.y, id: 3 }]
});
await cdp.send('Input.dispatchTouchEvent', {
  type: 'touchMove',
  touchPoints: [{ x: 190, y: 300, id: 1 }, { x: pos.A.x, y: pos.A.y, id: 2 }, { x: pos.C.x, y: pos.C.y, id: 3 }]
});
await page.waitForTimeout(900);
const multi = await page.evaluate(() => window.__DEV.multi);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
ok(multi.ax > 0.2, 'джойстик дає рух вправо при трьох пальцях', 'ax=' + multi.ax.toFixed(2));
ok(multi.a === true, 'кнопка A (стрибок) натиснута одночасно');
ok(multi.c === true, 'кнопка C (постріл) натиснута одночасно');
ok(multi.moved > 4 && multi.jumped && multi.shot,
   'герой одночасно біжить, стрибає і стріляє',
   'Δx=' + multi.moved.toFixed(1) + ' постріл=' + multi.shot);

ok(errors.length === 0, 'без помилок JS' + (errors.length ? ': ' + errors[0] : ''));
console.log('\n' + (fails === 0 ? 'МЕХАНІКИ: УСЕ ЧИСТО' : 'МЕХАНІКИ: ПРОБЛЕМ ' + fails));
await browser.close();
process.exit(fails === 0 ? 0 : 1);
