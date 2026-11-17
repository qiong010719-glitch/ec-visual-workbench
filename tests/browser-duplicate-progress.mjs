import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {copyReviewFixture,repeatedHeadline} from './copy-review-fixture.mjs';
import {buildPlan,splitPlan} from '../src/planner.mjs';
import {readCreativeCopy} from '../src/creative-direction.mjs';

let calls=0,release;const gate=new Promise(r=>release=r);
const f=await copyReviewFixture({planner:async payload=>{
  if(++calls===3){await gate;throw new Error('构思服务请求超时，原方案已保留');}
  const plan=buildPlan(payload),text=plan.sections.map(s=>s.title+'\n镜头与资料保持。'+(s.outputConstraint?'':`\n画面主标题：${s.slot===1?repeatedHeadline:'Canvas '+payload.creative_direction.styleId}`)).join('\n\n');
  return {...plan,text,copyHeadlines:readCreativeCopy(splitPlan(text).blocks,plan.sections)};
},copyRewriter:async(g,targets)=>targets.map(t=>({setId:t.setId,slot:t.slot,headline:t.setIndex===2?'Inspect the Canvas Details':'Explore the Artwork Up Close'}))});
const output=path.resolve('tests/results/duplicate-recovery');fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
  await page.addInitScript(id=>localStorage.setItem('merchant-active-batch',id),f.batch.id);
  await f.api(f.route+'/plan',{});await page.goto(f.base+'/temu/listings');
  await page.waitForFunction(()=>document.querySelector('[data-planning-progress]')?.textContent.includes('构思已完成 2/3 套'));
  assert.match(await page.locator('[data-planning-progress]').innerText(),/正在构思：第 3 套/);
  assert.equal(await page.locator('#batchProducts .error').count(),0);
  assert.equal(await page.locator('#planBatch').isDisabled(),true);
  await page.screenshot({path:path.join(output,'planning.png'),fullPage:true});
  release();await page.waitForFunction(()=>document.querySelector('#generationState').textContent==='需要处理');
  assert.match(await page.locator('#batchProducts .error').first().innerText(),/第 3 套构思失败.*超时/);
  assert.equal(await page.locator('#planBatch').innerText(),'重试失败构思');assert.equal(await page.locator('#planBatch').isEnabled(),true);
  await page.screenshot({path:path.join(output,'timeout.png'),fullPage:true});
  await page.click('#planBatch');await page.waitForFunction(()=>document.querySelector('#generationState').textContent==='方案与标题已就绪');
  assert.equal(calls,4);assert.equal(await page.locator('#generateBatch').isEnabled(),true);
  assert.equal(Object.keys(f.app.store.state.tasks).filter(k=>k.startsWith('hyrule_tasks/')).length,0);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(output,'recovered.png'),fullPage:true});
  fs.writeFileSync(path.join(output,'browser-report.json'),JSON.stringify({passed:true,checks:['per-set planning progress','pending duplicates do not mask state','actual timeout and failed set displayed','retry button unlocks','retry reuses completed plans','images require separate user action'],errors,paidCalls:0},null,2));
  console.log('Duplicate recovery progress UI passed.');
}finally{release();await browser.close();await f.close();}
