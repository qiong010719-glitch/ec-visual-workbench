import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {merchantFixture} from './merchant-fixture.mjs';

const publications=[],errors=[];
const f=await merchantFixture({erpAdapter:{publishDraft:async({row,store,onProgress})=>{
  publications.push({code:row.productCode,store:store.key,mother:store.draftId});
  onProgress('publishing');return {publicationStatus:'submitted',published:false};
}}});
const cfg=await f.api('/api/settings'),firstErp=cfg.stores[0].erpKey;
f.app.preferences.update({revision:cfg.revision,
  erpConnections:[...cfg.erpConnections,{key:'second-erp',name:'第二个 ERP',browserKey:cfg.browsers[0].key},{key:'empty-erp',name:'未关联店铺 ERP',browserKey:cfg.browsers[0].key}],
  stores:cfg.stores.map((s,i)=>({...s,erpKey:i?'second-erp':firstErp}))});
const source=f.app.saveImage(fs.readFileSync(path.join(f.input,'CANVAS-A','01.png')));
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1050}});
await context.addInitScript(source=>{
  for(const key of ['aplus_newbie_tour_v1','hyrule_result_tour_done','hyrule_veteran'])localStorage.setItem(key,'true');
  const key='hyrule_state_v13::temu::'+location.host;
  if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({generationMode:'fast',designScope:'main_and_6',prodName:'蓝色帆布装饰画',prodDesc:'单幅无框帆布画。',materialMeta:[{id:'subject',filename:'产品主体图.png',category:'产品主体图',url:source}],modelChoice:'gpt-image-2',imageSlots:Array(14).fill(null),activeKieTasks:[]}));
},source);
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
const output=path.resolve('tests/results/single-listing');fs.mkdirSync(output,{recursive:true});
const entry=()=>page.locator('#view-adventure-log [data-single-listing]');
async function open(){await entry().click();await page.locator('#singleListingForm').waitFor();}
async function choose(erp=firstErp,store='merchant-ca',mother='canvas-b'){
  await page.selectOption('#singleListingErp',erp);await page.selectOption('#singleListingStore',store);await page.selectOption('#singleListingMother',mother);
}
async function titles(code){await page.fill('[name=productCode]',code);await page.fill('[name=title]','Blue Canvas Wall Art');await page.fill('[name=englishTitle]','Blue Canvas Wall Art');}
async function design(){await page.goto(f.base+'/temu');await page.click('#nav-notes');await page.waitForFunction(()=>!document.querySelector('#view-adventure-log [data-single-listing]').disabled);}
try{
  await page.goto(f.base+'/temu');await page.waitForFunction(()=>document.querySelector('#prodName').value==='蓝色帆布装饰画');
  assert.equal(await entry().isDisabled(),true,'empty results cannot submit');
  await page.selectOption('#designScope','main_count');await page.selectOption('#mainImageCount','2');
  await page.click('#agentBtn');await page.click('#agentConfirmOk');
  await page.waitForFunction(()=>document.querySelector('#sopText').value.includes('【卖点图1】')&&!document.querySelector('#championsOverlay').classList.contains('show'));
  await page.click('#mainBtn');
  await page.waitForFunction(()=>activeKieTasks.length===0&&document.querySelectorAll('#galleryContainer .quest-slot img').length===2);
  if(await page.locator('#_ratingSkip').isVisible())await page.click('#_ratingSkip');
  await page.waitForFunction(()=>!document.querySelector('#view-adventure-log [data-single-listing]').disabled);
  await page.screenshot({path:path.join(output,'result-button.png')});
  await open();assert.equal(await page.locator('.single-listing-images img').count(),2);
  assert.equal(await page.locator('#singleListingSubmit').isDisabled(),true);
  await page.selectOption('#singleListingErp','empty-erp');assert.match(await page.textContent('#singleListingBinding'),/尚未绑定/);
  await choose();assert.deepEqual(await page.locator('#singleListingStore option').evaluateAll(es=>es.map(e=>e.value)),['','merchant-ca']);
  await page.selectOption('#singleListingErp','second-erp');assert.equal(await page.inputValue('#singleListingStore'),'');assert.equal(await page.inputValue('#singleListingMother'),'');
  assert.deepEqual(await page.locator('#singleListingStore option').evaluateAll(es=>es.map(e=>e.value)),['','merchant-other']);
  await page.selectOption('#singleListingStore','merchant-other');await page.selectOption('#singleListingMother','canvas-b');
  assert.match(await page.textContent('#singleListingBinding'),/987654332/);
  await page.click('#singleListingCheck');await page.getByText('店小秘已登录：fixture-merchant',{exact:true}).waitFor();
  await page.click('#singleListingSubmit');assert.equal(f.writes.length,0,'missing English title must block execution');
  await titles('SINGLE-PUBLISH');assert.equal(await page.inputValue('#singleListingMode'),'publish');
  await page.screenshot({path:path.join(output,'select-store-mother.png')});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.locator('#temuSharedDialog').evaluate(el=>el.scrollWidth<=el.clientWidth),'dialog must not overflow on narrow screens');
  await page.screenshot({path:path.join(output,'mobile-form.png')});await page.setViewportSize({width:1440,height:1050});
  await page.click('#singleListingSubmit');await page.waitForURL('**/temu/listings*');
  await page.waitForFunction(()=>document.querySelector('#batchState').textContent==='全部完成');
  assert.equal(f.writes.length,1);assert.deepEqual(publications,[{code:'SINGLE-PUBLISH',store:'merchant-other',mother:'987654332'}]);
  assert.equal(await page.inputValue('#erpConnection'),'second-erp');assert.equal(await page.inputValue('#targetStore'),'merchant-other');assert.equal(await page.inputValue('#batchMother'),'canvas-b');
  assert.match(await page.textContent('#executionRows'),/已提交 · 等待平台结果/);
  const job=(await f.api('/api/temu/erp/batches'))[0];assert.equal(job.rows[0].images.length,2);
  await page.reload();await page.waitForFunction(()=>document.querySelector('#batchState').textContent==='全部完成');assert.equal(publications.length,1);
  await page.screenshot({path:path.join(output,'submitted-progress.png')});

  // Reopening the same completed design restores form choices and the existing execution.
  await design();await open();assert.equal(await page.inputValue('#singleListingStore'),'merchant-other');
  await page.click('#singleListingSubmit');await page.waitForURL('**/temu/listings*');
  await page.waitForFunction(()=>document.querySelector('#batchState').textContent==='全部完成');assert.equal(f.writes.length,1);assert.equal(publications.length,1);

  // Draft-only submission goes to the chosen store/mother without publication.
  await design();await open();await choose();await titles('SINGLE-DRAFT');await page.selectOption('#singleListingMode','draft');
  await page.click('#singleListingSubmit');await page.waitForURL('**/temu/listings*');
  await page.waitForFunction(()=>document.querySelector('#batchState').textContent==='全部完成');assert.equal(f.writes.length,2);assert.equal(publications.length,1);
  assert.equal(f.writes.at(-1).mother,'987654322');assert.equal(await page.inputValue('#executionMode'),'draft');

  // A mother changed while the dialog is open must be reviewed before any ERP action.
  await design();await open();await titles('SINGLE-CHANGED');
  const current=await f.api('/api/settings');f.app.preferences.update({revision:current.revision,stores:current.stores.map(s=>s.key==='merchant-ca'?{...s,templates:s.templates.map(t=>t.key==='canvas-b'?{...t,draftId:'987654399'}:t)}:s)});
  await page.click('#singleListingSubmit');await page.waitForFunction(()=>document.querySelector('#singleListingStatus').textContent.includes('配置已变化'));assert.equal(f.writes.length,2);
  assert.match(await page.textContent('#singleListingBinding'),/987654399/);

  // Losing the start response leaves a single recoverable execution, never an automatic retry.
  let starts=0;
  await page.route('**/api/temu/erp/batches/*/start',async route=>{starts++;await route.abort('failed');});
  await page.click('#singleListingSubmit');await page.locator('#singleListingProgress:not([hidden])').waitFor();
  await page.waitForFunction(()=>document.querySelector('#singleListingStatus').textContent.includes('执行清单已保留'));
  assert.equal(starts,1);assert.equal(await page.locator('#singleListingSubmit').isDisabled(),true);assert.equal(f.writes.length,2);
  await page.unroute('**/api/temu/erp/batches/*/start');await page.click('#singleListingProgress');await page.locator('#startBatch').waitFor();
  await page.click('#startBatch');await page.waitForFunction(()=>document.querySelector('#batchState').textContent==='全部完成');assert.equal(f.writes.length,3);assert.equal(publications.length,1);

  // Saved drafts have the same shortcut, and an empty configuration remains actionable.
  await page.goto(f.base+'/temu');await page.evaluate(()=>openLocalDraftEditor());await page.locator('[data-list]').waitFor();await page.click('[data-list]');await page.locator('#singleListingForm').waitFor();
  const finalConfig=await f.api('/api/settings');f.app.preferences.update({revision:finalConfig.revision,stores:[],erpConnections:[]});
  await page.click('#singleListingRefresh');await page.waitForFunction(()=>document.querySelector('#singleListingBinding').textContent.includes('尚未绑定可上架的 ERP'));
  assert.equal(await page.locator('#singleListingSubmit').isDisabled(),true);assert.ok(await page.getByRole('link',{name:'管理 ERP、店铺与母稿'}).isVisible());
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,realErpWrites:0,paidImageCalls:0,fixtureWrites:f.writes,fixturePublications:publications,errors},null,2));
  console.log('Single-design direct listing passed: generated images, linked selectors, draft/publish, history recovery, duplicate protection, changed bindings, network failure, saved drafts and mobile. Fixtures only.');
}catch(error){await page.screenshot({path:path.join(output,'failure.png')});throw error;}
finally{await browser.close();await f.close();}
