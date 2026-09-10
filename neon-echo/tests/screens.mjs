/**
 * Перевірка масштабу на різних співвідношеннях сторін: який кадр вибирає
 * рендер і скільки екрана реально зайнято.
 *   node tests/screens.mjs
 */
let pw; try { pw = await import('playwright'); } catch (e) { pw = await import('/opt/node22/lib/node_modules/playwright/index.js'); }
const chromium = pw.chromium || pw.default.chromium;
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const CASES = [
  ['16:9   1280x720  dpr1', 1280, 720, 1],
  ['16:9   1920x1080 dpr2', 960, 540, 2],
  ['19.5:9 2340x1080 dpr3', 780, 360, 3],
  ['20:9   2400x1080 dpr3', 800, 360, 3],
  ['21:9   2712x1220 dpr2.75', 986, 444, 2.75],
  ['планшет 2000x1200 dpr2', 1000, 600, 2]
];
console.log('МАСШТАБ НА РІЗНИХ ЕКРАНАХ\n');
console.log('  екран                    кадр      масштаб  зайнято X  зайнято Y');
for (const [name, w, h, dpr] of CASES) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  await page.goto(process.env.URL || 'http://localhost:4173/');
  await page.waitForFunction(() => !!window.__DEV, null, { timeout: 20000 });
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const c = document.getElementById('game');
    const st = getComputedStyle(c);
    return {
      frameW: window.__DEV.Gfx.frameW,
      cssW: parseFloat(st.width), cssH: parseFloat(st.height),
      canvasW: c.width, canvasH: c.height,
      winW: window.innerWidth, winH: window.innerHeight,
      dpr: window.devicePixelRatio
    };
  });
  console.log('  %s  %s  x%s     %s%%      %s%%',
    name.padEnd(22), (r.frameW + 'x270').padEnd(8),
    String(Math.round(r.canvasW / r.frameW)),
    (r.cssW / r.winW * 100).toFixed(0).padStart(4),
    (r.cssH / r.winH * 100).toFixed(0).padStart(4));
  await page.close();
}
await browser.close();
