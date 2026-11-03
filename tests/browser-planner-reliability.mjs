import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createWorkbench,root} from '../src/server.mjs';

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ec-planner-ui-'));
const output=path.join(root,'reference/planner-reliability-20261102');
fs.mkdirSync(output,{recursive:true});
let generations=0;
const app=createWorkbench({dataDirectory:directory,configuration:{},provider:async()=>{generations++;throw new Error('No image generation allowed in this UI test');}});
app.store.task('agent_tasks/timeout_fixture',{status:'running',payload:{product_name:'构思恢复验证',product_desc:'蓝色盒身'},createdAt:new Date().toISOString()});
const imageUrl=app.saveImage(fs.readFileSync(path.join(root,'public/mode-samples/fast_case2.jpg')));
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.addInitScript(state=>{
  localStorage.setItem('aplus_newbie_tour_v1','true');
  const key='hyrule_state_v13::'+location.host;
  if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(state));
},{generationMode:'master',designScope:'main_6_premium_aplus',prodName:'构思恢复验证',prodDesc:'蓝色盒身',sopText:'PREVIOUS_APPROVED_PLAN',activeAgentTask:'timeout_fixture',lastAgentTask:'previous_success',imageSlots:Array(14).fill(null),activeKieTasks:[],materialMeta:[{id:'reference',filename:'产品主体图',category:'产品主体图',url:imageUrl}],modelChoice:'gpt-image-2'});
const page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
  await page.goto('http://127.0.0.1:'+app.server.address().port);
  await page.waitForFunction(()=>document.querySelector('#championsOverlay').classList.contains('show'));
  app.store.task('agent_tasks/timeout_fixture',{status:'failed',errorCode:'PLANNER_TIMEOUT',error:'构思服务请求超时（已等待 300 秒），本次未取得完整方案。商品资料已保留，不会自动重复提交。 <img src=x onerror="window.injected=true">'});
  await page.waitForFunction(()=>!document.querySelector('#championsOverlay').classList.contains('show'));
  assert.equal(await page.locator('#prodName').inputValue(),'构思恢复验证');
  assert.equal(await page.locator('#sopText').inputValue(),'PREVIOUS_APPROVED_PLAN');
  assert.equal(await page.locator('#materialPreviewGrid img').count(),1);
  assert.equal(await page.locator('#generationMode').inputValue(),'master');
  assert.equal(await page.evaluate(()=>window.injected),undefined);
  assert.equal(await page.locator('#errorDesc img').count(),0);
  assert.doesNotMatch(await page.locator('#errorDesc').innerText(),/不会扣除任何积分|简化「详细卖点」|更换生成模式/);
  assert.match(await page.locator('#errorDesc').innerText(),/超时|服务商记录/);
  assert.equal(generations,0);
  await page.screenshot({path:path.join(output,'timeout-ui.png'),animations:'disabled'});
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#prodName').value==='构思恢复验证');
  assert.equal(await page.locator('#sopText').inputValue(),'PREVIOUS_APPROVED_PLAN');
  assert.equal(await page.locator('#materialPreviewGrid img').count(),1);
  assert.equal(await page.evaluate(()=>activeAgentTask),null);
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'browser-report.json'),JSON.stringify({passed:true,generations,errors,checks:['timeout closes progress','product/materials/mode/prior plan retained','error text rendered safely','no unsupported free-retry claim','reload preserves previous inputs'],scope:'isolated UI fixture, no external model calls'},null,2));
  console.log('Passed: planning timeout UI, state preservation, safe error text, no image generation.');
}finally{
  await browser.close();await new Promise(resolve=>app.server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});
}
