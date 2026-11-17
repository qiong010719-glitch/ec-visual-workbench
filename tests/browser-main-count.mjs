import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createWorkbench,root} from '../src/server.mjs';

const output=path.join(root,'tests/results/main-count');fs.mkdirSync(output,{recursive:true});
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'main-count-ui-')),calls=[],errors=[];
const png=await sharp({create:{width:120,height:160,channels:3,background:'#54789a'}}).png().toBuffer();
const app=createWorkbench({dataDirectory:dir,configuration:{},provider:async p=>{calls.push(p);return png;}});
const source=app.saveImage(png);await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+app.server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1050},acceptDownloads:true});
await context.addInitScript(source=>{
  for(const key of ['aplus_newbie_tour_v1','hyrule_result_tour_done','hyrule_veteran'])localStorage.setItem(key,'true');
  const key='hyrule_state_v13::temu::'+location.host;
  if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({generationMode:'fast',designScope:'main_and_6',prodName:'主图数量测试画',prodDesc:'单幅帆布画，蓝色图案。',materialMeta:[{id:'subject',filename:'产品主体图.png',category:'产品主体图',url:source}],modelChoice:'gpt-image-2',imageSlots:Array(14).fill(null),activeKieTasks:[]}));
},source);
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
try{
  await page.goto(base+'/temu');await page.waitForFunction(()=>document.querySelector('#prodName').value==='主图数量测试画');
  await page.locator('#designScope').selectOption('main_count');
  assert.equal(await page.locator('#mainImageCount').inputValue(),'7');
  for(const count of [1,8,10]){
    await page.locator('#mainImageCount').selectOption(String(count));
    assert.equal(await page.locator('#galleryContainer .quest-slot').count(),count);
    assert.equal(await page.locator('#galleryContainer .aplus-images-section').count(),0);
  }
  await page.locator('#modeBtn_master').click();await page.locator('#designScope').selectOption('main_count');
  assert.equal(await page.locator('#mainImageCount').inputValue(),'10');
  assert.equal(await page.locator('#imageRatio').inputValue(),'1:1');assert.equal(await page.locator('#imageRatio').isDisabled(),true);
  await page.screenshot({path:path.join(output,'01-main-count.png')});
  await page.locator('#agentBtn').click();await page.locator('#agentConfirmOk').click();
  await page.waitForFunction(()=>document.querySelector('#sopText').value.includes('【卖点图9】')&&!document.querySelector('#championsOverlay').classList.contains('show'));
  const planned=Object.values(app.store.state.tasks).find(t=>t.plan);
  assert.equal(planned.payload.image_count,10);assert.equal(planned.plan.sections.length,10);
  await page.locator('#mainBtn').click();
  await page.waitForFunction(()=>activeKieTasks.length===0&&document.querySelectorAll('#galleryContainer .quest-slot img').length===10,{},{timeout:30000});
  if(await page.locator('#_ratingSkip').isVisible())await page.locator('#_ratingSkip').click();
  assert.equal(calls.length,10);assert.ok(calls.every(p=>p.ratio==='1:1'));
  await page.reload();await page.waitForFunction(()=>document.querySelectorAll('#galleryContainer .quest-slot img').length===10);
  assert.equal(await page.locator('#mainImageCount').inputValue(),'10');assert.equal(calls.length,10);
  await page.evaluate(()=>openLocalDraftEditor());await page.waitForSelector('#temuSharedDialog');
  const draft=app.store.state.drafts.at(-1);assert.equal(draft.images.length,10);assert.deepEqual(draft.mainImages,draft.detailImages);
  await page.goto(base+'/temu/listings');await page.locator('#generatedTab').click();
  await page.locator(`#generatedChoice option[value="draft:${draft.id}"]`).waitFor({state:'attached'});
  await page.selectOption('#generatedChoice','draft:'+draft.id);await page.locator('#importGenerated').click();
  await page.waitForFunction(()=>document.querySelectorAll('.listing-thumb').length===10);
  await page.goto(base+'/temu');await page.locator('#nav-dash').click();
  await page.waitForFunction(()=>document.querySelector('#mainImageCount').value==='10');
  await page.locator('#mainImageCount').selectOption('8');await page.waitForFunction(()=>!document.querySelector('#mainBtn').disabled);assert.equal(await page.locator('#generateReviewedPlan').isDisabled(),true);
  await page.locator('#multiSetBtn').click();await page.selectOption('#msCount','2');
  assert.match(await page.locator('#msEstimate').innerText(),/每套 8 张 × 2 套 = 16 张/);
  await page.locator('#msRecommend').click();await page.waitForFunction(()=>document.querySelectorAll('.ms-direction').length===2);
  await page.locator('#msPlanAll').click();await page.waitForSelector('#msGenerateAll');
  await page.locator('#msGenerateAll').click();
  await page.waitForFunction(()=>document.querySelectorAll('.ms-image img').length===16,{},{timeout:30000});
  assert.equal(calls.length,26);
  await page.screenshot({path:path.join(output,'02-eight-per-set.png')});
  await page.locator('[data-action="copy"]').click();await page.selectOption('#msCount','5');
  assert.match(await page.locator('#msEstimate').innerText(),/每套 8 张 × 5 套 = 40 张/);
  await page.locator('[data-action="source"]').click();
  await page.locator('#mainImageCount').selectOption('3');await page.reload();await page.locator('#nav-dash').click();
  await page.waitForFunction(()=>document.querySelector('#mainImageCount').value==='3');
  await page.setViewportSize({width:390,height:844});
  await page.locator('#mainImageCount').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'03-mobile-count.png')});
  assert.equal(await page.locator('#mainImageCount').isVisible(),true);assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,imageRequests:calls.length,paidCalls:0,erpWrites:0,checks:['1/8/10 gallery counts','master selector','ten-image generation','refresh and draft','ERP ten-image import','two sets of eight','copied count','count invalidates plan','mobile control'],errors},null,2));
  console.log('Main image count passed: ten-image single set, two sets of eight, recovery and ERP import (fixtures only).');
}catch(e){await page.screenshot({path:path.join(output,'failure.png')});throw e;}
finally{await browser.close();await new Promise(r=>app.server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
