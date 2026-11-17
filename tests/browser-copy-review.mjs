import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {copyReviewFixture,repeatedHeadline} from './copy-review-fixture.mjs';

let release;const gate=new Promise(r=>release=r);let calls=0;
const f=await copyReviewFixture({copyRewriter:async(g,targets)=>{
  calls++;if(calls===1)await gate;
  return targets.map(t=>({setId:t.setId,slot:t.slot,headline:calls<=2?repeatedHeadline:t.setIndex===2?'Inspect the Canvas Details':'Explore the Artwork Up Close'}));
}});
const output=path.resolve('tests/results/copy-review');fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.addInitScript(id=>localStorage.setItem('merchant-active-batch',id),f.batch.id);
try{
  await f.api(f.route+'/plan',{});
  await page.goto(f.base+'/temu/listings');
  await page.waitForFunction(()=>document.querySelector('#generationState')?.textContent==='检查并修正重复文案中');
  assert.equal(await page.locator('#generateBatch').isDisabled(),true);
  await page.screenshot({path:path.join(output,'01-checking.png'),fullPage:true});
  release();await page.waitForFunction(()=>document.querySelector('#generationState')?.textContent==='需要处理');
  assert.equal(await page.locator('#generateBatch').isDisabled(),true);
  assert.match(await page.locator('#batchProducts').innerText(),/第 1 套.*卖点图1.*第 2 套/);
  assert.equal(await page.locator('#planBatch').innerText(),'重试重复文案修正');
  await page.screenshot({path:path.join(output,'02-exact-error.png'),fullPage:true});
  await page.locator('#batchProducts a').first().click();
  await page.locator('[data-action="repair-copy"]').waitFor();
  assert.equal(await page.locator('#msGenerateAll').isDisabled(),true);
  assert.match(await page.locator('#msGroup').innerText(),/第 1 套.*卖点图1.*第 2 套/);
  await page.click('[data-action="repair-copy"]');
  await page.waitForFunction(()=>document.querySelector('#msGroup')?.textContent.includes('全部方案检查通过'));
  assert.equal(await page.locator('#msGenerateAll').isEnabled(),true);
  await page.screenshot({path:path.join(output,'03-repaired.png'),fullPage:true});
  await page.goto(f.base+'/temu/listings');
  await page.locator('#planBatch:not([disabled])').waitFor();await page.click('#planBatch');
  await page.waitForFunction(()=>document.querySelector('#generationState')?.textContent==='方案与标题已就绪');
  assert.equal(await page.locator('#generateBatch').isEnabled(),true);assert.equal(calls,3);
  assert.deepEqual(errors,[]);assert.equal(f.writes.length,0);
  assert.equal(Object.keys(f.app.store.state.tasks).filter(k=>k.startsWith('hyrule_tasks/')).length,0);
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,checks:['checking state blocks images','specific duplicate positions on both pages','explicit retry repairs only headlines','ready and generation buttons agree'],realImageCalls:0,realErpWrites:0,errors},null,2));
  console.log('Copy review browser checks passed; no image generation or ERP writes.');
}catch(error){await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});throw error;}
finally{release();await browser.close();await f.close();}
