/**
 * Геометрична перевірка прохідності: кожен розрив між поверхнями проти
 * довжини (85 px) і висоти (66 px) стрибка. Подвійний стрибок не враховано.
 * Працює просто з модулів гри — без браузера.
 *   node tests/gaps.mjs
 */
import { CONFIG } from '../src/config.js';
import { LEVELS } from '../src/levels.js';

const TS = 16, LIMIT_X = 85, LIMIT_Y = 66;
function jumpGeometry(v0) {
  const g = CONFIG.GRAV, av = CONFIG.APEX_V;
  const h1 = (v0 * v0 - av * av) / (2 * g), h2 = (av * av) / (2 * g * CONFIG.APEX);
  const h = h1 + h2;
  const tUp = (v0 - av) / g + av / (g * CONFIG.APEX);
  const tD1 = av / (g * CONFIG.APEX);
  const gd = g * CONFIG.FALL;
  const tD2 = (-av + Math.sqrt(av * av + 2 * gd * (h - h2))) / gd;
  return { h, air: tUp + tD1 + tD2 };
}
const J = jumpGeometry(CONFIG.JUMP), J2 = jumpGeometry(CONFIG.JUMP2);
console.log('ГЕОМЕТРІЯ СТРИБКА З CONFIG');
console.log('  висота %s px = %s тайла, довжина %s px = %s тайла, подвійний +%s px\n',
  J.h.toFixed(1), (J.h / TS).toFixed(2), (J.air * CONFIG.RUN).toFixed(1),
  (J.air * CONFIG.RUN / TS).toFixed(2), J2.h.toFixed(1));

const SOLID = new Set(['#', '<', '>']), STAND = new Set(['#', '<', '>', '=']);
function analyze(lv) {
  const rows = lv.rows, H = rows.length, W = rows[0].length;
  const at = (x, y) => (x < 0 || x >= W || y < 0 || y >= H) ? '.' : rows[y][x];
  const isStand = (x, y) => y > 0 && STAND.has(at(x, y)) && !SOLID.has(at(x, y - 1)) && at(x, y - 1) !== '=';
  const segs = [];
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      if (!isStand(x, y)) { x++; continue; }
      const x0 = x;
      while (x < W && isStand(x, y)) x++;
      segs.push({ x0: x0 * TS, x1: x * TS, top: y * TS, tx: x0, ty: y, w: x - x0 });
    }
  }
  const gapX = (a, b) => (b.x0 > a.x1) ? (b.x0 - a.x1) : (b.x1 < a.x0 ? a.x0 - b.x1 : 0);
  let exitX = W * TS;
  rows.forEach(r => { const i = r.indexOf('E'); if (i >= 0) exitX = i * TS; });
  const problems = [];
  for (const s of segs) {
    if (s.x1 >= exitX - TS) continue;
    let best = null, near = null, nd = Infinity;
    for (const t of segs) {
      if (t === s || t.x1 <= s.x1) continue;
      const dx = gapX(s, t), dy = s.top - t.top;
      if (dx < nd) { nd = dx; near = t; }
      if (dx <= LIMIT_X && dy <= LIMIT_Y) { best = t; break; }
    }
    if (!best && near)
      problems.push({ kind: 'розрив', tx: s.tx + s.w, ty: s.ty, needX: Math.round(nd), needY: Math.round(s.top - near.top) });
  }
  for (const s of segs) {
    if (s.ty >= H - 4 && s.x0 <= TS * 2) continue;
    let ok = false;
    for (const t of segs) {
      if (t === s) continue;
      if (gapX(s, t) <= LIMIT_X && (t.top - s.top) <= LIMIT_Y) { ok = true; break; }
    }
    if (!ok) problems.push({ kind: 'острів', tx: s.tx, ty: s.ty });
  }
  return { segs: segs.length, problems };
}
let bad = 0;
console.log('ПЕРЕВІРКА РОЗРИВІВ (планка: %d px по горизонталі, %d px угору)\n', LIMIT_X, LIMIT_Y);
LEVELS.forEach((lv, i) => {
  const r = analyze(lv);
  if (!r.problems.length) console.log('  Рівень %d — OK  («%s», поверхонь %d)', i + 1, lv.n, r.segs);
  else {
    bad++;
    for (const p of r.problems.slice(0, 5))
      console.log(p.kind === 'розрив'
        ? `  Рівень ${i + 1} — розрив на тайлі (${p.tx},${p.ty}): потрібно ${p.needX} px, доступно ${LIMIT_X}`
        : `  Рівень ${i + 1} — острів на тайлі (${p.tx},${p.ty})`);
  }
});
console.log('\n' + (bad === 0 ? 'УСІ 10 РІВНІВ ПРОХОДЯТЬ ГЕОМЕТРИЧНУ ПЕРЕВІРКУ' : 'РІВНІВ ІЗ ПРОБЛЕМАМИ: ' + bad));
process.exit(bad === 0 ? 0 : 1);
