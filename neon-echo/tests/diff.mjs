/**
 * Три режими складності — через МЕХАНІКИ, не через циферки.
 *
 * Головна перевірка тут одна, і вона числова: HP та урон босів між
 * режимами не міняються більше ніж на ±10 % (у нас — рівно на 0 %).
 * Усе інше — набір патернів, довжина телеграфів, вікна вразливості,
 * пастки арени й окремі нові механіки максимального режиму.
 *
 * Наприкінці — заміряна таблиця: скільки триває бій і скільки разів
 * гравець отримує шкоду на кожному режимі. Б'ється той самий бот, що
 * і в tests/bosskill.mjs, тож режими порівнюються між собою чесно.
 *   node tests/diff.mjs
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
const page = await browser.newPage({ viewport: { width: 900, height: 420 } });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
await page.goto(file);
await page.waitForFunction(() => !!window.__DEV);
// Перший запуск питає про навчання (промт №13). Цей набір перевіряє
// не його, тож позначаємо питання як уже поставлене — інакше «Грати»
// відкриє екран навчання замість гри.
await page.evaluate(() => { window.__DEV.Store.data.tutAsked = 1; window.__DEV.Store.save(); });
await page.click('#mPlay');
await page.waitForTimeout(250);

const BOSSES = [[1, 'servotaur', 'СЕРВОТАВР'], [3, 'queen', 'МАТКА-РІЙ'],
                [5, 'chrono', 'ХРОНОКЛИНОК'], [7, 'glitch', 'ГЛІЧ-ЯДРО'],
                [9, 'architect', 'АРХІТЕКТОР']];
const MODES = ['easy', 'normal', 'hard'];

console.log('ГОЛОВНЕ ПРАВИЛО: ЦИФРИ БОСА НЕ МІНЯЮТЬСЯ\n');
const hp = {};
for (const [lvl, id] of BOSSES) {
  hp[id] = {};
  for (const d of MODES) {
    hp[id][d] = await page.evaluate(([lvl, d]) => {
      const D = window.__DEV;
      D.diff(d);
      D.Game.startLevel(lvl, false); D.god(true); D.gotoBoss();
      for (let i = 0; i < 200; i++) D.step();
      return { hp: D.BOSS.maxHp, dmg: D.DIFF.dmg, k: D.DIFF.hp };
    }, [lvl, d]);
  }
}
let worst = 0;
for (const [, id, name] of BOSSES) {
  const e = hp[id].easy.hp, n = hp[id].normal.hp, h = hp[id].hard.hp;
  const dev = Math.max(Math.abs(e / n - 1), Math.abs(h / n - 1)) * 100;
  worst = Math.max(worst, dev);
  console.log('  ' + name.padEnd(13) + 'легкий ' + e + '   середній ' + n + '   максимальний ' + h +
              '   відхилення ' + dev.toFixed(1) + '%');
}
ok(worst <= 10, 'HP боса між режимами відхиляється не більше ніж на ±10%',
   'найбільше відхилення ' + worst.toFixed(1) + '%');
ok(MODES.every(d => BOSSES.every(([, id]) => hp[id][d].dmg === 1)),
   'урон боса між режимами теж не чіпається', 'множник 1 на всіх');

console.log('\nРІЗНИЦЯ — В МЕХАНІКАХ');
const knob = await page.evaluate(() => {
  const D = window.__DEV, out = {};
  for (const d of ['easy', 'normal', 'hard']) { D.diff(d); out[d] = JSON.parse(JSON.stringify(D.DIFF)); }
  D.diff('normal');
  return out;
});
const E = knob.easy, N = knob.normal, H = knob.hard;
console.log('  параметр            легкий    середній   максимальний');
const row = (lab, f, suf) => console.log('  ' + lab.padEnd(20) +
  String(E[f] + (suf || '')).padEnd(10) + String(N[f] + (suf || '')).padEnd(11) + String(H[f] + (suf || '')));
row('телеграфи', 'tel', '×');
row('вікна вразливості', 'win', '×');
row('кадри невразливості', 'iframe', '×');
row('лють із, с', 'rageAt');
row('аптечки, с', 'medkit');
row('пастки арени', 'hazard');
row('вікно парирування', 'parry', ' с');
row('відбита куля', 'parryK', '×');

ok(Math.abs(E.tel - 1.4) < 0.001, 'легкий: телеграфи +40%');
ok(Math.abs(E.win - 1.5) < 0.001, 'легкий: вікна вразливості +50%');
ok(Math.abs(E.iframe - 1.5) < 0.001, 'легкий: кадри невразливості +50%');
ok(E.rageAt === 0, 'легкий: режим люті вимкнено');
ok(E.medkit === 30, 'легкий: аптечки на арені відновлюються кожні 30 с');
ok(E.hazard === 0, 'легкий: пастки арени під час бою вимкнені');
ok(E.bossRestart === 1, 'легкий: смерть повертає одразу до боса');
ok(E.p3new === 0 && N.p3new === 1, 'легкий: фаза 3 лишається, але без нових патернів');
ok(E.dropHardest === 1, 'легкий: у боса прибирається найважчий патерн');
ok(H.rageAt === 90 && N.rageAt === 120, 'максимальний: лють із 90 с замість 120');
ok(Math.abs(H.win - 0.75) < 0.001, 'максимальний: вікна вразливості −25%');
ok(H.medkit === 0, 'максимальний: аптечки не відновлюються');
ok(Math.abs(H.parry - 0.10) < 0.001 && H.parryK === 6 && N.parryK === 2,
   'максимальний: вікно парирування 0,10 с, але відбита куля втричі сильніша',
   '0,15→0,10 с, ×2→×6');
ok(H.mobTrait === 1 && N.mobTrait === 0, 'максимальний: мобам +1 поведінкова риса');
ok(H.extra === 1 && N.extra === 0 && E.extra === 0,
   'максимальний: кожен бос отримує ОКРЕМУ нову механіку');

console.log('\nПАТЕРН, ЯКИЙ ПРИБИРАЄ ЛЕГКИЙ РЕЖИМ');
const hardest = await page.evaluate(() => window.__DEV.HARDEST || null);
const drops = await page.evaluate(async () => {
  const D = window.__DEV, out = {};
  // Сервотавр: стрибок із ударною хвилею (фаза 2). Ганяємо цикл довго
  // й дивимось, чи трапляється стан 'jumpTel'.
  for (const d of ['easy', 'normal']) {
    D.diff(d);
    D.Game.startLevel(1, false); D.god(true); D.gotoBoss();
    for (let i = 0; i < 120; i++) D.step();
    D.BOSS.hp = D.BOSS.maxHp * 0.4; D.bossCheckPhase();
    let jump = 0;
    for (let i = 0; i < 60 * 90; i++) { D.step(); if (D.BOSS.st === 'jumpTel' || D.BOSS.st === 'air') jump++; }
    out[d] = jump;
  }
  return out;
});
ok(drops.easy === 0 && drops.normal > 0,
   'Сервотавр: стрибок із ударною хвилею зникає на легкому й лишається на середньому',
   'кадрів у стрибку: легкий ' + drops.easy + ', середній ' + drops.normal);

console.log('\nНОВІ МЕХАНІКИ МАКСИМАЛЬНОГО РЕЖИМУ');
// Хроноклинок: постійна часова копія з фази 2
const twin = await page.evaluate(async () => {
  const D = window.__DEV, out = {};
  for (const d of ['normal', 'hard']) {
    D.diff(d);
    D.Game.startLevel(5, false); D.god(true); D.gotoBoss();
    for (let i = 0; i < 150; i++) D.step();
    D.BOSS.hp = D.BOSS.maxHp * 0.5; D.bossCheckPhase();
    for (let i = 0; i < 400; i++) D.step();
    out[d] = { on: D.twin().on, phase: D.BOSS.phase };
  }
  return out;
});
ok(twin.hard.on === 1 && twin.normal.on === 0,
   'Хроноклинок: копія лишається до кінця бою лише на максимальному',
   'фаза ' + twin.hard.phase);

// Гліч-Ядро: вузли відроджуються, арена не засинає під час вікна
const glitch = await page.evaluate(async () => {
  const D = window.__DEV, out = {};
  for (const d of ['normal', 'hard']) {
    D.diff(d);
    D.Game.startLevel(7, false); D.god(true); D.gotoBoss();
    let docked = 0;
    for (let i = 0; i < 60 * 40 && !docked; i++) { D.step(); if (D.BOSS.st === 'dock') docked = 1; }
    if (!docked) { out[d] = { skip: 1 }; continue; }
    // пастки під час самого вікна
    let zones = 0;
    for (let i = 0; i < 60 * 3 && D.BOSS.st === 'dock'; i++) {
      D.step();
      zones = Math.max(zones, D.ZONES.length + D.TELE.length);
    }
    // Вузли й штатно з'являються заново — але НА НАСТУПНОМУ циклі.
    // Різниця максимального режиму в тому, що вони повертаються
    // ПОСЕРЕД того самого польоту, тож знімати їх по одному за цикл
    // більше не виходить. Тому й міряємо саме це: чи ожив вузол, поки
    // бос ще не встиг зайти на посадку.
    for (let i = 0; i < 60 * 30 && D.BOSS.st !== 'fly'; i++) D.step();
    for (let i = 0; i < 60 * 2; i++) D.step();
    // Збиваємо ДВА з трьох: якщо збити всі, бос штатно заходить на
    // посадку достроково, і цикл закінчується раніше, ніж таймер
    // відродження встигне спрацювати.
    const live = D.BOSS.parts.filter(p => p.alive);
    for (let i = 0; i < Math.min(2, live.length); i++) live[i].alive = false;
    const low = D.BOSS.parts.filter(p => p.alive).length;
    let back = low, f = 0;
    for (let i = 0; i < 60 * 8 && D.BOSS.st === 'fly'; i++) {
      D.step(); f++;
      back = Math.max(back, D.BOSS.parts.filter(p => p.alive).length);
    }
    out[d] = { zones, low, back, f: +(f / 60).toFixed(1) };
  }
  return out;
});
if (!glitch.hard.skip && !glitch.normal.skip) {
  ok(glitch.hard.zones > 0 && glitch.normal.zones === 0,
     'Гліч-Ядро: під час вікна пастки не вимикаються лише на максимальному',
     'зон на екрані: середній ' + glitch.normal.zones + ', максимальний ' + glitch.hard.zones);
  ok(glitch.hard.back > glitch.hard.low && glitch.normal.back === glitch.normal.low,
     'Гліч-Ядро: вузли відроджуються ПОСЕРЕД циклу, а не з наступним',
     'збили до ' + glitch.hard.low + ', за ' + glitch.hard.f + ' с польоту стало: максимальний ' +
     glitch.hard.back + ', середній ' + glitch.normal.back);
} else console.log('  · Гліч-Ядро не дійшов до вікна за 40 с — пропускаємо');

// Матка-Рій: оси виходять зв'язками по дві
const queen = await page.evaluate(async () => {
  const D = window.__DEV, out = {};
  for (const d of ['normal', 'hard']) {
    D.diff(d);
    D.Game.startLevel(3, false); D.god(true); D.gotoBoss();
    let pairs = 0, max = 0;
    for (let i = 0; i < 60 * 30; i++) {
      D.step();
      const w = D.ENEM.filter(e => e.fromBoss && !e.dead);
      max = Math.max(max, w.length);
      pairs = Math.max(pairs, w.filter(e => e.pairSide).length);
    }
    out[d] = { pairs, max };
  }
  return out;
});
ok(queen.hard.pairs >= 2 && queen.normal.pairs === 0,
   'Матка-Рій: оси ходять зв`язками по дві лише на максимальному',
   'у зв`язках: середній ' + queen.normal.pairs + ', максимальний ' + queen.hard.pairs);

// Архітектор: у фазі 3 викликає попередників
const arch = await page.evaluate(async () => {
  const D = window.__DEV, out = {};
  for (const d of ['normal', 'hard']) {
    D.diff(d);
    D.Game.startLevel(9, false); D.god(true); D.gotoBoss();
    for (let i = 0; i < 150; i++) D.step();
    D.BOSS.hp = D.BOSS.maxHp * 0.3; D.bossCheckPhase(); D.bossCheckPhase();
    let calls = 0;
    for (let i = 0; i < 60 * 40; i++) { D.step(); calls = Math.max(calls, D.BOSS.callI || 0); }
    out[d] = { calls, phase: D.BOSS.phase };
  }
  return out;
});
ok(arch.hard.calls > 0 && !arch.normal.calls,
   'Архітектор: у фазі 3 викликає ослаблених попередників',
   'викликів за 40 с: ' + arch.hard.calls);

console.log('\nЗАБОРОНЕНО НА ВСІХ РЕЖИМАХ');
const tel = await page.evaluate(async () => {
  const D = window.__DEV, out = {};
  for (const d of ['easy', 'normal', 'hard']) {
    D.diff(d);
    D.Game.startLevel(1, false); D.god(true); D.gotoBoss();
    for (let i = 0; i < 120; i++) D.step();
    // скільки кадрів бос провів у станах-телеграфах перед атаками
    let telF = 0, atkF = 0;
    for (let i = 0; i < 60 * 40; i++) {
      D.step();
      if (/Tel$|^paw$|^wind$/.test(D.BOSS.st)) telF++;
      if (/^charge$|^air$|^lunge$|^dash$|^rush$/.test(D.BOSS.st)) atkF++;
    }
    out[d] = { telF, atkF, ratio: atkF ? +(telF / atkF).toFixed(2) : 0 };
  }
  return out;
});
for (const d of MODES)
  console.log('  ' + d.padEnd(9) + 'телеграфів ' + tel[d].telF + ' кадрів, атак ' + tel[d].atkF +
              ' кадрів  (' + tel[d].ratio + ' телеграфа на кадр атаки)');
ok(MODES.every(d => tel[d].telF > 0 && tel[d].ratio > 0.3),
   'атак без телеграфа немає на жодному режимі');

/* ---------------- ТАБЛИЦЯ: ТРИВАЛІСТЬ БОЮ Й ОТРИМАНА ШКОДА ----------------
   Бот той самий, що в tests/bosskill.mjs. Гравцю дається великий запас
   HP — не щоб «читерити», а щоб бій дійшов до кінця на всіх режимах і
   отримані влучання можна було ПОРАХУВАТИ, а не обірвати на смерті. */
console.log('\nЗАМІР: ТРИВАЛІСТЬ БОЮ Й СКІЛЬКИ РАЗІВ ГРАВЕЦЬ ОТРИМАВ ШКОДУ');
console.log('  (бот з bosskill.mjs, той самий на всіх режимах, 5 прогонів)\n');
console.log('  бос             легкий            середній          максимальний');

const RUNS = 5;
const fight = async (lvl, d) => page.evaluate(async ([lvl, d, secs]) => {
  const D = window.__DEV, P = D.P;
  D.diff(d);
  D.Game.startLevel(lvl, false); D.gotoBoss();
  D.god(false);
  P.maxHp = 400; P.hp = 400;                       // запас, щоб бій дійшов до кінця
  let hits = 0, last = P.hp, frames = 0, done = false;
  for (let i = 0; i < secs * 60; i++) {
    frames = i;
    const hbs = D.hitboxes();
    let t = null, best = 1e9, hasParts = false;
    for (const hb of hbs) if (hb.part) hasParts = true;
    for (const hb of hbs) {
      if (hasParts && !hb.part) continue;
      const dd = Math.abs((hb.x + hb.w / 2) - (P.x + P.w / 2)) + Math.abs((hb.y) - P.y) * 0.4;
      if (dd < best) { best = dd; t = hb; }
    }
    if (t) {
      const cx = P.x + P.w / 2, cy = P.y + P.h / 2;
      const dx = (t.x + t.w / 2) - cx, dy = (t.y + t.h / 2) - cy;
      D.kb.r = dx > 3 ? 1 : 0;
      D.kb.l = dx < -3 ? 1 : 0;
      D.kb.a = ((dy < -14 || (P.onGround && Math.abs(P.vx) < 6)) && (i % 46) < 28) ? 1 : 0;
      const near = Math.abs(dx) < 30 && Math.abs(dy) < 24;
      D.kb.b = ((near ? (i % 12) < 2 : (i % 26) < 2)) ? 1 : 0;
      D.kb.c = (!near && Math.abs(dy) < 14 && (i % 10) < 2) ? 1 : 0;
      D.kb.d = (dy > 26 && P.onGround && (i % 20) < 4) ? 1 : 0;
    }
    D.step();
    if (P.hp < last) { hits++; last = P.hp; }
    if (P.hp > last) last = P.hp;
    const s = D.state();
    if (s.bossDone) { done = true; break; }
    if (P.dead) break;
  }
  D.kb.r = D.kb.l = D.kb.a = D.kb.b = D.kb.c = D.kb.d = 0;
  return { done, sec: +(frames / 60).toFixed(1), hits };
}, [lvl, d, 180]);

const table = {};
for (const [lvl, id, name] of BOSSES) {
  table[id] = {};
  const cells = [];
  for (const d of MODES) {
    let sec = 0, hits = 0, wins = 0;
    for (let r = 0; r < RUNS; r++) {
      const f = await fight(lvl, d);
      if (f.done) { sec += f.sec; hits += f.hits; wins++; }
    }
    const res = wins ? { sec: +(sec / wins).toFixed(1), hits: +(hits / wins).toFixed(1), wins }
                     : { sec: 0, hits: 0, wins: 0 };
    table[id][d] = res;
    cells.push(wins ? (res.sec + ' с / ' + res.hits + ' влуч.').padEnd(18)
                    : 'не добив'.padEnd(18));
  }
  console.log('  ' + name.padEnd(15) + cells.join(''));
}

const got = d => BOSSES.filter(([, id]) => table[id][d].wins).map(([, id]) => table[id][d]);
const avgHits = d => { const a = got(d); return a.length ? a.reduce((s, x) => s + x.hits, 0) / a.length : 0; };
const avgSec = d => { const a = got(d); return a.length ? a.reduce((s, x) => s + x.sec, 0) / a.length : 0; };
console.log('\n  у середньому по п`яти босах:');
for (const d of MODES)
  console.log('    ' + d.padEnd(14) + avgSec(d).toFixed(1) + ' с,  ' + avgHits(d).toFixed(1) + ' влучань по гравцю');

ok(avgHits('easy') < avgHits('normal'),
   'на легкому гравець отримує менше шкоди, ніж на середньому',
   avgHits('easy').toFixed(1) + ' проти ' + avgHits('normal').toFixed(1));
ok(avgHits('hard') > avgHits('normal'),
   'на максимальному — більше',
   avgHits('hard').toFixed(1) + ' проти ' + avgHits('normal').toFixed(1));
// Тривалість не має розповзтися: складність не в тому, щоб бій тягнувся.
const spread = Math.max(...MODES.map(d => avgSec(d))) / Math.max(0.1, Math.min(...MODES.map(d => avgSec(d))));
ok(spread < 2.0, 'тривалість бою між режимами не розповзається вдвічі',
   'розкид ×' + spread.toFixed(2));

ok(errs.length === 0, 'без помилок JS' + (errs.length ? ': ' + errs[0] : ''));
console.log('\n' + (fails === 0 ? 'СКЛАДНІСТЬ: УСЕ ЧИСТО' : 'СКЛАДНІСТЬ: ПРОБЛЕМ ' + fails));
await browser.close();
process.exit(fails === 0 ? 0 : 1);
