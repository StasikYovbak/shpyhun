/**
 * Арена СЕРВОТАВРА (сектор 2): геометрія арени та розрахунок ударної хвилі.
 * Вимірює все просто в грі — висоту хвилі, висоту стрибка, запас у пікселях
 * і вікно, протягом якого герой перебуває вище за хвилю; потім реально
 * ухиляється стрибком і перевіряє, що шкоди не було.
 *   node tools/boss2.mjs
 */
import { fileURLToPath } from 'url';
import path from 'path';
let pw;
try { pw = await import('playwright'); }
catch (e) { pw = await import('/opt/node22/lib/node_modules/playwright/index.js'); }
const chromium = pw.chromium || pw.default.chromium;
const here = path.dirname(fileURLToPath(import.meta.url));
const file = 'file://' + path.resolve(here, '..', 'index.html');

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(file);
await page.waitForFunction(() => !!window.__DEV);

const R = await page.evaluate(() => {
  const D = window.__DEV, P = D.P, W = D.world;
  D.Game.startLevel(1, false); D.god(true);
  // --- геометрія арени з тайлової карти ---
  const rows = W.def.rows, TS = 16;
  const a0 = W.bossX / TS, a1 = W.tw;
  let floorRow = -1, flat = 0, plats = [];
  for (let y = 0; y < rows.length; y++) {
    let run = 0, best = 0, x0 = -1;
    for (let x = a0; x < a1; x++) {
      const c = rows[y][x];
      if (c === '#') { if (floorRow < 0 || y === floorRow) { run++; best = Math.max(best, run); } }
      else run = 0;
      if (c === '=') { if (x0 < 0) x0 = x; }
      else if (x0 >= 0) { plats.push({ y: y * TS, x0: x0 * TS, w: (x - x0) * TS }); x0 = -1; }
    }
    if (best > 0 && floorRow < 0) { floorRow = y; flat = best * TS; }
  }
  const floorY = floorRow * TS;

  // --- ударна хвиля: беремо параметри з реального пострілу боса ---
  D.gotoBoss();
  for (let i = 0; i < 150; i++) D.step();            // пережити інтро
  D.BOSS.phase = 2;
  D.BULL.length = 0;
  D.BOSS.st = 'air'; D.BOSS.vy = 10; D.BOSS.y = D.BOSS.ground - D.BOSS.h - 2;
  let wave = null;
  for (let i = 0; i < 60 && !wave; i++) {
    D.step();
    wave = D.BULL.find(b => b.kind === 3) || null;
  }
  const waveTop = wave ? wave.y - wave.h / 2 : null;
  const waveH = wave ? wave.h : null;
  const waveSpeed = wave ? Math.abs(wave.vx) : null;

  // --- висота стрибка просто на цій арені ---
  D.BULL.length = 0;
  P.x = D.BOSS.a0 + 120; P.y = floorY - P.h; P.vy = 0; P.jumps = 0;
  D.kb.l = D.kb.r = D.kb.a = 0;
  for (let i = 0; i < 5; i++) D.step();
  const standY = P.y;
  let apex = 999, above = 0;
  D.kb.a = 1;
  for (let i = 0; i < 70; i++) {
    D.step();
    apex = Math.min(apex, P.y);
    if (waveTop !== null && P.y + P.h < waveTop) above++;   // низ героя вище за хвилю
    if (i > 4 && P.onGround) break;
  }
  D.kb.a = 0;
  for (let i = 0; i < 40 && !P.onGround; i++) D.step();

  // --- реальне ухилення: хвиля летить у героя, стрибаємо ---
  P.x = D.BOSS.a0 + 200; P.y = floorY - P.h; P.vy = 0; P.jumps = 0; P.inv = 0;
  D.god(false); P.hp = 5;
  for (let i = 0; i < 4; i++) D.step();
  D.shoot(P.x + 150, floorY - 9, -150, 0,
          { own: 'e', dmg: 1, col: '#ffd23f', w: 12, h: 16, life: 4, kind: 3 });
  let jumped = false, hpMin = 5;
  for (let i = 0; i < 130; i++) {
    const b = D.BULL.find(x => x.kind === 3);
    if (b && !jumped && Math.abs(b.x - (P.x + P.w / 2)) < 46) { D.kb.a = 1; jumped = true; }
    if (jumped && i % 2 === 0) { /* тримаємо кнопку */ }
    D.step();
    hpMin = Math.min(hpMin, P.hp);
    if (jumped && P.onGround && i > 40) break;
  }
  D.kb.a = 0;
  return {
    arena: { x0: D.BOSS.a0, x1: D.BOSS.a1, width: D.BOSS.a1 - D.BOSS.a0, floorY: floorY, flat: flat },
    plats: plats.filter(p => p.x0 >= D.BOSS.a0),
    wave: { top: waveTop, h: waveH, speed: waveSpeed },
    jump: { standTop: standY, apexTop: apex, height: standY - apex, framesAbove: above },
    dodge: { jumped: jumped, hpMin: hpMin }
  };
});

const A = R.arena, W = R.wave, J = R.jump;
const clearNeeded = (A.floorY - W.top);              // на скільки треба піднятись
console.log('АРЕНА СЕРВОТАВРА (сектор 2)\n');
console.log('  межі арени         x = %d..%d (%d px = %d тайлів)',
            A.x0, A.x1, A.width, A.width / 16);
console.log('  підлога            y = %d, суцільна смуга %d px без жодної перешкоди',
            A.floorY, A.flat);
R.plats.forEach(p => console.log('  бічна галерея      x = %d, ширина %d px, висота над підлогою %d px',
            p.x0, p.w, A.floorY - p.y));
console.log('\nУДАРНА ХВИЛЯ ФАЗИ 2');
console.log('  висота хвилі       %d px (верх на y = %d, підлога y = %d)', W.h, W.top, A.floorY);
console.log('  швидкість          %d px/с', W.speed);
console.log('  треба піднятись    %d px, щоб низ героя пройшов над хвилею', clearNeeded);
console.log('\nСТРИБОК НА ЦІЙ АРЕНІ');
console.log('  стоїть на y = %s, вершина стрибка y = %s',
            J.standTop.toFixed(1), J.apexTop.toFixed(1));
console.log('  висота стрибка     %s px', J.height.toFixed(1));
console.log('  ЗАПАС              %s - %s = %s px (у %s раза більше за потрібне)',
            J.height.toFixed(1), clearNeeded, (J.height - clearNeeded).toFixed(1),
            (J.height / clearNeeded).toFixed(1));
console.log('  герой вище хвилі   %d кадрів = %s с — стільки часу є на помилку в таймінгу',
            J.framesAbove, (J.framesAbove / 60).toFixed(2));
console.log('\nРЕАЛЬНЕ УХИЛЕННЯ');
console.log('  %s стрибок зроблено=%s, HP після хвилі: %d/5',
            (R.dodge.jumped && R.dodge.hpMin === 5) ? '✓' : '✗', R.dodge.jumped, R.dodge.hpMin);
const ok = J.height - clearNeeded >= 20 && R.dodge.jumped && R.dodge.hpMin === 5 &&
           R.plats.length >= 2 && A.flat >= 240 && errors.length === 0;
console.log('\n' + (ok ? 'АРЕНА БОСА 2: ВИМОГИ ВИКОНАНО' : 'АРЕНА БОСА 2: Є ПРОБЛЕМА'));
await browser.close();
process.exit(ok ? 0 : 1);
