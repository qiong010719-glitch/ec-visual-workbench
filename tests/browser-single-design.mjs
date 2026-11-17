import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createWorkbench,root} from '../src/server.mjs';
import {buildPlan} from '../src/planner.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'single-design-ui-'));
const output=path.join(root,'tests/results/single-design');fs.mkdirSync(output,{recursive:true});
const sample=await sharp({create:{width:120,height:120,channels:3,background:'#54789a'}}).png().toBuffer();
let release,plans=0,images=0;
const app=createWorkbench({dataDirectory:dir,configuration:{WORKBENCH_FRESH:'true'},planner:async p=>{
  plans++;if(p.product_name==='失败测试')throw new Error('构思服务超时');
  if(p.product_name==='刷新测试')await new Promise(r=>{release=r;});
  return buildPlan(p,[]);
},provider:async()=>{images++;return sample;}});
const source=app.saveImage(sample);await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true});const errors=[],dialogs=[],checks=[];
async function pageFor(mode,name){
  const context=await browser.newContext({viewport:{width:1440,height:1050}});
  await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  await context.addInitScript(({source,mode,name})=>{
    for(const key of ['aplus_newbie_tour_v1','hyrule_result_tour_done','hyrule_veteran'])localStorage.setItem(key,'true');
    const key='hyrule_state_v13::temu::'+location.host;
    if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({generationMode:mode,designScope:'main_count',mainImageCount:1,prodName:name,prodDesc:'单幅蓝色帆布画，保留商品外观',materialMeta:[{id:'subject',filename:'产品主体图.png',category:'产品主体图',url:source}],modelChoice:'gpt-image-2',imageSlots:Array(14).fill(null),activeKieTasks:[]}));
  },{source,mode,name});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{dialogs.push(d.message());d.dismiss();});
  await page.goto(base+'/temu');await page.waitForFunction(()=>typeof __idbRestored!=='undefined'&&__idbRestored&&document.querySelector('#generateReviewedPlan'));
  await page.waitForFunction(()=>!document.querySelector('#mainBtn').disabled);
  return page;
}
const complete=page=>page.waitForFunction(()=>document.querySelector('#singleGenerationStatus').textContent.includes('图片已完成')&&activeKieTasks.length===0);
try{
  for(const mode of ['fast','master']){
    const page=await pageFor(mode,'一体化测试'),before={plans,images};
    await page.locator('#mainBtn').click();await complete(page);
    assert.equal(plans,before.plans+1);assert.equal(images,before.images+1);
    assert.equal(await page.locator('#galleryContainer .quest-slot img').count(),1);
    assert.equal(dialogs.length,0);
    await page.evaluate(()=>openLocalDraftEditor());await page.waitForSelector('#temuSharedDialog');
    assert.equal(app.store.state.drafts.at(-1).images.length,1);
    checks.push(mode+' one-click and draft export');await page.context().close();
  }
  const page=await pageFor('master','刷新测试'),before={plans,images};
  let postCount=0;await page.route('**/api/single-design',async route=>{postCount++;await route.fetch();await route.abort();});
  await page.locator('#mainBtn').click();await page.waitForFunction(()=>document.querySelector('#singleGenerationStatus').textContent.includes('构思'));
  await page.evaluate(()=>{document.querySelector('#mainBtn').click();document.querySelector('#mainBtn').click();});
  await page.reload();await page.waitForFunction(()=>document.querySelector('#singleGenerationStatus').textContent.includes('正在构思'));
  assert.equal(postCount,1);assert.equal(plans,before.plans+1);assert.equal(images,before.images);
  release();await complete(page);assert.equal(images,before.images+1);assert.equal(postCount,1);
  await page.locator('#nav-dash').click();await page.screenshot({path:path.join(output,'one-click.png')});
  checks.push('double click, lost POST response and reload do not duplicate calls');await page.context().close();
  const failed=await pageFor('fast','失败测试'),beforeImages=images;
  await failed.locator('#mainBtn').click();await failed.waitForFunction(()=>document.querySelector('#singleGenerationStatus').textContent.includes('构思未完成'));
  assert.equal(images,beforeImages);assert.equal(await failed.locator('#mainBtn').isDisabled(),false);
  assert.equal(await failed.locator('#prodName').inputValue(),'失败测试');checks.push('planner failure stops and retains inputs');
  await failed.screenshot({path:path.join(output,'failure-stopped.png')});await failed.context().close();
  assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,checks,plans,images,paidCalls:0,errors},null,2));console.log(JSON.stringify({passed:true,checks,plans,images,paidCalls:0}));
}finally{await browser.close();await new Promise(r=>app.server.close(r));}
