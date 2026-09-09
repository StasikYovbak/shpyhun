/**
 * Валідатор прохідності за геометрією: бере CONFIG і всі 10 карт просто з
 * index.html і перевіряє кожен розрив між поверхнями — чи вписується він
 * у довжину стрибка по горизонталі та висоту стрибка по вертикалі.
 * Подвійний стрибок НЕ враховується — тобто перевірка йде із запасом.
 *   node tools/gaps.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(here, '..', 'index.html'), 'utf8');

// --- витягуємо CONFIG і LEVELS прямо з гри, щоб числа не розходились ---
const cfgSrc = src.slice(src.indexOf('const CONFIG = {'), src.indexOf('// Короткий псевдонім'));
const lvSrc = src.slice(src.indexOf('const LEVELS=['), src.indexOf('\n];', src.indexOf('const LEVELS=[')) + 3);
const CONFIG = new Function(cfgSrc + ' return CONFIG;')();
const LEVELS = new Function(lvSrc + ' return LEVELS;')();
const TS = 16, PW = 10, PHh = 14;

// --- геометрія стрибка з реальних констант ---
function jumpGeometry(v0) {
  const g = CONFIG.GRAV, av = CONFIG.APEX_V;
  // підйом: від v0 до av зі звичайною гравітацією, далі до 0 — з APEX
  const h1 = (v0 * v0 - av * av) / (2 * g);
  const h2 = (av * av) / (2 * g * CONFIG.APEX);
  const h = h1 + h2;
  const tUp = (v0 - av) / g + av / (g * CONFIG.APEX);
  // падіння: спершу APEX-ділянка, потім FALL
  const tD1 = av / (g * CONFIG.APEX);
  const hRest = h - h2;
  const gd = g * CONFIG.FALL;
  const tD2 = (-av + Math.sqrt(av * av + 2 * gd * hRest)) / gd;
  return { h: h, tUp: tUp, tDown: tD1 + tD2, air: tUp + tD1 + tD2 };
}
const J = jumpGeometry(CONFIG.JUMP);
const J2 = jumpGeometry(CONFIG.JUMP2);
const MAX_UP = Math.round(J.h);                    // 66 px
const MAX_RUN = Math.round(J.air * CONFIG.RUN);    // довжина стрибка з розбігу

console.log('ГЕОМЕТРІЯ СТРИБКА З CONFIG');
console.log('  висота        %s px = %s тайла', J.h.toFixed(1), (J.h / TS).toFixed(2));
console.log('  час у повітрі %s c (підйом %s / падіння %s)',
            J.air.toFixed(3), J.tUp.toFixed(3), J.tDown.toFixed(3));
console.log('  довжина       %s px = %s тайла (біг %s px/с)',
            (J.air * CONFIG.RUN).toFixed(1), (J.air * CONFIG.RUN / TS).toFixed(2), CONFIG.RUN);
console.log('  подвійний дає ще %s px (разом %s px = %s тайла)\n',
            J2.h.toFixed(1), (J.h + J2.h).toFixed(1), ((J.h + J2.h) / TS).toFixed(2));

const LIMIT_X = 85, LIMIT_Y = 66;                  // планка з ТЗ (консервативніша за розрахунок)
const SOLID = new Set(['#', '<', '>']);
const STAND = new Set(['#', '<', '>', '=']);

function analyze(lv) {
  const rows = lv.rows, H = rows.length, W = rows[0].length;
  const at = (x, y) => (x < 0 || x >= W || y < 0 || y >= H) ? '.' : rows[y][x];
  // Поверхня — тайл, на якому можна стояти: над ним порожньо і він у межах карти
  // (верхній ряд стелі не рахуємо: над ним нічого немає).
  const isStand = (x, y) => y > 0 && STAND.has(at(x, y)) &&
                            !SOLID.has(at(x, y - 1)) && at(x, y - 1) !== '=';
  // сегменти: суцільні горизонтальні смуги поверхні на однаковій висоті
  const segs = [];
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      if (!isStand(x, y)) { x++; continue; }
      const x0 = x;
      while (x < W && isStand(x, y)) x++;
      segs.push({ x0: x0 * TS, x1: x * TS, top: y * TS, tx: x0, ty: y, w: (x - x0) });
    }
  }
  const problems = [];
  // 1. Розриви вперед: із кожного сегмента має бути куди стрибнути праворуч.
  const exitX = (rows.findIndex(r => r.includes('E')) >= 0)
    ? rows.reduce((acc, r, y) => { const i = r.indexOf('E'); return i >= 0 ? i * TS : acc; }, 0) : W * TS;
  // Горизонтальний зазор між двома сегментами (0, якщо вони перекриваються по X).
  const gapX = (a, b) => (b.x0 > a.x1) ? (b.x0 - a.x1) : (b.x1 < a.x0 ? a.x0 - b.x1 : 0);
  for (const s of segs) {
    if (s.x1 >= exitX - TS) continue;              // сегмент із виходом — кінець шляху
    let best = null, bestDx = Infinity, near = null, nd = Infinity;
    for (const t of segs) {
      if (t === s || t.x1 <= s.x1) continue;       // ціль має вести далі праворуч
      const dx = gapX(s, t);
      const dy = s.top - t.top;                    // + вгору, - вниз (падати можна завжди)
      if (dx < nd) { nd = dx; near = t; }
      if (dx <= LIMIT_X && dy <= LIMIT_Y && dx < bestDx) { bestDx = dx; best = t; }
    }
    if (!best && near) {
      problems.push({ kind: 'розрив', tx: s.tx + s.w, ty: s.ty,
                      needX: Math.round(nd), needY: Math.round(s.top - near.top) });
    }
  }
  // 2. Острови: сегмент, на який нізвідки застрибнути.
  for (const s of segs) {
    if (s.ty >= H - 4 && s.x0 <= TS * 2) continue;
    let ok = false;
    for (const t of segs) {
      if (t === s) continue;
      const dx = gapX(s, t);
      const dy = t.top - s.top;                    // з t на s: підйом = t.top - s.top
      if (dx <= LIMIT_X && dy <= LIMIT_Y) { ok = true; break; }
    }
    if (!ok) problems.push({ kind: 'острів', tx: s.tx, ty: s.ty, needX: 0, needY: 0 });
  }
  return { segs: segs.length, problems };
}

let bad = 0;
console.log('ПЕРЕВІРКА РОЗРИВІВ (планка: %d px по горизонталі, %d px угору)\n', LIMIT_X, LIMIT_Y);
LEVELS.forEach((lv, i) => {
  const r = analyze(lv);
  if (!r.problems.length) {
    console.log('  Рівень %d — OK  («%s», поверхонь %d)', i + 1, lv.n, r.segs);
  } else {
    bad++;
    for (const p of r.problems.slice(0, 6)) {
      if (p.kind === 'розрив')
        console.log('  Рівень %d — розрив на тайлі (%d,%d): потрібно %d px, доступно %d px%s',
          i + 1, p.tx, p.ty, p.needX, LIMIT_X,
          p.needY > LIMIT_Y ? ('; підйом ' + p.needY + ' px при межі ' + LIMIT_Y) : '');
      else
        console.log('  Рівень %d — острів на тайлі (%d,%d): немає поверхні в межах стрибка',
          i + 1, p.tx, p.ty);
    }
  }
});
console.log('\n' + (bad === 0 ? 'УСІ 10 РІВНІВ ПРОХОДЯТЬ ГЕОМЕТРИЧНУ ПЕРЕВІРКУ'
                              : 'РІВНІВ ІЗ ПРОБЛЕМАМИ: ' + bad));
process.exit(bad === 0 ? 0 : 1);
