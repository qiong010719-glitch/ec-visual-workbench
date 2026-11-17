import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {merchantFixture} from './merchant-fixture.mjs';

const raw='Command failed: powershell.exe -NoProfile -Command Get-NetTCPConnection '+ 'private-command-'.repeat(100);
const f=await merchantFixture({erpAdapter:{createDraftSession:async()=>{throw new Error(raw);}}});
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const output=path.resolve('tests/results/chrome-owner');fs.mkdirSync(output,{recursive:true});
try{
  const url=f.app.saveImage(fs.readFileSync(path.join(f.input,'CANVAS-A','01.png')));
  f.app.store.state.drafts.push({id:'chrome-error-test',platform:'temu',title:'连接失败测试',englishTitle:'Connection Test',images:[url]});f.app.store.save();
  const preview=await f.api('/api/temu/erp/import-generated',{draftId:'chrome-error-test'});
  const batch=await f.api('/api/temu/erp/prepare',{previewId:preview.id,storeKey:'merchant-ca',rows:preview.rows});
  await f.api('/api/temu/erp/batches/'+batch.id+'/start',{});
  await f.wait('/api/temu/erp/batches/'+batch.id,b=>b.status==='failed'&&!b.cleaningUp);
  await page.goto(f.base+'/temu/listings?batch='+batch.id);
  await page.waitForFunction(()=>document.querySelector('#batchState').textContent==='已停止');
  assert.match(await page.textContent('.row-error'),/旧版检查 Chrome 端口时失败/);
  assert.match(await page.textContent('#executionHint'),/旧版检查 Chrome 端口时失败/);
  assert.doesNotMatch(await page.locator('body').innerText(),/private-command|Command failed|Get-NetTCPConnection/);
  assert.equal((await f.api('/api/temu/erp/batches/'+batch.id)).error,raw,'history must retain original evidence');
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'error must not widen the page');
    await page.locator('#executionPanel').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'error-'+width+'.png')});
  }
  assert.deepEqual(errors,[]);assert.equal(f.writes.length,0);
  console.log('Chrome failure presentation passed: readable historical errors, original history preserved, desktop/mobile layout, zero ERP writes.');
}finally{await browser.close();await f.close();}
