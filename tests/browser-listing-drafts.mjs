import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {merchantFixture} from './merchant-fixture.mjs';
import {storeIdle} from './merchant-ui.mjs';
import {writeWorkbook} from '../src/workbook.mjs';

const f=await merchantFixture(),browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],checks=[];
const output=path.resolve('tests/results/listing-drafts');fs.mkdirSync(output,{recursive:true});
page.on('pageerror',error=>errors.push(error.message));
const listingReady=()=>page.waitForLoadState('networkidle');
const settings=async()=>{await page.locator('.workbench-nav a[href="/settings"]').click();await page.locator('#modelForm').waitFor();};
const listing=async()=>{await page.locator('.workbench-nav a[href="/temu/listings"]').click();await listingReady();};
const roundTrip=async()=>{await settings();await listing();};
const intake=()=>page.evaluate(()=>({
  fields:Object.fromEntries(['folderPath','outputParent','workbookPath','batchName','imageCount','ratio','mode','imageModel','executionMode','erpConnection','targetStore','batchMother'].map(id=>[id,document.getElementById(id).value])),
  source:document.querySelector('.source-tabs [aria-pressed="true"]').id,
  products:[...document.querySelectorAll('#productInputs [data-product]')].map(row=>({
    fields:[...row.querySelectorAll('[data-field],[data-title-brief]')].map(el=>[el.dataset.field||el.dataset.titleBrief,el.value]),
    images:[...row.querySelectorAll('img')].map(el=>el.getAttribute('src'))
  }))
}));
const resultEdits=()=>page.evaluate(()=>({
  titles:[...document.querySelectorAll('#batchProducts [data-title]')].map(el=>[el.closest('[data-set]').dataset.set,el.dataset.title,el.value]),
  briefs:[...document.querySelectorAll('#batchProducts [data-title-brief]')].map(el=>[el.closest('[data-id]').dataset.id,el.dataset.titleBrief,el.value]),
  output:document.getElementById('savedOutputParent').value
}));
const importRaw=async()=>{await page.fill('#folderPath',f.input);await page.click('#importFolder');await page.locator('[data-product="1"]').waitFor();};
const saveBatch=async()=>{for(const field of await page.locator('#productInputs [data-field="count"]').all())await field.fill('1');await page.selectOption('#imageCount','1');await page.click('#createBatch');await page.locator('#generationPanel').waitFor();};
const planBatch=async()=>{await page.click('#planBatch');await page.waitForFunction(()=>document.querySelector('#generationState').textContent==='方案与标题已就绪');};

try{
  await page.goto(f.base+'/temu/listings');await listingReady();
  // Users may need to connect a store only after entering/importing their product data.
  await importRaw();await page.fill('#batchName','未连接店铺的资料');
  await page.locator('[data-product="0"] [data-field="name"]').fill('Canvas Navigation Draft');
  const unbound=await intake();assert.equal(unbound.fields.targetStore,'');
  await settings();await page.click('#resetStore');await page.fill('#storeForm [name="expectedStore"]','切页新增店铺');await page.fill('#storeForm [name="expectedSite"]','加拿大站');await page.click('#continueStore');
  await page.fill('[data-template="0"] [data-field="name"]','新增店铺母稿');await page.fill('[data-template="0"] [data-field="draftId"]','987654391');
  const saved=page.waitForResponse(r=>r.url()===f.base+'/api/settings'&&r.request().method()==='POST');await page.click('#saveStore');assert.equal((await saved).status(),200);await storeIdle(page);
  await listing();assert.deepEqual(await intake(),unbound);assert.match(await page.locator('#targetStore').textContent(),/切页新增店铺/);
  checks.push('unbound imported products survive actual store creation in settings');

  await page.selectOption('#targetStore','merchant-ca');
  await page.locator('[data-product="1"] [data-field="templateKey"]').selectOption('canvas-b');
  await page.fill('#outputParent',path.join(f.dir,'chosen-output'));await page.selectOption('#imageCount','3');await page.selectOption('#mode','fast');await page.selectOption('#imageModel','gpt-image-2.5-sunburst');await page.selectOption('#executionMode','publish');
  await page.locator('[data-product="0"] [data-field="count"]').fill('5');
  await page.locator('[data-product="0"] .title-brief summary').click();await page.locator('[data-product="0"] [data-title-brief="material"]').fill('帆布');
  const before=await intake();await page.screenshot({path:path.join(output,'01-before-settings.png'),fullPage:true});
  await roundTrip();assert.deepEqual(await intake(),before);await page.reload();await listingReady();assert.deepEqual(await intake(),before);
  await page.screenshot({path:path.join(output,'02-restored.png'),fullPage:true});
  checks.push('paths, model, counts, mixed mothers, title brief and execution choice survive navigation and reload');

  await saveBatch();const first=(await f.api('/api/products'))[0],firstId=first.id;
  assert.equal(await page.evaluate(()=>localStorage.getItem('listing-intake-v1')),null);
  await roundTrip();await page.locator('#generationPanel').waitFor();assert.equal(await page.locator('#batchTitle').textContent(),'未连接店铺的资料');
  await planBatch();const original=await f.api('/api/products/'+firstId);
  await page.locator('[data-title="englishTitle"]').first().fill('Canvas Wall Art Manual Navigation Edition');
  await page.locator('#batchProducts .title-brief summary').first().click();await page.locator('#batchProducts [data-title-brief="dimensions"]').first().fill('50×100cm');
  await page.locator('#savedOutputEditor summary').click();await page.fill('#savedOutputParent',path.join(f.dir,'edited-output'));
  const edited=await resultEdits();await roundTrip();assert.deepEqual(await resultEdits(),edited);await page.reload();await listingReady();assert.deepEqual(await resultEdits(),edited);
  const unchanged=await f.api('/api/products/'+firstId);assert.deepEqual(unchanged.products.map(p=>p.titles),original.products.map(p=>p.titles),'local recovery does not submit unconfirmed title edits');
  checks.push('unsaved generated titles, title briefs and result path restore without submitting them');

  await page.click('#newBatch');assert.equal(await page.locator('[data-product]').count(),0);await page.reload();await listingReady();assert.equal(await page.locator('[data-product]').count(),0);assert.equal(await page.locator('#generationPanel').isVisible(),false);
  await page.selectOption('#taskHistory','product:'+firstId);await page.waitForFunction(id=>document.querySelector('#batchProducts').dataset.batch===id&&!document.querySelector('#taskHistory').disabled,firstId);assert.deepEqual(await resultEdits(),edited);await page.click('#newBatch');
  await page.selectOption('#targetStore','merchant-other');await importRaw();await page.fill('#batchName','另一批商品');await saveBatch();const second=(await f.api('/api/products')).find(p=>p.id!==firstId);await planBatch();
  assert.notEqual(await page.locator('[data-title="englishTitle"]').first().inputValue(),'Canvas Wall Art Manual Navigation Edition');
  await page.selectOption('#taskHistory','product:'+firstId);await page.waitForFunction(id=>document.querySelector('#batchProducts').dataset.batch===id&&!document.querySelector('#taskHistory').disabled,firstId);assert.deepEqual(await resultEdits(),edited);
  assert.equal(await page.inputValue('#targetStore'),'merchant-ca');assert.notEqual(firstId,second.id);
  checks.push('new batch stays empty after reload; edits are isolated by batch and restored through history');

  await page.locator('[data-save-titles]').first().click();await page.waitForFunction(()=>document.querySelector('#listingNotice').textContent.includes('标题与英文版本已保存'));
  await page.locator('[data-regenerate-titles]').first().click();await page.waitForFunction(()=>document.querySelector('#listingNotice').textContent.includes('Temu 标题已更新'));
  await page.click('#saveOutputParent');await page.waitForFunction(()=>document.querySelector('#listingNotice').textContent.includes('保存位置已更新'));
  assert.equal(await page.evaluate(id=>localStorage.getItem('listing-product-edits:'+id),firstId),null);
  const applied=await resultEdits();await roundTrip();assert.deepEqual(await resultEdits(),applied);
  assert.notEqual(await page.locator('[data-title="englishTitle"]').first().inputValue(),'Canvas Wall Art Manual Navigation Edition');
  checks.push('saving and applying edits removes stale local drafts; regenerated titles are not overwritten');

  const finished=path.join(f.dir,'finished');fs.mkdirSync(path.join(finished,'READY-001'),{recursive:true});fs.copyFileSync(path.join(f.input,'CANVAS-A','01.png'),path.join(finished,'READY-001','01.png'));
  const workbook=path.join(finished,'products.xlsx');writeWorkbook([{productCode:'READY-001',title:'Ready Canvas Art',englishTitle:'Ready Canvas Art'}],workbook);
  await page.click('#newBatch');await page.click('#folderTab');await page.fill('#folderPath',finished);await page.locator('#workbookOptions summary').click();await page.fill('#workbookPath',workbook);
  const direct=await intake();await roundTrip();assert.deepEqual(await intake(),direct);
  await page.click('#importFolder');await page.locator('.listing-row').waitFor();await page.locator('#productRows [data-field="englishTitle"]').fill('Review stage navigation edit');await roundTrip();await page.locator('.listing-row').waitFor();assert.equal(await page.locator('#productRows [data-field="englishTitle"]').inputValue(),'Review stage navigation edit');
  checks.push('finished-image source and Excel path recover; existing review autosave still works');

  assert.deepEqual(errors,[]);assert.equal(f.writes.length,0);
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,realErpWrites:0,realGenerationCalls:0,checks,errors},null,2));
  console.log(JSON.stringify({passed:true,checks,errors},null,2));
}finally{await context.close();await browser.close();await f.close();}
