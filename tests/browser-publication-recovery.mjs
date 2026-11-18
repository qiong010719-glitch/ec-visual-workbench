import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {merchantFixture} from './merchant-fixture.mjs';

const writes=[],submissions=[],errors=[],blockedExternalRequests=[];let resolved=false;
const f=await merchantFixture({erpAdapter:{
  runDraft:async({row})=>{writes.push(row.productCode);return {draftId:row.productCode==='FIRST'?'220114595121490272':'220114595121490273',verifiedAt:new Date().toISOString(),url:'https://www.dianxiaomi.com/web/popTemu/edit?id=220114595121490272'};},
  publishDraft:async({row,onProgress})=>{submissions.push(row.productCode);onProgress('publishing',{publicationAttemptedAt:new Date().toISOString()});if(row.productCode==='FIRST')throw new Error('发布结果待核对，未取得该草稿的明确提交回执');return {publicationStatus:'submitted',published:false};},
  checkPublication:async()=>({publicationStatus:resolved?'listed':'draft',published:false,erpState:resolved?'online':'offline'})
}});
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
// Every ERP operation above uses the fixture adapter. The browser is likewise
// restricted to this fresh local server, even if a UI regression follows a link.
await page.context().route('**/*',route=>{
  if(new URL(route.request().url()).origin===new URL(f.base).origin)return route.continue();
  blockedExternalRequests.push(route.request().url());return route.abort('blockedbyclient');
});
const output=path.resolve('tests/results/publication-recovery');fs.mkdirSync(output,{recursive:true});
try{
  const preview=await f.app.erp.makePreview({label:'发布恢复验收',rows:[{rowId:'first',productCode:'FIRST',title:'First canvas',folder:'shared'},{rowId:'second',productCode:'SECOND',title:'Second canvas',folder:'shared'}],folders:[{name:'shared',files:[path.join(f.input,'CANVAS-A','01.png')]}]});
  const batch=await f.api('/api/temu/erp/prepare',{previewId:preview.id,storeKey:f.stores[0].key,browserKey:f.browsers[0].key,executionMode:'publish',rows:preview.rows.map(r=>({...r,englishTitle:r.title,templateKey:'canvas-a',imageIds:[preview.folders[0].images[0].id]}))});
  await f.api('/api/temu/erp/batches/'+batch.id+'/start',{});await f.wait('/api/temu/erp/batches/'+batch.id,b=>b.status!=='running');
  await page.goto(f.base+'/temu/listings');
  await page.waitForFunction(()=>window.ListingWorkspace?.getState().ready);
  // Resume through the user-facing history selector so the shared server state,
  // rather than an out-of-band localStorage write, is the reload source of truth.
  await page.locator('#taskHistory').selectOption('preview:'+preview.id);
  await page.locator('#executionPanel').waitFor();
  await f.wait('/api/workspace/ui-state?key=listing:selection',record=>JSON.parse(record.data?.items?.['listing-active-task']||'null')?.id===batch.id);
  await page.reload();await page.locator('#executionPanel').waitFor();
  assert.equal(await page.locator('#startBatch').isDisabled(),true);
  await page.locator('[data-publication="first"]').click();
  await page.waitForFunction(()=>document.querySelector('.row-error')?.textContent.includes('草稿仍在待发布'));
  assert.equal(await page.locator('#startBatch').isDisabled(),true);assert.deepEqual(submissions,['FIRST']);
  resolved=true;await page.locator('[data-publication="first"]').click();
  await page.getByText('店小秘在线 · 生命周期待同步',{exact:true}).waitFor();
  assert.equal(await page.locator('#startBatch').isEnabled(),true);assert.equal(await page.locator('.row-error').count(),0);
  assert.doesNotMatch(await page.locator('#executionHint').textContent(),/未取得|待核对|无法排除/);
  await page.reload();await page.getByText('店小秘在线 · 生命周期待同步',{exact:true}).waitFor();
  assert.equal(await page.locator('#startBatch').isEnabled(),true);
  await page.locator('#executionPanel').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'recovered.png')});
  await page.locator('#startBatch').click();
  await page.waitForFunction(()=>document.querySelector('#batchState').textContent==='全部完成');
  assert.deepEqual(writes,['FIRST','SECOND']);assert.deepEqual(submissions,['FIRST','SECOND']);
  assert.equal(await page.locator('#startBatch').isDisabled(),true);assert.deepEqual(errors,[]);assert.deepEqual(blockedExternalRequests,[]);
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,realErpWrites:0,writes,submissions,errors,blockedExternalRequests,checks:['unresolved status keeps replay blocked','manual publication unlocks continuation','old error cleared','reload retains online state','only second product executes']},null,2));
  console.log('Publication recovery browser checks passed; no real ERP writes.');
}catch(e){await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});throw e;}
finally{await browser.close();await f.close();}
