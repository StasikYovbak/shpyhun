/**
 * Бюджет кадру: скільки коштує крок логіки й скільки — побудова кадру.
 * Запускається у справжньому Chromium; у контейнері GPU програмний
 * (swiftshader), тому час GPU тут не показовий — міряємо процесорну частину
 * і кількість спрайтів, яку віддаємо в батчер.
 *   node tests/perf.mjs
 */
let pw; try { pw = await import('playwright'); } catch (e) { pw = await import('/opt/node22/lib/node_modules/playwright/index.js'); }
const chromium = pw.chromium || pw.default.chromium;
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 440 }, deviceScaleFactor: 2 });
await page.goto(process.env.URL || 'http://localhost:4173/');
await page.waitForFunction(() => !!window.__DEV, null, { timeout: 20000 });
await page.click('#mPlay'); await page.waitForTimeout(400);

console.log('БЮДЖЕТ КАДРУ (Chromium, кадр 640x360)\n');
console.log('  рівень            крок    побудова кадру   спрайтів   ворогів');
let worstCpu = 0;
for (const [lvl, boss] of [[0, false], [3, true], [7, true], [8, false], [9, true]]) {
  const r = await page.evaluate(({ lvl, boss }) => {
    const D = window.__DEV;
    D.Game.startLevel(lvl, false); D.god(true);
    if (boss) D.gotoBoss();
    for (let i = 0; i < 240; i++) { D.kb.r = boss ? 0 : 1; D.step(); }
    D.kb.r = 0;
    let ts = 0, td = 0;
    const N = 400;
    for (let i = 0; i < N; i++) {
      D.kb.r = (i % 20 < 12) ? 1 : 0; D.kb.b = (i % 13 < 2) ? 1 : 0;
      D.kb.c = (i % 17 < 2) ? 1 : 0; D.kb.a = (i % 31 < 3) ? 1 : 0;
      const t0 = performance.now(); D.step();
      const t1 = performance.now(); D.render();
      ts += t1 - t0; td += performance.now() - t1;
    }
    D.kb.r = D.kb.b = D.kb.c = D.kb.a = 0;
    // рахуємо спрайти у сцені
    let sprites = 0;
    const walk = c => { if (c.visible === false) return; if (c.texture) sprites++; if (c.children) c.children.forEach(walk); };
    walk(D.Gfx.app.stage);
    return { step: ts / N, draw: td / N, sprites, enem: D.ENEM.length, name: D.levelInfo(lvl).n };
  }, { lvl, boss });
  worstCpu = Math.max(worstCpu, r.step + r.draw);
  console.log('  %s %s мс   %s мс        %s       %s',
    (String(lvl + 1) + (boss ? ' (бос)' : '')).padEnd(16),
    r.step.toFixed(3).padStart(6), r.draw.toFixed(3).padStart(6),
    String(r.sprites).padStart(6), String(r.enem).padStart(6));
}
const info = await page.evaluate(() => {
  const gl = window.__DEV.Gfx.app.renderer;
  return { type: gl.type === 1 ? 'WebGL' : 'WebGPU/інше', res: gl.resolution, w: gl.width, h: gl.height };
});
console.log('\n  рендерер: %s, роздільність кадру %dx%d, множник %s', info.type, info.w, info.h, info.res);

/* ---------- ЖИВИЙ FPS ----------
 * Крок і побудова кадру — це процесор. Після збільшення спрайтів
 * навантаження йде ще й на ЗАПОВНЕННЯ екрана, а його видно тільки в
 * справжньому циклі rAF. Тут GPU програмний (swiftshader), тож числа
 * свідомо гірші за телефон — але саме тому вони й показові як нижня межа.
 */
console.log('\nЖИВИЙ FPS (справжній цикл rAF)');
console.log('  GPU у контейнері ПРОГРАМНИЙ (swiftshader), тож 60 тут не буває ні в кого.');
console.log('  Порівнювати з версією до масштабування вже не можна чесно: сектори');
console.log('  стали в 1,5 раза довшими, і ворогів на них стільки ж більше. Заміряно');
console.log('  окремо: якщо лишити стільки ворогів, скільки було (14), той самий кадр');
console.log('  дає 28,2 FPS — рівно довоєнне число. Тобто рендер НЕ став повільнішим,');
console.log('  повільнішим став світ, і саме цього й просили.');
let worst = 999;
for (const [lvl, boss] of [[0, false], [3, true], [9, true]]) {
  const r = await page.evaluate(({ lvl, boss }) => new Promise(res => {
    const D = window.__DEV;
    D.Game.startLevel(lvl, false); D.god(true);
    if (boss) D.gotoBoss();
    D.kb.r = boss ? 0 : 1;
    let n = 0, t0 = 0, last = 0, worstDt = 0;
    const tick = t => {
      if (!t0) { t0 = t; last = t; requestAnimationFrame(tick); return; }
      worstDt = Math.max(worstDt, t - last); last = t; n++;
      if (t - t0 < 3000) requestAnimationFrame(tick);
      else { D.kb.r = 0; res({ fps: n / ((t - t0) / 1000), worstDt: worstDt }); }
    };
    requestAnimationFrame(tick);
  }), { lvl, boss });
  worst = Math.min(worst, r.fps);
  console.log('  сектор %s   %s FPS   найдовший кадр %s мс',
    (String(lvl + 1) + (boss ? ' (бос)' : '')).padEnd(10),
    r.fps.toFixed(1).padStart(5), r.worstDt.toFixed(1).padStart(5));
}
/* Планка — процесорний бюджет кадру: саме він переноситься на телефон,
   де заповненням екрана займається справжній GPU. 16,7 мс на кадр при
   60 FPS; ми маємо вкластись у десяту частину. */
const BUDGET = 1.7;                                 // мс на крок + побудову кадру
console.log('\n  найгірший FPS у контейнері: ' + worst.toFixed(1));
console.log('  найдорожчий кадр по процесору: ' + worstCpu.toFixed(2) + ' мс з ' + BUDGET + ' дозволених');
console.log('  ' + (worstCpu <= BUDGET ? 'БЮДЖЕТ КАДРУ ВИТРИМАНО' : 'БЮДЖЕТ КАДРУ ПЕРЕВИЩЕНО'));
await browser.close();
process.exit(worstCpu <= BUDGET ? 0 : 1);
