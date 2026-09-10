let pw; try { pw = await import('playwright'); } catch(e){ pw = await import('/opt/node22/lib/node_modules/playwright/index.js'); }
const chromium = pw.chromium || pw.default.chromium;
const url = process.env.URL || 'http://localhost:4173/';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport:{width:960,height:440}, deviceScaleFactor:2 });
const errs=[]; page.on('pageerror',e=>errs.push('[pageerror] '+e.message));
page.on('console',m=>{ if(m.type()==='error' && !/GL Driver Message|GPU stall|WebGL-0x/i.test(m.text())) errs.push('[console] '+m.text()); });
await page.goto(url);
await page.waitForFunction(()=>!!window.__DEV, null, {timeout:20000}).catch(()=>{});
await page.waitForTimeout(800);
const ok = await page.evaluate(()=>!!window.__DEV);
console.log('__DEV доступний:', ok);
if (ok) {
  await page.click('#mPlay'); await page.waitForTimeout(400);
  await page.evaluate(()=>{ const D=window.__DEV; D.god(true); for(let i=0;i<240;i++){D.kb.r=1;D.step();} D.kb.r=0; });
  await page.waitForTimeout(600);
  console.log('стан:', JSON.stringify(await page.evaluate(()=>window.__DEV.state())));
}
await page.screenshot({path: process.env.OUT || '/tmp/claude-0/-home-user-shpyhun/4e977970-48e1-5f48-9b4a-e464efb9b235/scratchpad/pixi1.png'});
console.log(errs.length? 'ПОМИЛКИ:\n'+errs.slice(0,6).join('\n') : 'помилок немає');
await browser.close();
