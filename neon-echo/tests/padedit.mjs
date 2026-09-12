/**
 * Редактор розкладки: кожна кнопка окремо.
 *
 * Перевіряємо не «панель відкрилась», а що зміна ОДНОГО елемента
 * справді міняє рівно його: геометрію в грі, а не тільки підпис у
 * панелі. Плюс захист від кривих розкладок, профілі, пресети й
 * експорт/імпорт рядком.
 *   node tests/padedit.mjs
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
const cdp = await ctx.newCDPSession(page);

const geo = () => page.evaluate(() => {
  const g = window.__DEV.Input.geo, out = {};
  for (const k of Object.keys(g))
    out[k] = { x: g[k].x, y: g[k].y, w: g[k].w, h: g[k].h, op: g[k].op,
               hide: g[k].hide, vib: g[k].vib, shape: g[k].shape };
  return out;
});
const open = async () => {
  await page.evaluate(() => { window.__DEV.Game.toMenu(); });
  await page.click('#mSet'); await page.waitForTimeout(150);
  await page.click('#sCtrl'); await page.waitForTimeout(300);
};
const tap = async (x, y) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 7 }] });
  await page.waitForTimeout(90);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(200);
};

await open();

console.log('ВІСІМ ЕЛЕМЕНТІВ, КОЖЕН ОКРЕМО\n');
const g0 = await geo();
const KEYS = ['L', 'R', 'A', 'B', 'C', 'D', 'pause', 'dbg'];
ok(KEYS.every(k => g0[k]), 'у розкладці всі вісім елементів: ' + KEYS.join(', '),
   Object.keys(g0).length + ' шт.');
ok(new Set(KEYS.map(k => Math.round(g0[k].x) + ',' + Math.round(g0[k].y))).size === 8,
   'у кожного власна позиція');

// --- ВИБІР ТАПОМ ---
await tap(g0.A.x, g0.A.y);
const sel = await page.evaluate(() => ({
  open: !document.getElementById('cPanel').hidden,
  name: document.getElementById('cSel').textContent,
  marked: document.getElementById('btnA').classList.contains('sel')
}));
ok(sel.open && /A/.test(sel.name), 'тап по кнопці відкриває панель саме для неї', sel.name);
ok(sel.marked, 'вибраний елемент підсвічено в грі');

// панель не має накривати саме ту кнопку, яку налаштовують
const cover = await page.evaluate(() => {
  const p = document.getElementById('cPanel').getBoundingClientRect();
  const g = window.__DEV.Input.geo.A;
  return !(g.x + g.w / 2 > p.left && g.x - g.w / 2 < p.right &&
           g.y + g.h / 2 > p.top && g.y - g.h / 2 < p.bottom);
});
ok(cover, 'панель параметрів не накриває кнопку, яку налаштовують');

console.log('\nПАРАМЕТРИ МІНЯЮТЬ РІВНО ОДИН ЕЛЕМЕНТ');
// --- РОЗМІР 60..200 % ---
const setRange = async (id, v) => {
  await page.evaluate(([id, v]) => {
    const el = document.getElementById(id);
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, [id, v]);
  await page.waitForTimeout(150);
};
await setRange('eSize', 200);
let g = await geo();
ok(Math.abs(g.A.w / g0.A.w - 2) < 0.02, 'розмір 200 % подвоює саме A',
   g0.A.w.toFixed(0) + ' → ' + g.A.w.toFixed(0) + ' px');
ok(Math.abs(g.B.w - g0.B.w) < 0.5 && Math.abs(g.C.w - g0.C.w) < 0.5,
   'B і C не змінились', 'B ' + g.B.w.toFixed(0) + ', C ' + g.C.w.toFixed(0));
await setRange('eSize', 60);
g = await geo();
ok(Math.abs(g.A.w / g0.A.w - 0.6) < 0.02, 'нижня межа повзунка — 60 %', g.A.w.toFixed(0) + ' px');
await setRange('eSize', 100);

// --- ПРОЗОРІСТЬ 20..100 % ---
await setRange('eOp', 20);
g = await geo();
ok(Math.abs(g.A.op - 0.2) < 0.01 && Math.abs(g.B.op - g0.B.op) < 0.01,
   'прозорість 20 % лягає лише на A', 'A ' + g.A.op.toFixed(2) + ', B ' + g.B.op.toFixed(2));
await setRange('eOp', 55);

// --- ФОРМА / ПІДПИС / ВІБРАЦІЯ / ВИДИМІСТЬ ---
const seg = async (id, v) => {
  await page.click('#' + id + ' button[data-v="' + v + '"]');
  await page.waitForTimeout(180);
};
await seg('eShape', 'square');
g = await geo();
const radius = await page.evaluate(() => getComputedStyle(document.getElementById('btnA')).borderRadius);
ok(g.A.shape === 'square' && !/50%/.test(radius), 'форма перемикається на квадрат', radius);
await seg('eShape', 'round');

await seg('eLab', '0');
const cap = await page.evaluate(() => ({
  a: document.getElementById('btnA').classList.contains('nocap'),
  b: document.getElementById('btnB').classList.contains('nocap')
}));
ok(cap.a && !cap.b, 'підпис ховається лише в A');
await seg('eLab', '1');

await seg('eVib', '0');
g = await geo();
ok(g.A.vib === 0 && g.B.vib === 1, 'вібрація вимикається поелементно');
await seg('eVib', '1');

await seg('eHide', '1');
g = await geo();
const domHidden = await page.evaluate(() => document.getElementById('btnA').style.display);
ok(g.A.hide === 1 && domHidden === 'none', 'кнопку можна сховати зовсім');
// схована кнопка не має ловити дотик у грі
const dead = await page.evaluate(() => {
  const D = window.__DEV;
  D.Game.startLevel(0, false);
  const g = D.Input.geo.A;
  return { x: g.x, y: g.y };
});
await page.evaluate(() => window.__DEV.Input.enable(true));
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: dead.x, y: dead.y, id: 9 }] });
await page.waitForTimeout(120);
const pressed = await page.evaluate(() => { window.__DEV.Input.step(); return window.__DEV.S.a; });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
ok(pressed === false, 'схована кнопка не ловить дотик', 'A=' + pressed);
await open();
await tap((await geo()).B.x, (await geo()).B.y);            // вибрати B, щоб A лишилась схованою
await page.evaluate(() => { window.__DEV.Pad.resetElem('A'); window.__DEV.Input.layout(); });
await page.waitForTimeout(150);
g = await geo();
ok(g.A.hide === 0 && Math.abs(g.A.w - g0.A.w) < 0.5, '«скинути цю» повертає елемент до стандарту');

console.log('\nПОЗИЦІЯ: ПЕРЕТЯГУВАННЯ, СІТКА 8 px, МЕЖІ');
await open();
const before = await geo();
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: before.C.x, y: before.C.y, id: 11 }] });
await page.waitForTimeout(80);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 430, y: 200, id: 11 }] });
await page.waitForTimeout(150);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(200);
g = await geo();
ok(Math.abs(g.C.x - 430) < 10 && Math.abs(g.C.y - 200) < 10, 'кнопка переїхала за пальцем',
   Math.round(g.C.x) + '×' + Math.round(g.C.y));
ok(Math.abs(g.A.x - before.A.x) < 0.5 && Math.abs(g.B.x - before.B.x) < 0.5,
   'сусідні кнопки лишились на місці');
ok(Math.round(g.C.x) % 8 === 0 || Math.round(g.C.x + g.C.w / 2) % 8 === 0,
   'позиція прилипає до сітки 8 px', 'x=' + g.C.x);
// за край не викидається
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: g.C.x, y: g.C.y, id: 12 }] });
await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: -400, y: -400, id: 12 }] });
await page.waitForTimeout(150);
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
g = await geo();
ok(g.C.x - g.C.w / 2 >= -0.5 && g.C.y - g.C.h / 2 >= -0.5,
   'за межі екрана кнопку не викинути', Math.round(g.C.x) + '×' + Math.round(g.C.y));

console.log('\nЗАХИСТ ВІД КРИВОЇ РОЗКЛАДКИ');
const badN = await page.evaluate(() => {
  const D = window.__DEV;
  // кладемо C рівно на A
  const a = D.Input.geo.A;
  const c = D.Pad.el('C');
  c.x = (a.x - 0) / window.innerWidth; c.y = a.y / window.innerHeight;
  D.Input.layout();
  return [...D.Input.bad()];
});
await page.waitForTimeout(200);
const warn = await page.evaluate(() => ({
  shown: !document.getElementById('cWarn').hidden,
  redA: document.getElementById('btnA').classList.contains('bad'),
  redC: document.getElementById('btnC').classList.contains('bad')
}));
ok(badN.includes('A') && badN.includes('C'), 'перекриття помічено', '[' + badN.join(',') + ']');
ok(warn.shown && warn.redA && warn.redC, 'обидві кнопки червоні й показано попередження');
// зберегти можна, але з підтвердженням: перший «Назад» лише попереджає
await page.click('#cDone'); await page.waitForTimeout(250);
const still = await page.evaluate(() => document.getElementById('controls').classList.contains('on'));
ok(still, 'перший тап «Назад» не випускає, а просить підтвердити');
await page.click('#cDone'); await page.waitForTimeout(250);
const left = await page.evaluate(() => document.getElementById('settings').classList.contains('on'));
ok(left, 'другий тап зберігає криву розкладку — вибір за гравцем');

console.log('\nПРОФІЛІ, ПРЕСЕТИ, ЕКСПОРТ');
await open();
const prof = await page.evaluate(() => {
  const D = window.__DEV;
  D.Pad.resetProfile(); D.Input.layout();
  const w1 = D.Input.geo.A.w;
  D.Input.profile(1);
  D.Pad.el('A').s = 180; D.Input.layout();
  const w2 = D.Input.geo.A.w;
  D.Input.profile(0);
  const w3 = D.Input.geo.A.w;
  return { n: D.Pad.state.profs.length, w1, w2, w3 };
});
ok(prof.n === 3, 'три слоти профілів', prof.n);
ok(prof.w2 > prof.w1 && Math.abs(prof.w3 - prof.w1) < 0.5,
   'профілі не течуть один в одного',
   'П1 ' + prof.w1.toFixed(0) + ', П2 ' + prof.w2.toFixed(0) + ', назад ' + prof.w3.toFixed(0));

const pres = await page.evaluate(() => {
  const D = window.__DEV, out = {};
  for (const id of ['standard', 'lefty', 'big', 'minimal']) {
    D.Input.preset(id);
    out[id] = { a: Math.round(D.Input.geo.A.w), lx: Math.round(D.Input.geo.L.x),
                op: +D.Input.geo.A.op.toFixed(2), hand: D.Pad.hand };
  }
  D.Input.preset('standard');
  return out;
});
ok(Object.keys(pres).length === 4, 'чотири готові пресети');
ok(pres.big.a > pres.standard.a, '«Великі кнопки» справді більші',
   pres.standard.a + ' → ' + pres.big.a + ' px');
ok(pres.minimal.op < pres.standard.op, '«Мінімалізм» тьмяніший',
   pres.standard.op + ' → ' + pres.minimal.op);
ok(pres.lefty.hand === 1 && pres.lefty.lx > pres.standard.lx,
   '«Для лівші» переносить стрілки на інший бік',
   'x стрілки ' + pres.standard.lx + ' → ' + pres.lefty.lx);

const exp = await page.evaluate(() => {
  const D = window.__DEV;
  D.Pad.resetProfile();
  D.Pad.el('A').s = 175; D.Pad.el('D').hide = 1; D.Pad.el('B').shape = 'square';
  D.Input.layout();
  const str = D.Pad.exportStr();
  D.Pad.resetProfile(); D.Input.layout();
  const beforeW = D.Input.geo.A.w;
  const okImp = D.Pad.importStr(str);
  D.Input.layout();
  return { str, okImp, beforeW, a: D.Input.geo.A.w, d: D.Input.geo.D.hide, b: D.Input.geo.B.shape,
           junk: D.Pad.importStr('це не розкладка') };
});
ok(/^ECHO1:/.test(exp.str), 'експорт дає один рядок', exp.str.slice(0, 26) + '…');
ok(exp.okImp && exp.a > exp.beforeW && exp.d === 1 && exp.b === 'square',
   'імпорт повертає розмір, сховану кнопку й форму',
   'A ' + exp.beforeW.toFixed(0) + ' → ' + exp.a.toFixed(0) + ' px');
ok(exp.junk === false, 'сміттєвий рядок відхиляється без падіння');

console.log('\nЗБЕРІГАННЯ ОКРЕМО ВІД ПРОГРЕСУ');
const keys = await page.evaluate(() => {
  const D = window.__DEV;
  D.Pad.el('A').s = 165; D.Pad.save();
  const padRaw = localStorage.getItem('echo_neon_courier_pad_v1');
  D.Store.clear();                                   // скидання прогресу
  D.Pad.load(); D.Input.layout();
  return { hasPad: !!padRaw, inSave: /"el"/.test(localStorage.getItem(D.SAVE_KEY) || ''),
           sizeAfter: D.Pad.el('A').s, unlocked: D.Store.data.unlocked };
});
ok(keys.hasPad, 'розкладка живе у власному ключі localStorage');
ok(!keys.inSave, 'у слоті прогресу її немає');
ok(keys.sizeAfter === 165 && keys.unlocked === 1,
   '«скинути прогрес» не чіпає розкладку', 'розмір A лишився ' + keys.sizeAfter + '%');

console.log('\nТЕСТОВА ЗОНА');
await open();
await page.click('#cTest'); await page.waitForTimeout(250);
const gg = await geo();
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: gg.B.x, y: gg.B.y, id: 21 }] });
await page.waitForTimeout(150);
const test = await page.evaluate(() => ({
  lit: document.getElementById('btnB').classList.contains('hit'),
  game: window.__DEV.S.b
}));
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
ok(test.lit, 'у тестовій зоні кнопка блимає на дотик');
ok(test.game === false, '...але в гру ввід не йде', 'S.b=' + test.game);

ok(errs.length === 0, 'без помилок JS' + (errs.length ? ': ' + errs[0] : ''));
console.log('\n' + (fails === 0 ? 'РЕДАКТОР: УСЕ ЧИСТО' : 'РЕДАКТОР: ПРОБЛЕМ ' + fails));
await browser.close();
process.exit(fails === 0 ? 0 : 1);
