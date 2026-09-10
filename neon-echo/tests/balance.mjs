/**
 * Баланс босів. Дає три числа на кожного боса:
 *   1) реальний час убивства ботом, що б'ється лише стартовою зброєю;
 *   2) темп атак боса — скільки телеграфів на секунду він піднімає
 *      (один телеграф = одна атака, від якої можна ухилитись);
 *   3) розрахунок «при точності 60%»: TTK = HP / DPS60 і скільки атак
 *      бос устигне зробити за цей час, тобто яку частку з них треба
 *      прожити, щоб 5 сердець не скінчились.
 *   node tests/balance.mjs
 */
let pw;
try { pw = await import('playwright'); }
catch (e) { pw = await import('/opt/node22/lib/node_modules/playwright/index.js'); }
const chromium = pw.chromium || pw.default.chromium;
const file = process.env.URL || 'http://localhost:4173/';

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 420 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(file);
await page.waitForFunction(() => !!window.__DEV);
await page.click('#mPlay');
await page.waitForTimeout(200);

const RUNS = Number(process.env.RUNS || 2);
const HEARTS = 5, SURVIVE = 4;                  // ТЗ: не більше 4 влучань за бій
const UPTIME = 0.70;                            // частка бою, коли гравець атакує, а не ухиляється
const ACC = 0.50;                               // точність за ТЗ промта №7
const DODGE = 0.85;                             // той самий гравець пропускає кожну сьому атаку
const MAXATK = SURVIVE / (1 - DODGE);           // скільки атак бос має право встигнути

// --- аналітичний DPS стартової зброї з констант гри ---
const K = await page.evaluate(() => ({ BL: window.__DEV.BL, RG: window.__DEV.RG }));
const arcCycle = K.BL.DUR.reduce((a, b) => a + b, 0) + 3 / 60;
const arcDps = K.BL.DMG.reduce((a, b) => a + b, 0) / arcCycle;
const shots = Math.ceil(100 / K.RG.SHOT);
const railFire = shots * K.RG.CD;
const lockGood = 0.48 * K.RG.LOCK;              // середина зеленої зони активного перезаряджання
const railLock = 0.7 * lockGood + 0.3 * K.RG.LOCK;
const railDps = shots / (railFire + railLock);
const mixDps = (arcDps * 0.4 + railDps * 0.6);  // реальний гравець змішує: 40% ближній, 60% дальній

console.log('АНАЛІТИЧНИЙ DPS СТАРТОВОЇ ЗБРОЇ (з констант BL/RG)\n');
console.log('  АРК-ТЕСАК   комбо ' + K.BL.DMG.join('+') + ' = ' + K.BL.DMG.reduce((a, b) => a + b, 0) +
            ' шкоди за ' + arcCycle.toFixed(2) + ' c  →  ' + arcDps.toFixed(2) + ' DPS');
console.log('  РЕЙКОСТРИЛ  ' + shots + ' пострілів × ' + K.RG.CD + ' c = ' + railFire.toFixed(2) +
            ' c вогню + ' + railLock.toFixed(2) + ' c перегріву  →  ' + railDps.toFixed(2) + ' DPS');
console.log('  МІКС 40/60  ' + mixDps.toFixed(2) + ' DPS при 100% влучань');
console.log('  × точність ' + (ACC * 100) + '% × час на атаку ' + (UPTIME * 100) + '%  →  ' +
            (mixDps * ACC * UPTIME).toFixed(2) + ' DPS\n');
const dps60 = mixDps * ACC * UPTIME;

const rows = [];
let fails = 0, tooHard = 0;
console.log('ЗАМІР У БОЮ (бот б\'ється лише АРК-ТЕСАКОМ і РЕЙКОСТРИЛОМ, ' + RUNS + ' прогонів)\n');

for (const lvl of [1, 3, 5, 7, 9]) {
  const runs = [];
  for (let k = 0; k < RUNS; k++) {
    runs.push(await page.evaluate(({ lvl, secs }) => {
      const D = window.__DEV, P = D.P;
      D.Game.startLevel(lvl, false); D.god(false); D.equip('arc', 'rail'); D.gotoBoss();
      let hits = 0, done = false, frames = 0, tele = 0;
      const TELSTATE = { aimTel: 1, bombTel: 1, dashTel: 1, diveTel: 1, jumpTel: 1, wind: 1, paw: 1 };
      let prevSt = '', lastTele = -99;
      const hp0 = P.hp;
      for (let i = 0; i < secs * 60; i++) {
        frames = i;
        const hbs = D.hitboxes();
        let t = null, best = 1e9, hasParts = false;
        for (const hb of hbs) if (hb.part) hasParts = true;
        for (const hb of hbs) {
          if (hasParts && !hb.part) continue;
          const d = Math.abs((hb.x + hb.w / 2) - (P.x + P.w / 2)) + Math.abs(hb.y - P.y) * 0.4;
          if (d < best) { best = d; t = hb; }
        }
        if (t) {
          const cx = P.x + P.w / 2, cy = P.y + P.h / 2;
          const dx = t.x + t.w / 2 - cx, dy = t.y + t.h / 2 - cy;
          D.kb.r = dx > 3 ? 1 : 0;
          D.kb.l = dx < -3 ? 1 : 0;
          D.kb.a = ((dy < -14 || (P.onGround && Math.abs(P.vx) < 6)) && (i % 46) < 28) ? 1 : 0;
          const near = Math.abs(dx) < 30 && Math.abs(dy) < 24;
          D.kb.b = (near ? (i % 12) < 2 : (i % 26) < 2) ? 1 : 0;
          D.kb.c = (!near && Math.abs(dy) < 14 && (i % 10) < 2) ? 1 : 0;
          D.kb.d = (dy > 26 && P.onGround && (i % 20) < 4) ? 1 : 0;
        }
        D.step();
        // Атака = одне рішення про ухилення. Телеграфи, підняті в межах
        // 0,25 с (залп уламків, сітка лазерів), — це ОДНА атака, а не шість.
        let raised = 0;
        for (const z of D.TELE) if (!z.__counted) { z.__counted = 1; raised = 1; }
        if (D.BOSS.st !== prevSt) { if (TELSTATE[D.BOSS.st]) raised = 1; prevSt = D.BOSS.st; }
        if (raised && i - lastTele > 15) { tele++; lastTele = i; }
        if (P.hp < hp0) { hits += hp0 - P.hp; P.hp = hp0; P.inv = 0.6; }
        if (P.dead) { P.dead = false; P.hp = hp0; }
        if (D.state().bossDone) { done = true; break; }
      }
      D.kb.r = D.kb.l = D.kb.a = D.kb.b = D.kb.c = D.kb.d = 0;
      return { done, secs: +(frames / 60).toFixed(1), hits, tele,
               maxHp: D.BOSS.maxHp, name: D.BOSS.def ? D.BOSS.def.name : '?' };
    }, { lvl, secs: 240 }));
  }
  const avg = k => runs.reduce((a, r) => a + r[k], 0) / runs.length;
  const r0 = runs[0], ok = runs.every(r => r.done);
  const secs = +avg('secs').toFixed(1), tele = avg('tele');
  const rate = tele / secs;                                // атак боса на секунду
  // TTK беремо ВИМІРЯНИЙ. Бот грає гірше за модель «60% точності»
  // (б'є за таймером, не ухиляється зовсім), тож його час — верхня межа.
  // Аналітичний HP/DPS60 показуємо поруч як контрольне число.
  const ttkCalc = r0.maxHp / dps60;
  const ttk60 = secs;
  const attacks = rate * ttk60;
  const needDodge = Math.max(0, 1 - SURVIVE / attacks);
  const takes = attacks * (1 - DODGE);                     // скільки влучань пропустить гравець
  const hard = takes > SURVIVE;
  const hpMax = Math.round(r0.maxHp * MAXATK / Math.max(1, attacks));
  if (!ok) fails++;
  if (hard) tooHard++;
  rows.push({ lvl: lvl + 1, name: r0.name, hp: r0.maxHp, botSecs: secs,
              botDps: +(r0.maxHp / secs).toFixed(2), rate: +rate.toFixed(2),
              ttk60: +ttk60.toFixed(1), ttkCalc: +ttkCalc.toFixed(1), attacks: +attacks.toFixed(1),
              takes: +takes.toFixed(1), hpMax, needDodge: +(needDodge * 100).toFixed(0), ok, hard });
  console.log((ok && !hard ? '  ✓ ' : '  ✗ ') + 'СЕКТОР ' + String(lvl + 1).padStart(2) + '  ' +
    r0.name.padEnd(13) + ' HP ' + String(r0.maxHp).padStart(3) +
    ' | бот ' + String(secs).padStart(5) + ' c (' + (r0.maxHp / secs).toFixed(2) + ' DPS)' +
    ' | атак/с ' + rate.toFixed(2) +
    ' | HP/DPS60 ' + ttkCalc.toFixed(0).padStart(3) + ' c' +
    ' | атак за бій ' + attacks.toFixed(0).padStart(3) +
    ' | пропустить ' + takes.toFixed(1).padStart(4) + ' з 4' +
    ' | стеля HP ' + String(hpMax).padStart(3) +
    (ok ? '' : '  НЕ ВБИТО') + (hard ? '  ЗАВАЖКО' : ''));
}

console.log('\n5 сердець: пережити можна ' + SURVIVE + ' влучання, п\'яте вбиває.');
console.log('Модель гравця: влучає ' + (ACC * 100) + '% ударів і ухиляється від ' + (DODGE * 100) +
            '% телеграфів (пропускає кожну сьому атаку).');
console.log('Бос має право встигнути ' + MAXATK.toFixed(0) + ' атак за бій; стеля HP — скільки їх');
console.log('вийде, якщо лишити темп той самий. Полегшений режим: 7 сердець і телеграфи +25%.');
console.log('\nJSON: ' + JSON.stringify(rows));
if (errors.length) { console.log('\nПОМИЛКИ: ' + errors.slice(0, 5).join(' | ')); fails += errors.length; }
console.log('\n' + (fails === 0 && tooHard === 0 ? 'БАЛАНС У МЕЖАХ ТЗ'
  : (fails ? 'НЕ ВБИТО БОСІВ: ' + fails + '  ' : '') + (tooHard ? 'ЗАВАЖКИХ: ' + tooHard : '')));
await browser.close();
process.exit(fails === 0 && tooHard === 0 ? 0 : 1);
