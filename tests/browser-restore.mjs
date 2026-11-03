import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createWorkbench,root} from '../src/server.mjs';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ec-restore-'));
const app=createWorkbench({dataDirectory:directory,configuration:{}});
const url=app.saveImage(fs.readFileSync(path.join(root,'public/mode-samples/ultra_1.jpg')));
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext();
const images=Array(14).fill(null);images[0]={url,id:'restored_fixture'};
await context.addInitScript(state=>{
  localStorage.setItem('aplus_newbie_tour_v1','true');
  const key='hyrule_state_v13::'+location.host;
  if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(state));
},{generationMode:'ultra_fast',designScope:'ultra_main_8',prodName:'刷新恢复验收',prodDesc:'保存的数据',sopText:'保存的设计方案',imageSlots:images,materialMeta:[{id:'test',filename:'主体1',category:'产品主体图',url}],activeKieTasks:[],modelChoice:'gpt-image-2'});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
  for(let i=0;i<2;i++) {
    if(i)await page.reload();else await page.goto('http://127.0.0.1:'+app.server.address().port);
    await page.waitForFunction(()=>document.querySelector('#prodName').value==='刷新恢复验收');
    assert.equal(await page.locator('#generationMode').inputValue(),'ultra_fast');
    assert.equal(await page.locator('#designScope').inputValue(),'ultra_main_8');
    await page.locator('.ultra-card-img').waitFor({state:'visible'});
    assert.equal(await page.locator('.ultra-card-img').getAttribute('src'),url);
    await page.locator('.ultra-card-img').evaluate(img=>img.decode());
    assert.ok(await page.locator('.ultra-card-img').evaluate(img=>img.naturalWidth>0));
  }
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(async()=>{
    await new Promise(requestAnimationFrame);
    await Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{})));
  });
  await page.screenshot({path:path.join(root,'tests/results/06-mobile.png')});
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(root,'tests/results/restore-report.json'),JSON.stringify({passed:true,checks:['启动过程中不覆盖已保存资料','极速模式、输出范围与结果图恢复','连续两次重开保持一致'],errors},null,2));
  console.log('通过：启动持久化保护、极速模式与图片连续两次恢复。');
} finally {await browser.close();await new Promise(resolve=>app.server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});}
