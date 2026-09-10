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

console.log('БЮДЖЕТ КАДРУ (Chromium, кадр 528x270)\n');
console.log('  рівень            крок    побудова кадру   спрайтів   ворогів');
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
await browser.close();
