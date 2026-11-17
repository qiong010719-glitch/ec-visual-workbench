import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createWorkbench,root} from '../src/server.mjs';
import {clickRequired,getInteractionMetrics} from '../tools/interaction.mjs';

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ec-download-ui-'));
const output=path.join(root,'../runs/image-download-fix-20261101');fs.mkdirSync(output,{recursive:true});
const ultra=process.argv.includes('--ultra'),slotPrefix=ultra?'#ultra-slot-':'#slot-';
let generations=0,downloads=0;
const bytes=fs.readFileSync(path.join(root,'public/mode-samples/ultra_1.jpg'));
const app=createWorkbench({legacyUi:true,dataDirectory:directory,configuration:{},provider:async()=>{generations++;throw new Error('Generation must not run during download recovery');},download:async()=>{downloads++;return bytes;}});
app.store.task('hyrule_tasks/recovery_fixture',{taskId:'recovery_fixture',slot:0,status:'failed',phase:'download_failed',resultUrl:'https://generated.example/result.png',error:'图片下载超时',createdAt:new Date().toISOString()});
app.store.task('hyrule_tasks/queued_fixture',{taskId:'queued_fixture',slot:1,status:'pending',phase:'queued'});
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.addInitScript(state=>{
  localStorage.setItem('aplus_newbie_tour_v1','true');
  const key='hyrule_state_v13::'+location.host;
  if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(state));
},{generationMode:ultra?'ultra_fast':'fast',designScope:ultra?'ultra_main_8':'main_and_6',prodName:'下载恢复验证',prodDesc:'本地验证数据',sopText:'【主图】\n产品图\n【卖点图1】\n细节图',imageSlots:Array(14).fill(null),activeKieTasks:[{slot:0,taskId:'recovery_fixture',isInpaint:true},...(ultra?[]:[{slot:1,taskId:'queued_fixture',isInpaint:true}])],modelChoice:'gpt-image-2'});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
if(process.env.DOWNLOAD_UI_BASELINE==='1')for(const name of ['workbench.js','bridge.js'])await page.route('**/local/'+name,route=>route.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(output,'before/public/local',name),'utf8')}));
try {
  await page.goto('http://127.0.0.1:'+app.server.address().port);
  await page.locator(slotPrefix+'0 [data-download-retry]').waitFor({state:'visible',timeout:5000});
  assert.match(await page.locator(slotPrefix+'0').innerText(),/图片已生成/);
  if(!ultra){
    await page.waitForFunction(()=>document.querySelector('#slot-1')?.textContent.includes('排队中'));
    app.store.task('hyrule_tasks/queued_fixture',{status:'running',phase:'downloading',downloadAttempt:2});
    await page.waitForFunction(()=>document.querySelector('#slot-1')?.textContent.includes('下载重试'));
  }
  await clickRequired(page.locator(slotPrefix+'0 [data-download-retry]'));
  await page.waitForFunction(selector=>[...document.querySelectorAll(selector)].some(img=>img.naturalWidth>0),slotPrefix+'0 img');
  assert.equal(downloads,1);assert.equal(generations,0);assert.equal(app.store.state.charges.length,0);
  await clickRequired(page.locator('#nav-dash'));
  await clickRequired(page.locator('#localDownloadsButton'));
  await page.locator('#localDownloads a[download]').waitFor({state:'visible'});
  await clickRequired(page.locator('#localDownloads [data-close]'));
  await page.reload();
  await page.waitForFunction(selector=>[...document.querySelectorAll(selector)].some(img=>img.naturalWidth>0),slotPrefix+'0 img');
  await clickRequired(page.locator(ultra?'#nav-ultra':'#nav-notes'));
  await page.screenshot({path:path.join(output,`download-recovery-${ultra?'ultra':'fast'}-ui.png`)});
  assert.equal(downloads,1);assert.equal(generations,0);assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,`browser-verification-${ultra?'ultra':'fast'}.json`),JSON.stringify({passed:true,generations,downloads,checks:['下载失败显示恢复入口','排队与下载状态区分','重试只下载一次','恢复记录可下载','刷新后图片保留'],interactions:getInteractionMetrics(context),errors},null,2));
  console.log('通过：下载恢复、阶段提示、无重复生图、刷新保留。');
} catch(error) {
  console.log(JSON.stringify({errors,slot:await page.locator(slotPrefix+'0').evaluate(el=>el.outerHTML,{},{timeout:1000}).catch(()=>null),body:(await page.locator('body').innerText()).slice(-2500)},null,2));
  await page.screenshot({path:path.join(output,'download-recovery-failure.png')});throw error;
} finally {
  await browser.close();await new Promise(resolve=>app.server.close(resolve));
  fs.rmSync(directory,{recursive:true,force:true});
}
