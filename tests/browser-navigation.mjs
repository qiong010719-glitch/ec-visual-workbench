import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {merchantFixture} from './merchant-fixture.mjs';

const f=await merchantFixture(),output=path.resolve('tests/results/navigation');
fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.addInitScript(()=>{
  for(const key of ['aplus_newbie_tour_v1','hyrule_result_tour_done','hyrule_veteran'])localStorage.setItem(key,'true');
  // Observe every painted frame, including the time before the local session returns.
  window.loginPaints=[];
  function watch(){const el=document.getElementById('authOverlay');if(el&&el.getBoundingClientRect().height&&getComputedStyle(el).visibility!=='hidden')window.loginPaints.push(performance.now());requestAnimationFrame(watch);}
  requestAnimationFrame(watch);
});
const page=await context.newPage(),errors=[],measurements=[];
page.on('pageerror',error=>errors.push(error.message));
const bounds=()=>page.locator('.workbench-nav a').evaluateAll(links=>links.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
let releaseSession;
const delayedSession=new Promise(resolve=>releaseSession=resolve);
try{
  await page.route('**/api/session',async route=>{await delayedSession;await route.continue();});
  await page.goto(f.base+'/temu',{waitUntil:'domcontentloaded'});
  assert.equal(await page.evaluate(()=>localStorage.getItem('hyrule_terminal_auth')),null);
  assert.equal(await page.locator('#authOverlay').isVisible(),false);
  const coldBounds=await bounds();
  await page.screenshot({path:path.join(output,'cold-design.png')});
  releaseSession();
  await page.waitForFunction(()=>localStorage.getItem('hyrule_terminal_auth')==='GRANTED');
  assert.deepEqual(await bounds(),coldBounds,'session completion must not move navigation');
  assert.deepEqual(await page.evaluate(()=>window.loginPaints),[],'old login must never be painted');
  for(const width of [1440,1024,390]){
    await page.setViewportSize({width,height:1000});
    const reference=await bounds();
    for(const route of ['/temu/listings','/settings','/temu','/settings','/temu']){
      await page.locator(`.workbench-nav a[href="${route}"]`).click();
      await page.waitForURL(f.base+route);await page.waitForLoadState('load');
      await page.locator(`.workbench-nav a[href="${route}"][aria-current="page"]`).waitFor();
      assert.equal(await page.locator('.workbench-nav [aria-current]').count(),1);
      const actual=await bounds();measurements.push({width,route,bounds:actual});
      assert.deepEqual(actual,reference,`navigation position differs: ${width} ${route}`);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'horizontal overflow');
      await page.evaluate(()=>window.scrollTo({top:500,behavior:'instant'}));
      assert.deepEqual(await bounds(),reference,'navigation must stay visible while scrolling');
      if(route==='/temu')assert.deepEqual(await page.evaluate(()=>window.loginPaints),[]);
      if(width===1440)await page.screenshot({path:path.join(output,route.replaceAll('/','-').slice(1)+'.png')});
    }
    await page.reload();assert.deepEqual(await bounds(),reference,'reload must preserve layout');
    assert.deepEqual(await page.evaluate(()=>window.loginPaints),[]);
  }
  // The design-only controls still open their own panels after moving out of global navigation.
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'模式详情',exact:true}).click();assert.equal(await page.locator('#modeSelectionModal').isVisible(),true);
  await page.keyboard.press('Escape');
  assert.deepEqual(errors,[]);assert.equal(f.writes.length,0);
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,checks:['cold load with delayed session','no painted login frames','three-route navigation','scroll','reload','desktop and narrow layouts','design mode control'],measurements,errors,realErpWrites:0},null,2));
  console.log('Navigation checks passed: stable coordinates on three routes at 1440/1024/390px; no old login painted.');
}catch(error){await page.screenshot({path:path.join(output,'failure.png')});throw error;}
finally{releaseSession();await browser.close();await f.close();}
