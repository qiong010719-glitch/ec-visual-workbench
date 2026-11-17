import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {merchantFixture} from './merchant-fixture.mjs';

let releaseTitles;
const titlesReady=new Promise(resolve=>{releaseTitles=resolve;});
const f=await merchantFixture({titlePlanner:async group=>{
  await titlesReady;
  return group.sets.map(set=>({setId:set.id,title:'Canvas Wall Art',englishTitle:'Canvas Wall Art'}));
}});
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
const output=path.resolve('tests/results/execution-mode');fs.mkdirSync(output,{recursive:true});
page.on('pageerror',e=>errors.push(e.message));
async function assertMode(expected){
  await page.waitForFunction(value=>document.querySelector('#executionMode').value===value,expected,{timeout:5000});
  assert.equal(await page.locator('.destination-label').textContent(),expected==='publish'?'保存并发布':'仅保存草稿');
  assert.match(await page.locator('#modeHint').textContent(),expected==='publish'?/提交发布/:/保存到店小秘待发布/);
}
async function navigateBack(){
  await page.locator('.workbench-nav a[href="/settings"]').click();
  await page.locator('.workbench-nav a[href="/temu/listings"]').click();
  await page.locator('#targetStore option[value="merchant-ca"]').waitFor({state:'attached'});
}
try{
  await page.goto(f.base+'/temu/listings');
  await page.locator('#targetStore option[value="merchant-ca"]').waitFor({state:'attached'});
  await page.selectOption('#executionMode','publish');
  await navigateBack();await assertMode('publish');

  await page.selectOption('#targetStore','merchant-ca');
  await page.fill('#folderPath',path.join(f.input,'CANVAS-A'));await page.click('#importFolder');
  await page.locator('[data-product="0"]').waitFor();await page.fill('[data-field="count"]','1');await page.selectOption('#imageCount','1');
  await page.click('#createBatch');await page.locator('#generationPanel').waitFor();
  const firstId=await page.evaluate(()=>JSON.parse(localStorage.getItem('listing-active-task')).id);
  await page.click('#planBatch');
  await page.waitForFunction(()=>document.querySelector('#generationState').textContent==='构思与标题生成中');
  await navigateBack();await page.locator('#generationPanel').waitFor();await assertMode('publish');
  assert.equal(await page.locator('#executionMode').isDisabled(),true,'running generation retains the locked selection');
  releaseTitles();
  await page.waitForFunction(()=>document.querySelector('#generationState').textContent==='方案与标题已就绪');
  await page.reload();await page.locator('#generationPanel').waitFor();await assertMode('publish');
  await page.click('#generateBatch');await page.waitForFunction(()=>document.querySelector('#generationState').textContent==='素材已完成');
  await page.click('#reviewGenerated');await page.locator('.listing-row').waitFor();await assertMode('publish');

  await page.selectOption('#executionMode','draft');await page.reload();await page.locator('.listing-row').waitFor();await assertMode('draft');
  await page.selectOption('#executionMode','publish');await page.reload();await page.locator('.listing-row').waitFor();await assertMode('publish');
  await page.click('#backToGeneration');await page.locator('#generationPanel').waitFor();await assertMode('publish');
  await page.click('#newBatch');await assertMode('draft');
  await page.reload();await page.locator('#targetStore option[value="merchant-ca"]').waitFor({state:'attached'});await assertMode('draft');
  await page.selectOption('#taskHistory','product:'+firstId);await page.locator('.listing-row').waitFor();await assertMode('publish');

  const source=await f.api('/api/products/import-folder',{folder:f.input});
  const second=await f.api('/api/products',{requestId:'execution-mode-second',storeKey:'merchant-other',label:'另一批商品',products:[{...source.products[1],count:1}],imageCount:1,ratio:'1:1',mode:'fast'});
  await page.reload();await page.locator('.listing-row').waitFor();
  await page.selectOption('#taskHistory','product:'+second.id);await page.locator('#generationPanel').waitFor();await assertMode('draft');
  await page.selectOption('#taskHistory','product:'+firstId);await page.locator('.listing-row').waitFor();await assertMode('publish');
  await page.selectOption('#taskHistory','product:'+second.id);await page.locator('#generationPanel').waitFor();await assertMode('draft');
  await page.selectOption('#taskHistory','product:'+firstId);await page.locator('.listing-row').waitFor();await assertMode('publish');

  await page.click('#prepareBatch');await page.locator('#executionPanel').waitFor();
  const executionId=await page.evaluate(()=>JSON.parse(localStorage.getItem('listing-active-task')).id);
  const execution=await f.api('/api/temu/erp/batches/'+executionId);
  assert.equal(execution.executionMode,'publish');assert.equal(execution.status,'ready');
  // A prepared execution's server record overrides stale local preferences.
  await page.evaluate(id=>localStorage.setItem('listing-execution-mode:product:'+id,'draft'),firstId);
  await page.reload();await page.locator('#executionPanel').waitFor();await assertMode('publish');
  assert.equal(await page.locator('#executionMode').isDisabled(),true);
  assert.match(await page.locator('#executionSummary').textContent(),/保存并发布/);
  await page.screenshot({path:path.join(output,'restored-publish.png'),fullPage:true});
  assert.equal(f.writes.length,0,'verification must not execute any listing');assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,realGenerationCalls:0,realErpWrites:0,errors,checks:['unsaved selection survives page navigation','running generation restores selection','reload in generation and review','generation and review share batch choice','new batch defaults to draft','history choices are isolated','legacy batch defaults to draft','prepare receives publish','server execution mode overrides stale preference']},null,2));
  console.log('Execution mode persistence browser checks passed (local fixtures; no real generation or ERP writes).');
}catch(error){await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});throw error;}
finally{releaseTitles();await browser.close();await f.close();}
