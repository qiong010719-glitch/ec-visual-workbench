import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {merchantFixture} from './merchant-fixture.mjs';
import {storeIdle} from './merchant-ui.mjs';

const f=await merchantFixture(),browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext(),listing=await context.newPage(),settings=await context.newPage(),errors=[];
for(const page of [listing,settings])page.on('pageerror',e=>errors.push(e.message));
const storeOptions=()=>listing.locator('#targetStore option').allTextContents();
const waitStore=name=>listing.waitForFunction(name=>[...document.querySelector('#targetStore').options].some(o=>o.textContent.includes(name)),name);
const save=async()=>{const response=settings.waitForResponse(r=>r.url()===f.base+'/api/settings'&&r.request().method()==='POST');await settings.click('#saveStore');const r=await response;await storeIdle(settings);return r;};
async function fillNewStore(name,id){
  await settings.click('#resetStore');await settings.fill('#storeForm [name=expectedStore]',name);await settings.fill('#storeForm [name=expectedSite]','加拿大站');await settings.click('#continueStore');
  await settings.fill('[data-template="0"] [data-field=name]',name+'母稿');await settings.fill('[data-template="0"] [data-field=draftId]',id);
}
try{
  const initial=await f.api('/api/settings');f.app.preferences.update({revision:initial.revision,stores:[initial.stores[0]]});
  await listing.goto(f.base+'/temu/listings');await listing.selectOption('#targetStore','merchant-ca');
  await listing.fill('#folderPath',f.input);await listing.click('#importFolder');await listing.locator('[data-product="1"]').waitFor();
  await listing.locator('[data-product="0"] [data-field=name]').fill('Preserved product name');
  await listing.locator('[data-product="0"] [data-field=description]').fill('保留的商品资料');
  await listing.locator('[data-product="1"] [data-field=templateKey]').selectOption('canvas-b');
  const before=await listing.locator('#productInputs [data-field]').evaluateAll(es=>es.map(e=>[e.dataset.field,e.value]));
  await settings.goto(f.base+'/settings');await fillNewStore('新增店铺二','987654351');
  assert.match(await settings.locator('#storeSaveHint').textContent(),/保存成功后/);
  assert.equal((await storeOptions()).length,2,'unsaved input is not a saved store');
  f.invalidMothers.add('987654351');assert.equal((await save()).status(),409);
  assert.match(await settings.locator('#storeSaveStatus').textContent(),/尚未保存/);
  assert.equal((await storeOptions()).length,2,'failed saves must not announce a store');
  f.invalidMothers.delete('987654351');assert.equal((await save()).status(),200);
  assert.match(await settings.locator('#storeSaveStatus').textContent(),/已保存.*自动更新/);
  await waitStore('新增店铺二');
  assert.equal(await listing.inputValue('#targetStore'),'merchant-ca');
  assert.deepEqual(await listing.locator('#productInputs [data-field]').evaluateAll(es=>es.map(e=>[e.dataset.field,e.value])),before,'live sync preserves product edits and per-product mothers');
  assert.equal(await listing.inputValue('#batchMother'),'','mixed mother selection remains mixed');
  const savedSecond=(await f.api('/api/settings')).stores.find(s=>s.expectedStore==='新增店铺二');

  // A second successful UI save on the same page must also reach the open listing page.
  await fillNewStore('新增店铺三','987654361');assert.equal((await save()).status(),200);await waitStore('新增店铺三');
  assert.equal((await storeOptions()).length,4);
  await listing.selectOption('#targetStore',savedSecond.key);
  assert.deepEqual(await listing.locator('#batchMother option').allTextContents(),['新增店铺二母稿 · 987654351']);
  await listing.selectOption('#targetStore','merchant-ca');

  // Changes made outside this browser context have no storage event: foreground polling is the fallback.
  let current=await f.api('/api/settings');
  await f.api('/api/settings',{revision:current.revision,stores:current.stores.map(s=>s.key==='merchant-ca'?{...s,templates:[...s.templates,{key:'new-mother',name:'新增母稿',draftId:'987654371'}]}:s)});
  await listing.waitForFunction(()=>document.querySelector('#batchMother').textContent.includes('新增母稿'),{},{timeout:12000});
  assert.match(await listing.locator('[data-product="0"] [data-field=templateKey]').textContent(),/新增母稿/);
  assert.equal(await listing.locator('[data-product="0"] [data-field=name]').inputValue(),'Preserved product name');

  // A failed refresh leaves selections intact, then pageshow restores current server data.
  await listing.route('**/api/temu/erp/config',route=>route.abort());
  await listing.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await listing.waitForFunction(()=>document.querySelector('#storeSyncStatus').dataset.failed==='true');
  assert.equal(await listing.inputValue('#targetStore'),'merchant-ca');
  current=await f.api('/api/settings');
  await f.api('/api/settings',{revision:current.revision,stores:current.stores.map(s=>s.key===savedSecond.key?{...s,expectedStore:'店铺二改名'}:s)});
  await listing.unroute('**/api/temu/erp/config');await listing.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await waitStore('店铺二改名');

  // Saved batches retain their store/mother binding while their dropdown gets new stores.
  for(const field of await listing.locator('[data-field=count]').all())await field.fill('1');await listing.selectOption('#imageCount','2');
  await listing.click('#createBatch');await listing.locator('#generationPanel').waitFor();
  const batchBefore=(await f.api('/api/products'))[0];assert.equal(await listing.locator('#targetStore').isDisabled(),true);
  current=await f.api('/api/settings');
  await f.api('/api/settings',{revision:current.revision,stores:[...current.stores,{...savedSecond,key:'fourth-store',expectedStore:'新增店铺四'}]});
  await listing.evaluate(()=>window.dispatchEvent(new Event('focus')));await waitStore('新增店铺四');
  assert.equal(await listing.inputValue('#targetStore'),'merchant-ca');assert.equal(await listing.locator('#targetStore').isDisabled(),true);
  const batchAfter=(await f.api('/api/products'))[0];assert.equal(batchAfter.storeKey,batchBefore.storeKey);assert.deepEqual(batchAfter.products,batchBefore.products);

  await listing.click('#planBatch');await listing.waitForFunction(()=>document.querySelector('#generationState').textContent==='方案与标题已就绪');
  await listing.click('#generateBatch');await listing.waitForFunction(()=>document.querySelector('#generationState').textContent==='素材已完成');
  await listing.click('#reviewGenerated');await listing.locator('.listing-row').nth(1).waitFor();
  await listing.locator('[data-row="0"] [data-field=title]').fill('My edited product title');
  await listing.locator('[data-row="1"] [data-field=templateKey]').selectOption('canvas-b');
  await listing.locator('[data-row="0"] [data-earlier]').nth(1).click();
  await listing.locator('[data-row="0"] [data-image]').first().uncheck();
  const reviewBefore=await listing.locator('#productRows').evaluate(root=>[...root.querySelectorAll('input,select')].map(e=>[e.dataset.field||e.dataset.image,e.value,e.checked]));
  current=await f.api('/api/settings');
  await f.api('/api/settings',{revision:current.revision,stores:current.stores.map(s=>s.key==='fourth-store'?{...s,expectedStore:'店铺四更新'}:s)});
  await listing.evaluate(()=>window.dispatchEvent(new Event('focus')));await waitStore('店铺四更新');
  assert.deepEqual(await listing.locator('#productRows').evaluate(root=>[...root.querySelectorAll('input,select')].map(e=>[e.dataset.field||e.dataset.image,e.value,e.checked])),reviewBefore,'review text, selected mothers and image selections survive config sync');

  await listing.click('#newBatch');assert.equal(await listing.locator('#targetStore').isDisabled(),false);await listing.selectOption('#targetStore','fourth-store');assert.match(await listing.locator('#batchMother').textContent(),/987654351/);
  assert.deepEqual(errors,[]);assert.equal(f.writes.length,0);
  console.log('店铺同步通过：连续新增、保存失败隔离、跨页自动更新、母稿更新、保留商品输入、后台更新轮询、返回恢复、断网重试、已有批次不改绑。');
}finally{await context.close();await browser.close();await f.close();}
