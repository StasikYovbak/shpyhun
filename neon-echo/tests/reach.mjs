/**
 * Перевірка прохідності рівнів справжньою фізикою гри.
 * Будує граф поверхонь: із кожної точки, де можна стояти, симулює
 * ходьбу, стрибки різної висоти й ривок — реальними moveX/moveY гри —
 * і шукає шлях від спавна до чекпоінта й виходу (пошук у ширину).
 *   node tools/reach.mjs
 */
import { fileURLToPath } from 'url';
import path from 'path';
let pw;
try { pw = await import('playwright'); }
catch (e) { pw = await import('/opt/node22/lib/node_modules/playwright/index.js'); }
const chromium = pw.chromium || pw.default.chromium;

const file = process.env.URL || 'http://localhost:4173/';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
page.on('pageerror', e => console.log('ERR ' + e.message));
await page.goto(file);
await page.waitForFunction(() => !!window.__DEV);

const n = await page.evaluate(() => window.__DEV.levels());
let bad = 0;
console.log('ПЕРЕВІРКА ПРОХІДНОСТІ (реальна фізика гри)\n');

for (let lvl = 0; lvl < n; lvl++) {
  const r = await page.evaluate(lvl => {
    const D = window.__DEV;
    D.Game.startLevel(lvl, false);
    const W = D.world, PH = D.PH, TS = D.TS, DT = 1 / 60;
    const HW = 10, HH = 14;

    // Один прогін: старт зі стоячої точки, керування = dir, тримання стрибка = hold,
    // опційний ривок. Повертає точку приземлення або null.
    // Симуляція повторює блок руху героя з index.html, але БЕЗ подвійного
    // стрибка — щоб доказ прохідності мав запас.
    function run(sx, sy, dir, vx0, hold, dash) {
      const e = { x: sx, y: sy, w: HW, h: HH };
      let vx = vx0, vy = hold > 0 ? -PH.JUMP : 0;
      let onGround = hold > 0 ? false : true;
      let t = 0, dashT = dash ? PH.DASHT : 0, jumpHeld = hold > 0;
      const maxT = 2.4;
      while (t < maxT) {
        t += DT;
        if (dashT > 0) { dashT -= DT; vx = dir * PH.DASHV; vy = 0; }
        else {
          const target = dir * PH.RUN;
          const acc = onGround ? PH.ACC : PH.ACC * PH.AIRCTRL;
          if (target !== 0) {
            if (vx < target) vx = Math.min(target, vx + acc * DT);
            else if (vx > target) vx = Math.max(target, vx - acc * DT * (vx * target < 0 ? 1.7 : 0.55));
          } else {
            const fr = (onGround ? PH.DEC : PH.AIRDEC) * DT;
            if (Math.abs(vx) <= fr) vx = 0; else vx -= Math.sign(vx) * fr;
          }
          if (jumpHeld && t >= hold) { jumpHeld = false; if (vy < 0) vy *= PH.CUT; }
          let gr = PH.GRAV;
          if (Math.abs(vy) < PH.APEX_V) gr *= PH.APEX;
          else if (vy > 0) gr *= PH.FALL;
          vy += gr * DT;
          if (vy > PH.MAXFALL) vy = PH.MAXFALL;
        }
        if (D.moveX(e, vx * DT)) vx = 0;
        if (e.x < 0 || e.x > W.pw - HW) return null;
        const res = D.moveY(e, vy * DT, true);
        if (res === 1) {
          if (t > 0.06) return { x: e.x, y: e.y };
          onGround = true; vy = 0;
        } else if (res === -1) { vy = 0; onGround = false; }
        else onGround = false;
        if (e.y > W.ph + 8) return null;                 // впав у прірву
        // шипи вважаємо непрохідними для перевірки маршруту
        const tx0 = Math.floor((e.x + 1) / TS), tx1 = Math.floor((e.x + HW - 2) / TS);
        const ty0 = Math.floor((e.y + 2) / TS), ty1 = Math.floor((e.y + HH - 1) / TS);
        for (let ty = ty0; ty <= ty1; ty++)
          for (let tx = tx0; tx <= tx1; tx++)
            if (D.tAt(tx, ty) === 3) return null;
      }
      return null;
    }

    const key = p => (Math.round(p.x / 6) + ':' + Math.round(p.y / 6));
    const start = { x: W.spawn.x, y: W.spawn.y };
    // «упустимо» гравця на землю
    const s0 = run(start.x, start.y, 0, 0, 0, false) || start;
    const seen = new Map(); const queue = [s0]; seen.set(key(s0), true);
    let steps = 0;
    let bestX = s0.x;
    const cpX = W.cpPos.x, exX = W.exit.x;
    let cpOk = false, exOk = false;
    while (queue.length && steps < 40000) {
      const p = queue.shift(); steps++;
      if (p.x > bestX) bestX = p.x;
      if (Math.abs(p.x - cpX) < 20) cpOk = true;
      if (p.x + HW > exX - 2 && p.x < exX + 20) exOk = true;
      const acts = [];
      for (const dir of [-1, 1]) {
        for (const vx0 of [0, dir * PH.RUN]) {
          acts.push([dir, vx0, 0, false]);                 // зійти/впасти
          for (const hold of [0.10, 0.20, 0.50]) acts.push([dir, vx0, hold, false]);
          acts.push([dir, vx0, 0.50, true]);               // стрибок + ривок
          acts.push([dir, vx0, 0, true]);                  // ривок по землі
        }
      }
      for (const a of acts) {
        const q = run(p.x, p.y, a[0], a[1], a[2], a[3]);
        if (!q) continue;
        const k = key(q);
        if (seen.has(k)) continue;
        seen.set(k, true);
        queue.push(q);
      }
    }
    return { name: W.def.n, nodes: seen.size, cpOk, exOk, bestX, exX, pw: W.pw, steps };
  }, lvl);
  const okAll = r.cpOk && r.exOk;
  if (!okAll) bad++;
  console.log((okAll ? '  ✓ ' : '  ✗ ') + 'СЕКТОР ' + (lvl + 1) + ' «' + r.name + '»: ' +
    'вузлів ' + r.nodes + ', чекпоінт ' + (r.cpOk ? 'досяжний' : 'НЕДОСЯЖНИЙ') +
    ', вихід ' + (r.exOk ? 'досяжний' : 'НЕДОСЯЖНИЙ (дійшли до x=' + Math.round(r.bestX) + ' з ' + r.exX + ')'));
}
console.log('\n' + (bad === 0 ? 'УСІ 10 РІВНІВ ПРОХІДНІ' : bad + ' рівнів із проблемою'));
await browser.close();
process.exit(bad === 0 ? 0 : 1);
