let pw; try { pw = await import('playwright'); } catch(e){ pw = await import('/opt/node22/lib/node_modules/playwright/index.js'); }
const chromium = pw.chromium || pw.default.chromium;
const D0='/tmp/claude-0/-home-user-shpyhun/4e977970-48e1-5f48-9b4a-e464efb9b235/scratchpad/';
const browser = await chromium.launch({ args:['--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport:{width:960,height:440}, deviceScaleFactor:2 });
const errs=[]; page.on('pageerror',e=>errs.push(e.message));
await page.goto('http://localhost:4173/');
await page.waitForFunction(()=>!!window.__DEV,null,{timeout:20000});
// Перший запуск питає про навчання — знімок робимо з гри, не з питання.
await page.evaluate(() => { window.__DEV.Store.data.tutAsked = 1; window.__DEV.Store.save(); });
await page.click('#mPlay'); await page.waitForTimeout(300);
const shots=[['lvl1',0,false,300],['metro',4,false,700],['taur',1,true,240],['glitch',7,true,900]];
for (const [name,lvl,boss,steps] of shots){
  await page.evaluate(({lvl,boss,steps})=>{
    const D=window.__DEV; D.Game.startLevel(lvl,false); D.god(true);
    if(boss) D.gotoBoss();
    for(let i=0;i<steps;i++){ D.kb.r = boss?0:1; D.step(); } D.kb.r=0;
  },{lvl,boss,steps});
  await page.waitForTimeout(500);
  await page.screenshot({path:D0+'px_'+name+'.png'});
}
console.log(errs.length?('ПОМИЛКИ: '+errs.slice(0,3).join(' | ')):'помилок немає');
await browser.close();
