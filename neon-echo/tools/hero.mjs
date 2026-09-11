/**
 * ГЕРОЇНЯ ЕХО — ЗБИРАЄТЬСЯ ЗІ СКЕЛЕТА, А НЕ МАЛЮЄТЬСЯ СІТКОЮ
 *
 * На 24x30 вже є де малювати, але 50 поз намальованих крапками ніхто
 * ніколи не виправить. Тому тут не сітки, а ФІГУРА: голова, тулуб,
 * дві руки й дві ноги з координатами суглобів. Поза — це набір точок,
 * а біг — узагалі формула ходи, тож вісім кадрів беруться самі й
 * виходять плавними, а не «десь приблизно».
 *
 * Матеріалів п'ять, у кожного ПО ШІСТЬ ТОНІВ (було по чотири): тінь,
 * напівтінь, база, світло, відблиск, контур. Саме тони роблять фігуру
 * об'ємною — без них вона лишається плоскою аплікацією, хоч 24, хоч 64.
 * Світло падає згори-зліва, неон підсвічує правий край.
 */

/* ---------------------------------------------------------- ПАЛІТРА */
export const PAL_HERO = {
  // шкіра
  '1': '#7a4a38', '2': '#a9694a', '3': '#cf8d68', '4': '#f7c9a6', '5': '#ffdfc6', '6': '#fff2e6',
  // куртка
  'q': '#150a22', 'w': '#2a1140', 'e': '#3f1b60', 'r': '#5b238c', 't': '#7c3fb4', 'y': '#a068d8',
  // хром протеза
  'a': '#2b3346', 's': '#4d5870', 'd': '#7f8ba3', 'f': '#b3bfd0', 'g': '#dde6f0', 'h': '#ffffff',
  // волосся
  'z': '#5e0d33', 'x': '#9c1550', 'c': '#d42070', 'v': '#ff2e88', 'b': '#ff79b4', 'n': '#ffc4dd',
  // візор і очі крізь нього
  'j': '#07323f', 'k': '#128fa8', 'l': '#22e0ff', 'm': '#7df9ff', 'o': '#d8f7ff',
  // черевики
  'p': '#080410', 'i': '#140a20', 'u': '#2c1b40',
  // шарф
  'A': '#8e0f36', 'B': '#c4174c', 'C': '#ff3a6e', 'D': '#ff8aa8',
  // пошкодження: іскри протеза й подряпини
  'E': '#ffd23f', 'F': '#ff6b3d'
};
/** Фантом — той самий скелет у примарній палітрі. */
export const PAL_PHANTOM = (() => {
  const map = { '1': '#0b3a33', '2': '#11564b', '3': '#1d7d6c', '4': '#6ef7d8', '5': '#a9ffe9', '6': '#e6fff8',
                'q': '#02110f', 'w': '#04211d', 'e': '#073028', 'r': '#0b4a3c', 't': '#116b56', 'y': '#1b9a7c',
                'a': '#093029', 's': '#0f4a3e', 'd': '#1a7a64', 'f': '#41b79b', 'g': '#9ceedb', 'h': '#ffffff',
                'z': '#04231e', 'x': '#08453a', 'c': '#0d6b57', 'v': '#1f8f7a', 'b': '#5cc7b0', 'n': '#b6f0e3',
                'j': '#031b19', 'k': '#0a5e52', 'l': '#7ce8d3', 'm': '#bafff0', 'o': '#ffffff',
                'p': '#010a09', 'i': '#031512', 'u': '#07261f',
                'A': '#05302a', 'B': '#0a5a4c', 'C': '#13907a', 'D': '#5fcfb6',
                'E': '#bafff0', 'F': '#6ef7d8' };
  return map;
})();

/* ------------------------------------------------------ ПРИМІТИВИ */
const W = 24, H = 30;
const grid = () => Array.from({ length: H }, () => Array(W).fill('.'));
const put = (g, x, y, c) => {
  x = Math.round(x); y = Math.round(y);
  if (y < 0 || y >= H || x < 0 || x >= W || !c) return;
  g[y][x] = c;
};
const box = (g, x, y, w, h, c) => {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(g, x + i, y + j, c);
};
/**
 * Кінцівка як товста лінія між двома суглобами, із власним об'ємом:
 * верхній край світлий, нижній — тінь. Саме через це рука виглядає
 * круглою, а не смужкою.
 */
function limb(g, x0, y0, x1, y1, th, tone) {
  const [dark, base, lite] = tone;
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
    for (let k = 0; k < th; k++) {
      const off = k - (th - 1) / 2;
      const vertical = Math.abs(y1 - y0) >= Math.abs(x1 - x0);
      const px = vertical ? x + off : x, py = vertical ? y : y + off;
      put(g, px, py, k === 0 ? lite : (k === th - 1 ? dark : base));
    }
  }
}
const SKIN  = ['2', '3', '4'];
const COAT  = ['w', 'r', 't'];
const SLEEVE = ['q', 'e', 'y'];      // рукав темніший за корпус — рука читається
const CHROME = ['a', 'd', 'f'];
const BOOT  = ['p', 'i', 'u'];

/* ------------------------------------------------------------ ЧАСТИНИ */
/** Голова: волосся, обличчя в шість тонів, візор і ОЧІ крізь нього. */
function head(g, o) {
  const hx = 7 + (o.hx || 0), hy = 1 + (o.hy || 0);
  if (o.back) {                                    // спиною до камери — саме волосся
    box(g, hx, hy, 10, 9, 'c');
    box(g, hx + 1, hy, 8, 2, 'v');
    box(g, hx + 2, hy + 1, 4, 1, 'b');
    box(g, hx, hy + 7, 10, 3, 'x');
    box(g, hx + 3, hy + 9, 4, 2, 'z');
    return;
  }
  box(g, hx + 1, hy, 8, 2, 'c');                   // шапка волосся
  box(g, hx + 2, hy, 5, 1, 'v');
  box(g, hx + 3, hy, 2, 1, 'b');
  box(g, hx, hy + 1, 2, 4, 'x');                   // пасма з боків
  box(g, hx + 8, hy + 1, 2, 5, 'x');
  box(g, hx + 9, hy + 2, 1, 3, 'c');
  box(g, hx + 1, hy + 2, 8, 7, '3');               // обличчя
  box(g, hx + 2, hy + 2, 6, 5, '4');
  box(g, hx + 3, hy + 3, 4, 2, '5');
  box(g, hx + 5, hy + 3, 2, 1, '6');               // відблиск на вилиці
  box(g, hx + 2, hy + 7, 6, 1, '3');               // щелепа вужча за череп
  box(g, hx + 3, hy + 8, 4, 1, '2');               // шия
  put(g, hx + 3, hy + 8, '1'); put(g, hx + 6, hy + 8, '1');
  // візор і очі крізь нього: темніші плями всередині світла
  box(g, hx + 1, hy + 4, 8, 2, 'l');
  box(g, hx + 1, hy + 4, 8, 1, 'm');
  box(g, hx + 8, hy + 4, 1, 2, 'o');
  if (!o.blink) {
    put(g, hx + 3, hy + 5, 'j'); put(g, hx + 6, hy + 5, 'j');
    put(g, hx + 3, hy + 4, 'k'); put(g, hx + 6, hy + 4, 'k');
  } else box(g, hx + 2, hy + 5, 6, 1, 'k');
  if (o.hurt) { put(g, hx + 2, hy + 6, '1'); put(g, hx + 7, hy + 6, '1'); }
  // пасмо, що падає на лице — саме воно робить силует упізнаваним
  put(g, hx + 2, hy + 2, 'v'); put(g, hx + 2, hy + 3, 'c');
  put(g, hx + 3, hy + 4, 'x');
}
/** Тулуб: куртка зі складками, комір, пояс. */
function torso(g, o) {
  let tx = 8 + (o.tx || 0), ty = 10 + (o.ty || 0), th = 11 + (o.th || 0), tw = 8;
  if (o.turn) { tx += 2; tw = 5; }                 // розворот корпусу: плечі ребром
  box(g, tx, ty, tw, th, 'r');
  box(g, tx, ty, 2, th, 'e');                      // тіньовий бік
  box(g, tx + tw - 2, ty, 2, th, 't');             // неоновий край
  box(g, tx + tw - 1, ty + 1, 1, th - 3, 'y');
  box(g, tx, ty, tw, 1, 'w');                      // комір
  box(g, tx + 1, ty, tw - 2, 1, 'e');
  // складки: дві діагональні тіні по корпусу
  for (let i = 0; i < Math.min(4, tw - 3); i++) {
    put(g, tx + 2 + i, ty + 3 + i, 'e'); put(g, tx + 1 + i, ty + 6 + i, 'q');
  }
  box(g, tx, ty + th - 3, tw, 1, 'q');             // пояс
  box(g, tx + Math.floor(tw / 2) - 1, ty + th - 3, 2, 1, 'd');   // пряжка
  if (o.dmg) {                                     // подряпини на куртці — видно, що добивають
    put(g, tx + 1, ty + 2, 'q'); put(g, tx + 2, ty + 3, 'q');
    put(g, tx + 5, ty + 5, 'q'); put(g, tx + 6, ty + 6, 'q');
    put(g, tx + 2, ty + 7, 'F');
  }
}
/** Рука. right=true — хромований протез із швами й підсвіткою. */
function arm(g, o, right, j) {
  const tone = right ? CHROME : SLEEVE;
  const sx = (right ? 15 : 8) + (o.tx || 0), sy = 12 + (o.ty || 0);
  const ex = sx + j[0], ey = sy + j[1], hx = sx + j[2], hy = sy + j[3];
  limb(g, sx, sy, ex, ey, 3, tone);
  limb(g, ex, ey, hx, hy, right ? 3 : 2, tone);
  if (right) {
    put(g, ex, ey, 'g');                           // шов у лікті
    put(g, hx, hy, 'g'); put(g, hx, hy + 1, 'f');
    put(g, Math.round((sx + ex) / 2), Math.round((sy + ey) / 2), 'h');  // підсвітка пластини
    if (o.palm) {                                  // долоня розкривається віялом
      put(g, hx + 1, hy - 2, 'g'); put(g, hx + 2, hy - 1, 'f');
      put(g, hx + 2, hy + 1, 'f'); put(g, hx + 1, hy + 2, 'g');
      put(g, hx + 2, hy, 'h');
    }
    if (o.dmg) put(g, ex + 1, ey, 'E');            // іскра з протеза
  } else { put(g, hx, hy, '4'); put(g, hx, hy + 1, '3'); }
}
/** Нога зі стопою; k — зсув стегна й коліна. */
function leg(g, o, j) {
  const hx = 11 + (o.tx || 0) + j[0], hy = 20 + (o.ty || 0);
  const kx = hx + j[1], ky = hy + j[2], fx = hx + j[3], fy = hy + j[4];
  limb(g, hx, hy, kx, ky, 3, COAT);
  limb(g, kx, ky, fx, fy, 3, BOOT);
  box(g, fx - 2, fy, 4, 2, 'i');                   // черевик
  box(g, fx - 2, fy + 1, 4, 1, 'p');
  put(g, fx - 2, fy, 'u'); put(g, fx + 1, fy, 'u');   // текстура халяви
}

/* ------------------------------------------------------------- ПОЗИ */
const base = () => ({ hx: 0, hy: 0, tx: 0, ty: 0, th: 0 });
/**
 * Збирає кадр. legs — пара наборів [dx, kdx, kdy, fdx, fdy];
 * armL/armR — [ldx, ldy, hdx, hdy] від плеча.
 */
export function frame(o) {
  const g = grid();
  const L = o.legs || [[-1, 0, 4, 0, 8], [2, 0, 4, 0, 8]];
  leg(g, o, L[0]); leg(g, o, L[1]);
  torso(g, o);
  arm(g, o, false, o.armL || [-1, 4, 0, 7]);
  arm(g, o, true, o.armR || [1, 4, 1, 7]);
  head(g, o);
  return g.map(r => r.join(''));
}
/** Хода: вісім кадрів беруться з формули, тому цикл виходить плавним. */
export function runFrame(i, n) {
  const ph = i / n * Math.PI * 2;
  const s = Math.sin(ph), c = Math.cos(ph);
  const o = base();
  o.ty = Math.round(Math.abs(c) * -1);             // корпус підстрибує
  o.hy = o.ty;
  o.legs = [
    [-1, Math.round(s * 3), 4, Math.round(s * 5), 8 - Math.round(Math.max(0, s) * 2)],
    [2, Math.round(-s * 3), 4, Math.round(-s * 5), 8 - Math.round(Math.max(0, -s) * 2)]
  ];
  o.armL = [-1 + Math.round(s * 2), 4, Math.round(s * 4), 7];
  o.armR = [1 - Math.round(s * 2), 4, 1 - Math.round(s * 4), 7];
  return frame(o);
}
export { base };

/* ================================================================
   ТАБЛИЦЯ ПОЗ
   Кожен рядок — це не сітка, а положення суглобів: [лікоть dx, dy,
   кисть dx, dy] для рук і [стегно dx, коліно dx, dy, стопа dx, dy]
   для ніг. Тому позу видно з коду й можна поправити одним числом.
   ================================================================ */
const ST = [[-1, 0, 4, 0, 8], [2, 0, 4, 0, 8]];         // стояча
const WIDE = [[-3, -1, 4, -2, 8], [4, 1, 4, 2, 8]];     // упор ногами
const STEP = [[-2, -2, 4, -3, 8], [3, 2, 4, 4, 8]];     // випад уперед
const KNEEL = [[-2, -1, 3, -1, 6], [3, 1, 3, 2, 6]];    // присід
const DOWN_L = [-1, 4, 0, 7], DOWN_R = [1, 4, 1, 7];    // руки вздовж тіла
const FWD_R = [3, 2, 6, 3], FWD_L = [2, 2, 5, 3];       // вперед на рівні грудей
const HIGH_R = [3, 0, 6, -1], LOW_R = [3, 4, 6, 6];
const UP_R = [1, -3, 2, -7], BACK_R = [-3, 3, -6, 5];
const TWO_R = [3, 2, 6, 2], TWO_L = [5, 1, 7, 2];       // обидві на зброї
const POINT_R = [3, -2, 7, -5];                         // вказує на ціль
const OPEN_R = [3, 2, 6, 3];

/** Усі пози гри: базові плюс по кадру атаки на кожну зброю. */
export function allPoses() {
  const P = {};
  const mk = (n, o) => { P[n] = frame(Object.assign(base(), o)); };

  /* --- базові --- */
  mk('idle',   {});
  mk('blink',  { blink: 1 });
  mk('jump',   { legs: [[-2, -2, 3, -3, 6], [3, 1, 3, 2, 7]], armL: [-2, 2, -4, -1], armR: [2, 2, 4, -1] });
  mk('fall',   { legs: [[-2, 1, 4, 1, 8], [3, -1, 4, -2, 7]], armL: [-3, 1, -5, -2], armR: [3, 1, 5, -2] });
  mk('land',   { ty: 3, hy: 3, th: -3, legs: KNEEL, armL: [-3, 2, -4, 4], armR: [3, 2, 4, 4] });
  mk('hurt',   { hurt: 1, tx: -1, hx: -1, armL: [-3, 1, -5, 3], armR: [3, 1, 5, 3] });
  mk('idle2a', { armR: [2, 2, 3, -1] });                 // поправляє протез
  mk('idle2b', { armR: [1, 1, 2, -3], hx: 1 });
  for (let i = 0; i < 8; i++) P['run' + (i + 1)] = runFrame(i, 8);

  /* --- АРК-ТЕСАК: замах через плече, три різні удари, третій з розворотом --- */
  mk('a_arcW',  { armR: UP_R, armL: [-1, 3, -1, 6] });
  mk('a_arcW2', { armR: BACK_R, armL: DOWN_L });
  mk('a_arc1',  { legs: STEP, armR: LOW_R, armL: [0, 3, 1, 5] });
  mk('a_arc2',  { legs: STEP, armR: HIGH_R, armL: [0, 3, 1, 5] });
  mk('a_arc3',  { turn: 1, tx: 1, hx: 1, legs: STEP, armR: [4, 1, 7, 1], armL: [1, 2, 3, 3] });
  mk('a_arcT',  { turn: 1, tx: 1, hx: 1, legs: ST, armR: [3, 4, 5, 7], armL: [0, 3, 1, 6] });
  mk('a_arcR',  { armR: LOW_R, armL: DOWN_L });

  /* --- ЕЛЕКТРОХЛИСТ: рука назад, розворот, широкий викид --- */
  mk('a_whip1', { tx: -1, hx: -1, armR: [-4, 2, -7, 4], armL: [-2, 3, -3, 6] });
  mk('a_whip2', { turn: 1, armR: [-2, 1, -4, -1], armL: [-1, 3, -2, 5] });
  mk('a_whip3', { legs: STEP, armR: [3, -2, 7, -4], armL: [1, 2, 2, 4] });

  /* --- ТАВРО: присід, важкий удар униз, віддача в плече --- */
  mk('a_brand1', { ty: 3, hy: 3, th: -3, legs: KNEEL, armR: UP_R, armL: [-2, 3, -3, 5] });
  mk('a_brand2', { ty: 3, hy: 3, th: -3, legs: KNEEL, armR: [4, 4, 7, 6], armL: [2, 3, 4, 5] });
  mk('a_brand3', { tx: -1, hx: -1, armR: [-1, -2, -2, -5], armL: [-2, 2, -3, 4] });

  /* --- ХРОНОРІЗ: низька стійка, випад, поява спиною до камери --- */
  mk('a_chron1', { ty: 3, hy: 3, th: -3, legs: KNEEL, armR: BACK_R, armL: [-2, 2, -3, 4] });
  mk('a_chron2', { legs: WIDE, armR: FWD_R, armL: [1, 2, 2, 4] });
  mk('a_chron3', { back: 1, armR: [-2, 3, -3, 6], armL: [2, 3, 3, 6] });
  mk('a_chron4', { armR: [3, 4, 5, 7], armL: DOWN_L });

  /* --- ПЛАЗМОВІ КІГТІ: короткі випади по черзі --- */
  mk('a_claw1', { armR: HIGH_R, armL: [-1, 3, -2, 6] });
  mk('a_claw2', { armR: LOW_R, armL: [1, 1, 2, 3] });
  mk('a_claw3', { armR: [2, 2, 3, 3], armL: [0, 2, 1, 4] });

  /* --- РЕЙКОСТРИЛ: упор ногою, приклад до плеча, відкид --- */
  mk('a_rail1', { legs: WIDE, armR: TWO_R, armL: TWO_L });
  mk('a_rail2', { legs: WIDE, armR: [4, 1, 7, 1], armL: [5, 1, 7, 2] });
  mk('a_rail3', { legs: WIDE, tx: -1, hx: -1, armR: [3, -1, 6, -2], armL: [4, 0, 6, 1] });

  /* --- «ОСА»: легка стійка однією рукою --- */
  mk('a_osa1', { armR: FWD_R, armL: DOWN_L });
  mk('a_osa2', { armR: [3, 1, 6, 1], armL: DOWN_L });
  mk('a_osa3', { armR: [3, 3, 6, 4], armL: DOWN_L });

  /* --- ДРОБОВИК: дві руки, сильний відкид, окремий кадр перезаряджання --- */
  mk('a_shot1', { armR: TWO_R, armL: TWO_L });
  mk('a_shot2', { tx: -2, hx: -2, legs: WIDE, armR: [3, -2, 6, -4], armL: [4, -1, 6, -2] });
  mk('a_shot3', { tx: -1, hx: -1, armR: [3, 0, 6, -1], armL: [4, 1, 6, 1] });
  mk('a_shotR', { armR: [3, 2, 6, 2], armL: [1, 3, 2, 4] });

  /* --- РІЙ: не стріляє, а вказує рукою --- */
  mk('a_swrm1', { armR: [2, 1, 4, 0], armL: DOWN_L });
  mk('a_swrm2', { armR: POINT_R, armL: DOWN_L });
  mk('a_swrm3', { armR: [3, -1, 6, -3], armL: DOWN_L });

  /* --- ГЛІЧ-КОД: рука-протез розкривається --- */
  mk('a_gl1', { armR: FWD_R, armL: DOWN_L });
  mk('a_gl2', { armR: OPEN_R, armL: DOWN_L, palm: 1 });
  mk('a_gl3', { armR: [3, 2, 5, 3], armL: DOWN_L });

  /* --- ЕХО-ПРИЗМА: дві руки, легкий розворот на спалаху --- */
  mk('a_pr1', { armR: TWO_R, armL: TWO_L });
  mk('a_pr2', { turn: 1, armR: [3, 0, 6, 0], armL: [4, 1, 6, 1] });
  mk('a_pr3', { armR: [3, 2, 6, 3], armL: DOWN_L });

  return P;
}
/**
 * Побитий вигляд для тих поз, у яких героїню видно найчастіше.
 * На двох серцях і менше вмикається саме цей набір: подряпини на
 * куртці й іскра з протеза. Стан здоров'я стає видно по персонажу,
 * а не лише по смужці вгорі екрана.
 */
export function damagedPoses() {
  const P = {};
  const mk = (n, o) => { P[n] = frame(Object.assign(base(), o, { dmg: 1 })); };
  mk('idle', {});
  mk('jump', { legs: [[-2, -2, 3, -3, 6], [3, 1, 3, 2, 7]], armL: [-2, 2, -4, -1], armR: [2, 2, 4, -1] });
  mk('fall', { legs: [[-2, 1, 4, 1, 8], [3, -1, 4, -2, 7]], armL: [-3, 1, -5, -2], armR: [3, 1, 5, -2] });
  mk('hurt', { hurt: 1, tx: -1, hx: -1, armL: [-3, 1, -5, 3], armR: [3, 1, 5, 3] });
  for (let i = 0; i < 8; i++) {
    const o = Object.assign(base(), { dmg: 1 });
    const r = runFrame(i, 8);                      // кадр ходи вже готовий...
    P['run' + (i + 1)] = r;                        // ...а подряпини кладемо поверх
  }
  for (let i = 0; i < 8; i++) {
    const ph = i / 8 * Math.PI * 2, s2 = Math.sin(ph), c2 = Math.cos(ph);
    const o = base();
    o.dmg = 1; o.ty = Math.round(Math.abs(c2) * -1); o.hy = o.ty;
    o.legs = [
      [-1, Math.round(s2 * 3), 4, Math.round(s2 * 5), 8 - Math.round(Math.max(0, s2) * 2)],
      [2, Math.round(-s2 * 3), 4, Math.round(-s2 * 5), 8 - Math.round(Math.max(0, -s2) * 2)]
    ];
    o.armL = [-1 + Math.round(s2 * 2), 4, Math.round(s2 * 4), 7];
    o.armR = [1 - Math.round(s2 * 2), 4, 1 - Math.round(s2 * 4), 7];
    P['run' + (i + 1)] = frame(o);
  }
  return P;
}
