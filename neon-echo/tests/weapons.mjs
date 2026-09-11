/**
 * Заміряний DPS усіх десяти зброй по нерухомій мішені.
 * Мішень — «громила» з нескінченним HP, який не рухається й не б'ється;
 * кожен кадр його ставлять на потрібну відстань від героїні, а знята
 * шкода додається до лічильника. Герой у режимі бога, щоб бій не
 * переривався. Два заміри: впритул (18 px) і з дистанції (110 px).
 *   node tests/weapons.mjs
 */
let pw; try { pw = await import('playwright'); } catch (e) { pw = await import('/opt/node22/lib/node_modules/playwright/index.js'); }
const chromium = pw.chromium || pw.default.chromium;
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 420 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(process.env.URL || 'http://localhost:4173/');
await page.waitForFunction(() => !!window.__DEV, null, { timeout: 20000 });
await page.click('#mPlay');
await page.waitForTimeout(200);

const SECS = Number(process.env.SECS || 12);
const MELEE = ['arc', 'whip', 'brand', 'chrono', 'claws'];
const RANGED = ['rail', 'osa', 'swarm', 'shot', 'glitch'];

async function measure(id, dist, targets) {
  return page.evaluate(({ id, dist, secs, targets }) => {
    const D = window.__DEV, P = D.P;
    D.Game.startLevel(0, false); D.god(true);
    const melee = D.EQ.m && ['arc', 'whip', 'brand', 'chrono', 'claws'].indexOf(id) >= 0;
    D.equip(melee ? id : 'arc', melee ? 'rail' : id);
    for (let i = 0; i < 3; i++) D.step();
    P.x = 60; P.y = 13 * D.TS - P.h; P.vy = 0; P.face = 1;
    D.kb.l = D.kb.r = D.kb.a = D.kb.b = D.kb.c = D.kb.d = 0;
    // мішені
    const dummies = [];
    for (let k = 0; k < targets; k++) {
      const e = D.spawnEnemy('thug', P.x + dist + k * 20, 192, false);
      if (!e) continue;
      e.blind = 1; e.sp = 0; e.st = 'idle'; e.alertSt = 'calm'; e.tm = 999;
      e.hp = e.maxHp = 1e6;
      dummies.push(e);
    }
    let dmg = 0;
    const btn = melee ? 'b' : 'c';
    for (let i = 0; i < secs * 60; i++) {
      // тримати мішені на місці й лічити зняте
      for (let k = 0; k < dummies.length; k++) {
        const e = dummies[k];
        dmg += e.maxHp - e.hp; e.hp = e.maxHp;
        e.dead = false; e.stun = 0; e.charm = 0; e.vx = 0; e.vy = 0;
        e.x = P.x + P.face * (dist + k * 20); e.y = 192;
      }
      // тап або утримання залежно від зброї
      if (id === 'osa') D.kb.c = 1;                       // автомат
      else D.kb[btn] = (i % 6) < 2 ? 1 : 0;
      D.step();
      D.kb.b = D.kb.c = 0;
    }
    for (const e of dummies) { e.dead = true; e.hp = 0; }
    const w = D.G ? null : null;
    return { dmg: +(dmg / secs).toFixed(2) };
  }, { id, dist, secs: SECS, targets });
}

const W = await page.evaluate(() => {
  const o = {};
  for (const [k, w] of Object.entries(window.__DEV.G ? {} : {})) o[k] = w;
  return o;
});
const META = await page.evaluate(() => {
  const out = {};
  for (const id of ['arc', 'whip', 'brand', 'chrono', 'claws', 'rail', 'osa', 'swarm', 'shot', 'glitch']) {
    const w = window.__DEV.WEAPONS[id];
    out[id] = { name: w.name, kind: w.kind, res: w.res, bars: w.bars, from: w.from };
  }
  return out;
});

console.log('ЗАМІРЯНИЙ DPS УСІХ ЗБРОЙ (' + SECS + ' с по нерухомій мішені)\n');
console.log('  зброя                 впритул  дистанція(110px)  по трьох цілях  ресурс');
const rows = [];
for (const id of MELEE.concat(RANGED)) {
  const D0 = MELEE.indexOf(id) >= 0 ? 12 : 18;      // ближній бій міряємо в контакті
  const near = await measure(id, D0, 1);
  const far = await measure(id, 110, 1);
  const crowd = await measure(id, D0, 3);
  const m = META[id];
  rows.push({ id, name: m.name, kind: m.kind, near: near.dmg, far: far.dmg, crowd: crowd.dmg, res: m.res });
  console.log('  ' + m.name.padEnd(20) + String(near.dmg).padStart(7) +
              String(far.dmg).padStart(18) + String(crowd.dmg).padStart(16) + '  ' + m.res);
}
console.log('\nJSON: ' + JSON.stringify(rows));
if (errors.length) console.log('\nПОМИЛКИ JS: ' + errors.slice(0, 5).join(' | '));
await browser.close();
