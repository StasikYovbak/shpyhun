/**
 * Меню на трьох співвідношеннях екрана.
 *
 * Баг, який тут закритий: `.scr` був flex-контейнером із
 * `justify-content:center`, і при переповненні вміст виштовхувався ЗА
 * верхній край, куди неможливо прокрутити — `scrollTop:0` уже найвища
 * позиція. На скріншоті це виглядало як «рядки обрізані згори й знизу,
 * заголовка немає, кнопки Назад немає». Перевіряємо саме це: що верх
 * вмісту досяжний, шапка не їде, і жоден екран не ховає свій низ.
 *   node tests/menu.mjs
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

// 16:9, 19,5:9, 20:9 — і навмисно низький екран, де вміст точно не влазить
const SCREENS = [
  ['16:9',   { width: 800, height: 450 }],
  ['19,5:9', { width: 878, height: 405 }],
  ['20:9',   { width: 900, height: 405 }],
  ['низький', { width: 900, height: 300 }]
];
const TABS = ['ctl', 'gfx', 'snd', 'game', 'dev'];

console.log('НАЛАШТУВАННЯ: ШАПКА, ВКЛАДКИ, ПРОКРУТКА\n');

for (const [name, vp] of SCREENS) {
  const ctx = await browser.newContext({ viewport: vp, hasTouch: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(file);
  await page.waitForFunction(() => !!window.__DEV);
  await page.click('#mSet');
  await page.waitForTimeout(300);

  console.log(name + '  ' + vp.width + '×' + vp.height);

  const head = await page.evaluate(() => {
    const back = document.querySelector('#settings .back').getBoundingClientRect();
    const h2 = document.querySelector('#settings h2').getBoundingClientRect();
    const hd = document.querySelector('#settings .shead').getBoundingClientRect();
    const tabs = document.querySelectorAll('#sTabs button').length;
    return {
      backOk: back.top >= -0.5 && back.bottom <= window.innerHeight + 0.5 && back.width > 20,
      titleOk: h2.top >= -0.5 && h2.bottom <= window.innerHeight + 0.5 && h2.width > 20,
      headTop: Math.round(hd.top), tabs: tabs,
      dbg: (() => { const d = document.getElementById('btnDbg'); return d ? getComputedStyle(d).display : 'none'; })()
    };
  });
  ok(head.backOk, 'кнопка «← Назад» на екрані й не обрізана');
  ok(head.titleOk, 'заголовок розділу видно');
  ok(head.tabs === 5, 'п`ять вкладок категорій', head.tabs + ' шт.');
  ok(head.dbg === 'none', 'кнопка DBG не перекриває меню', 'display:' + head.dbg);

  // Головне: у кожній вкладці верх вмісту ДОСЯЖНИЙ, а низ — прокручуваний.
  let worstRow = 0, anyScroll = false, allReach = true, fadeOk = true;
  for (const t of TABS) {
    await page.click('#sTabs button[data-v="' + t + '"]');
    await page.waitForTimeout(120);
    const m = await page.evaluate(async () => {
      // Подія scroll приходить наступним тиком, тож між зсувом і зчитуванням
      // класу тіні треба дати браузеру видихнути — інакше міряємо минуле.
      const tick = () => new Promise(r => setTimeout(r, 40));
      const b = document.getElementById('sBody');
      const pane = document.querySelector('#settings .pane.on');
      const rows = [...pane.children].map(el => el.getBoundingClientRect().height);
      const bt = b.getBoundingClientRect().top;
      b.scrollTop = 0; await tick();
      const topAfter = pane.children[0].getBoundingClientRect().top;
      const fadeAtTop = document.getElementById('sFade').classList.contains('on');
      b.scrollTop = 1e6; await tick();
      const bottomAfter = pane.children[pane.children.length - 1].getBoundingClientRect().bottom;
      const fadeAtEnd = document.getElementById('sFade').classList.contains('on');
      b.scrollTop = 0; await tick();
      return {
        maxRow: Math.max(...rows),
        scrolls: b.scrollHeight > b.clientHeight,
        // верх першого рядка при scrollTop:0 має бути НЕ ВИЩЕ верху тіла
        topReach: topAfter >= bt - 1,
        bottomReach: bottomAfter <= b.getBoundingClientRect().bottom + 1,
        fadeAtEnd, fadeAtTop,
        cols: getComputedStyle(pane).gridTemplateColumns.split(' ').length
      };
    });
    worstRow = Math.max(worstRow, m.maxRow);
    if (m.scrolls) {
      anyScroll = true;
      if (!m.fadeAtTop || m.fadeAtEnd) fadeOk = false;   // тінь є зверху, нема на дні
    }
    if (!m.topReach || !m.bottomReach) allReach = false;
  }
  ok(allReach, 'у кожній вкладці досяжні і верх, і низ списку');
  ok(worstRow <= 56.5, 'жоден пункт не вищий за 56 px', 'найвищий ' + worstRow.toFixed(0) + ' px');
  if (anyScroll) ok(fadeOk, 'індикатор «нижче ще є» вмикається зверху й гасне на дні');
  else console.log('  · вміст влазить без прокрутки на всіх вкладках');

  const cols = await page.evaluate(() => getComputedStyle(document.querySelector('#settings .pane.on')).gridTemplateColumns.split(' ').length);
  ok(cols === 2, 'у горизонтальній орієнтації дві колонки', cols + ' кол.');

  // Пам'ять прокрутки: гортаємо вкладку, йдемо в іншу й вертаємось.
  const mem = await page.evaluate(async () => {
    const b = document.getElementById('sBody');
    const tab = v => document.querySelector('#sTabs button[data-v="' + v + '"]').click();
    tab('gfx'); await new Promise(r => setTimeout(r, 80));
    b.scrollTop = 1e6;
    const want = b.scrollTop;
    tab('snd'); await new Promise(r => setTimeout(r, 80));
    tab('gfx'); await new Promise(r => setTimeout(r, 120));
    return { want, got: b.scrollTop };
  });
  ok(Math.abs(mem.want - mem.got) < 2, 'позиція прокрутки вкладки запам`ятовується',
     mem.want.toFixed(0) + ' → ' + mem.got.toFixed(0));

  ok(errs.length === 0, 'без помилок JS' + (errs.length ? ': ' + errs[0] : ''));
  console.log('');
  await ctx.close();
}

/* ---- решта екранів: чи все влазить і чи все прокручується ---- */
console.log('РЕШТА ЕКРАНІВ');
{
  const ctx = await browser.newContext({ viewport: { width: 900, height: 300 }, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(file);
  await page.waitForFunction(() => !!window.__DEV);
  const check = async (id, open) => {
    await page.evaluate(open);
    await page.waitForTimeout(250);
    const m = await page.evaluate(id => {
      const s = document.getElementById(id);
      const inner = s.querySelector('.inner') || s.querySelector('.sbody');
      if (!inner) return { skip: true };
      s.scrollTop = 0;
      const r = inner.getBoundingClientRect(), sr = s.getBoundingClientRect();
      // верх вмісту не має бути вище верху екрана при scrollTop:0
      const topOk = r.top >= sr.top - 1;
      s.scrollTop = 1e6;
      const r2 = inner.getBoundingClientRect();
      const botOk = r2.bottom <= sr.bottom + 1;
      return { topOk, botOk, h: Math.round(r.height), view: Math.round(sr.height) };
    }, id);
    if (m.skip) { console.log('  · ' + id + ': власна розмітка, пропускаємо'); return; }
    ok(m.topOk && m.botOk, id + ': вміст досяжний повністю',
       m.h + ' px вмісту у вікні ' + m.view + ' px');
  };
  await check('levels', () => { window.__DEV.Game.backTo = 'menu'; document.getElementById('mLevels').click(); });
  await check('about', () => document.getElementById('mAbout').click());
  await check('pause', () => { window.__DEV.Game.startLevel(0, false); window.__DEV.Game.pause(); });
  await check('inv', () => { document.getElementById('pInv').click(); });
  await check('menu', () => window.__DEV.Game.toMenu());
  await ctx.close();
}

console.log('\n' + (fails === 0 ? 'МЕНЮ: УСЕ ЧИСТО' : 'МЕНЮ: ПРОБЛЕМ ' + fails));
await browser.close();
process.exit(fails === 0 ? 0 : 1);
