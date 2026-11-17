import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {merchantFixture} from './merchant-fixture.mjs';

const calls=[],errors=[];let failNext=false;
const f=await merchantFixture({titlePlanner:async group=>{
  calls.push(structuredClone(group.source));
  if(failNext){failNext=false;throw Error('测试模型暂时失败，未自动重试');}
  const facts=group.source.title_brief||{},title='Smiley Face Clear Phone Case'+(facts.compatibility?' for '+facts.compatibility:'')+(facts.material?', '+facts.material+' Cover':'');
  return group.sets.map(s=>({setId:s.id,title,englishTitle:title,chineseTitle:'透明笑脸手机壳'+(facts.compatibility?'，适配 '+facts.compatibility:'')}));
}});
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1050}});
const output=path.resolve('tests/results/temu-title-policy');fs.mkdirSync(output,{recursive:true});
page.on('pageerror',e=>errors.push(e.message));
const input=key=>page.locator('[data-product="0"] [data-title-brief="'+key+'"]');
const result=key=>page.locator('#batchProducts [data-title-brief="'+key+'"]');
const rewrite=()=>page.locator('[data-regenerate-titles]');
try{
  await page.goto(f.base+'/temu/listings');await page.selectOption('#targetStore','merchant-ca');
  await page.fill('#folderPath',f.input);await page.click('#importFolder');await page.locator('[data-product="1"]').waitFor();
  await page.click('[data-remove="1"]');await page.fill('[data-field="name"]','透明笑脸手机壳');
  await page.fill('[data-field="description"]','透明背板，笑脸图案。');await page.fill('[data-field="count"]','1');
  await page.locator('[data-product="0"] .title-brief summary').click();
  await input('category').fill('手机壳');await input('compatibility').fill('iPhone 16');await input('material').fill('TPU');
  await input('referenceTitles').fill('Other Brand Magnetic Case, 2-Pack');
  await page.selectOption('#imageCount','1');await page.click('#createBatch');await page.locator('#generationPanel').waitFor();
  await page.click('#planBatch');await page.waitForFunction(()=>document.querySelector('#generationState').textContent==='方案与标题已就绪');
  assert.equal(calls.length,1);assert.equal(calls[0].title_brief.compatibility,'iPhone 16');
  assert.match(await page.inputValue('[data-title="englishTitle"]'),/iPhone 16/);
  await page.locator('#batchProducts .title-brief summary').click();
  assert.equal(await result('material').inputValue(),'TPU');
  await page.click('#generateBatch');await page.waitForFunction(()=>document.querySelector('#generationState').textContent==='素材已完成');
  const b=(await f.api('/api/products'))[0],route='/api/products/'+b.id;
  const before=await f.api(route),imageState=JSON.stringify(before.products[0].group);
  await result('compatibility').fill('iPhone 16 Pro');
  await page.click('#materializeBatch');await page.getByText('标题资料尚未应用，请先点击该产品的“按 Temu 类目重新撰写标题”。',{exact:true}).waitFor();
  failNext=true;await rewrite().click();await page.getByText('测试模型暂时失败，未自动重试',{exact:true}).waitFor();
  assert.equal(await result('compatibility').inputValue(),'iPhone 16 Pro');
  assert.equal((await f.api(route)).products[0].titleBrief.compatibility,'iPhone 16');
  assert.match(await page.inputValue('[data-title="englishTitle"]'),/iPhone 16, TPU/);
  assert.equal(await rewrite().isEnabled(),true);
  await rewrite().click();await page.waitForFunction(()=>document.querySelector('[data-title="englishTitle"]').value.includes('iPhone 16 Pro'));
  assert.equal(calls.length,3);assert.equal((await f.api(route)).products[0].titleBrief.compatibility,'iPhone 16 Pro');
  assert.equal(JSON.stringify((await f.api(route)).products[0].group),imageState);
  await page.reload();await page.locator('#generationPanel').waitFor();await page.locator('#batchProducts .title-brief summary').click();
  assert.equal(await result('compatibility').inputValue(),'iPhone 16 Pro');
  await page.locator('#batchProducts').screenshot({path:path.join(output,'title-facts.png')});
  // Missing facts remain a visible, nonblocking prompt; no automatic model retry.
  await result('compatibility').fill('');await rewrite().click();
  await page.getByText('手机壳缺少已确认的适配型号，标题不会根据摄像头外观猜型号。',{exact:true}).waitFor();
  assert.equal(calls.length,4);assert.equal(await page.locator('#reviewGenerated').isEnabled(),true);
  assert.deepEqual(f.writes,[]);assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(output,'review-warning.png'),fullPage:true});
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,mockTitleCalls:calls.length,realModelCalls:0,erpWrites:0,checks:['initial structured facts reach title model','old batch title-only update','failed update retains local input and saved data','retry only on user click','image state unchanged','reload restores attributes','missing compatibility shows advisory','unapplied facts cannot silently export'],errors},null,2));
  console.log('Temu title browser flow passed; 0 real model calls and 0 ERP writes.');
}finally{await browser.close();await f.close();}
