/**
 * Саундтрек на Tone.js: чи стартує контекст після дотику, чи грають
 * усі десять треків, чи перемикаються адаптивні шари, чи діє мікшер,
 * ducking і пауза при згортанні.
 *   node tests/music.mjs
 */
let pw; try { pw = await import('playwright'); } catch (e) { pw = await import('/opt/node22/lib/node_modules/playwright/index.js'); }
const chromium = pw.chromium || pw.default.chromium;
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 900, height: 420 }, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto(process.env.URL || 'http://localhost:4173/');
await page.waitForFunction(() => !!window.__DEV, null, { timeout: 20000 });

let fails = 0;
const ok = (c, m, extra) => { if (!c) { fails++; console.log('  ✗ ' + m + (extra ? '  → ' + extra : '')); }
                              else console.log('  ✓ ' + m + (extra ? '  (' + extra + ')' : '')); };

console.log('САУНДТРЕК\n');
const before = await page.evaluate(() => window.__DEV.audioState());
ok(before === 'none' || before === 'suspended', 'до дотику аудіоконтекст не створено', String(before));
await page.mouse.click(450, 210);
await page.waitForTimeout(700);
const after = await page.evaluate(() => window.__DEV.audioState());
ok(after === 'running', 'після дотику контекст стартує', String(after));

const list = await page.evaluate(() => window.__DEV.tracks());
ok(list.length === 10, 'десять треків у списку', String(list.length));
console.log('    ' + list.map(t => t.title + ' ' + t.bpm).join(' · '));

// кожен трек має завантажуватись і давати секвенції
const loadAll = await page.evaluate(async () => {
  const M = window.__DEV.Music, out = [];
  for (const id of window.__DEV.trackIds()) {
    M.setTrack(id);
    await new Promise(r => setTimeout(r, 40));
    out.push({ id, cur: M.trackId, title: M.title });
  }
  return out;
});
ok(loadAll.every(r => r.cur === r.id), 'кожен трек вмикається без помилок',
   loadAll.filter(r => r.cur !== r.id).map(r => r.id).join(',') || 'усі 10');

// адаптивні шари
await page.evaluate(() => { const D = window.__DEV; D.Music.setTrack('rust'); D.Music.start(); });
const layers = await page.evaluate(async () => {
  const M = window.__DEV.Music, out = [];
  for (const n of [0, 1, 2, 3, 1]) {
    M.layer(n);
    await new Promise(r => setTimeout(r, 2600));    // чекаємо межу такту (такт ~2 с)
    out.push({ want: n, got: M.intensity, gains: window.__DEV.layerGains() });
  }
  return out;
});
for (const l of layers)
  console.log('    шар ' + l.want + ' → рівень ' + l.got + '  гейни ' + l.gains.map(g => g.toFixed(2)).join('/'));
ok(layers.every(l => l.got === l.want), 'шари перемикаються на межі такту',
   layers.map(l => l.want + '→' + l.got).join(' '));
ok(layers[0].gains[1] < 0.1 && layers[3].gains[3] > 0.5,
   'на шарі 0 ударних нема, на шарі 3 — драйв увімкнено',
   'шар0 drums=' + layers[0].gains[1].toFixed(2) + ', шар3 drive=' + layers[3].gains[3].toFixed(2));

// мікшер і ducking
const mix = await page.evaluate(async () => {
  const D = window.__DEV, out = {};
  D.Store.data.mus = 100; D.Music.setVol();
  await new Promise(r => setTimeout(r, 350));
  out.full = D.busGain();
  D.Music.duck(1.0);
  await new Promise(r => setTimeout(r, 300));
  out.ducked = D.busGain();
  D.Store.data.mus = 0; D.Music.setVol();
  await new Promise(r => setTimeout(r, 350));
  out.muted = D.busGain();
  D.Store.data.mus = 50; D.Music.setVol();
  return out;
});
ok(mix.ducked < mix.full * 0.85 && mix.ducked > mix.full * 0.6,
   'ducking приглушує музику приблизно на чверть',
   mix.full.toFixed(3) + ' → ' + mix.ducked.toFixed(3));
ok(mix.muted < 0.001, 'повзунок музики на 0% глушить повністю', mix.muted.toFixed(4));

// чи справді звучить
const rms = await page.evaluate(async () => {
  const D = window.__DEV;
  D.Store.data.mus = 80; D.Music.setVol();
  D.Music.setTrack('rust'); D.Music.layer(2); D.Music.start();
  await new Promise(r => setTimeout(r, 1200));
  let peak = -Infinity;
  for (let i = 0; i < 40; i++) { peak = Math.max(peak, D.musicMeter()); await new Promise(r => setTimeout(r, 40)); }
  return peak;
});
ok(rms > -60 && rms < 0, 'на шині є сигнал і він не кліпує', rms.toFixed(1) + ' dBFS');

// пауза при згортанні
const bg = await page.evaluate(async () => {
  const D = window.__DEV;
  D.Music.start();
  await new Promise(r => setTimeout(r, 300));
  const on = D.transportState();
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
  await new Promise(r => setTimeout(r, 600));
  const off = D.transportState();
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  document.dispatchEvent(new Event('visibilitychange'));
  await new Promise(r => setTimeout(r, 600));
  return { on, off, back: D.transportState() };
});
ok(bg.on === 'started' && bg.off === 'paused', 'згортання ставить музику на паузу',
   bg.on + ' → ' + bg.off + ' → ' + bg.back);

if (errors.length) { console.log('\nПОМИЛКИ JS: ' + errors.slice(0, 5).join(' | ')); fails += errors.length; }
console.log('\n' + (fails === 0 ? 'МУЗИКА: УСЕ ЧИСТО' : 'ПРОБЛЕМ: ' + fails));
await browser.close();
process.exit(fails === 0 ? 0 : 1);
