import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createWorkbench,root} from '../src/server.mjs';
import {clickRequired,getInteractionMetrics} from '../../scripts/douyin/interaction.mjs';

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ec-model-ui-'));
const output=path.join(root,'reference/image-model-selection-20261103');
const captured=[],image2='gpt-image-2',sunburst='gpt-image-2.5-sunburst';
const png=fs.readFileSync(path.join(root,'public/mode-samples/fast_case2.jpg'));
const app=createWorkbench({dataDirectory:directory,configuration:{},provider:async p=>{captured.push(p);return png;}});
const imageUrl=app.saveImage(png);
app.store.task('agent_tasks/ui_plan',{status:'completed',result:'【主图】\n产品摄影',payload:{product_name:'模型验证水杯',custom_layout:{main:1}}});
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.addInitScript(state=>{
  localStorage.setItem('aplus_newbie_tour_v1','true');
  const key='hyrule_state_v13::'+location.host;
  if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(state));
},{generationMode:'master',designScope:'custom',customLayout:{main:1,sub:0,aplus:0,aplusType:'premium'},prodName:'模型验证水杯',prodDesc:'蓝色杯身',sopText:'【主图】\n产品摄影',lastAgentTask:'ui_plan',imageSlots:Array(14).fill(null),activeKieTasks:[],materialMeta:[{id:'reference',filename:'产品主体图',category:'产品主体图',url:imageUrl}],modelChoice:sunburst});
const page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('dialog',dialog=>dialog.accept());
async function chooseModel(label){await clickRequired(page.locator('#modelChoice + .gsel-trigger'));await clickRequired(page.locator('.gsel-pop.show .gsel-item').filter({hasText:label}).last());}
try{
  await page.goto('http://127.0.0.1:'+app.server.address().port);
  await page.waitForLoadState('networkidle');
  assert.deepEqual(await page.locator('#modelChoice option').evaluateAll(options=>options.map(o=>o.value)),[image2,sunburst]);
  assert.equal(await page.locator('#modelChoice').inputValue(),sunburst,'saved choice survives initialization');
  await page.waitForFunction(()=>document.querySelector('#modelChoice + .gsel-trigger').textContent.includes('2.5 Sunburst'));
  assert.match(await page.locator('#modelChoice + .gsel-trigger').innerText(),/2\.5 Sunburst/);
  assert.doesNotMatch(await page.locator('body').innerText(),/算舟|suanzhou/i);
  await clickRequired(page.locator('#mainBtn'));
  await page.waitForFunction(()=>document.querySelector('#slot-0 img')?.src.includes('/media/'));
  assert.equal(captured.length,1);assert.equal(captured[0].model,sunburst);
  await page.reload();await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('#modelChoice').inputValue(),sunburst);
  assert.equal(await page.locator('#prodName').inputValue(),'模型验证水杯');
  assert.equal(await page.locator('#materialPreviewGrid img').count(),1);
  await clickRequired(page.locator('#nav-dash'));
  // Choose the exact Image 2 label (Sunburst also starts with this text).
  await clickRequired(page.locator('#modelChoice + .gsel-trigger'));
  await clickRequired(page.locator('.gsel-pop.show .gsel-item').filter({hasText:/GPT Image 2$/}));
  assert.equal(await page.locator('#modelChoice').inputValue(),image2);
  await page.reload();await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('#modelChoice').inputValue(),image2);
  await clickRequired(page.locator('#nav-dash'));
  await clickRequired(page.locator('#modeBtn_fast'));
  assert.equal(await page.locator('#modelChoice').inputValue(),image2);
  await chooseModel('2.5 Sunburst');
  // Exercise the live browser transport used by auxiliary image tools, which omit model.
  for(const [endpoint,payload] of [
    ['/api/inpaint',{task_id:'ui_edit',prompt:'编辑水杯',image_url:imageUrl}],
    ['/api/ultra_generate',{mode:'ultra_fast',prompt:'水杯',firebase_tasks:[{taskId:'ui_ultra',slot:0}]}],
    ['/api/generate',{mobile_reformat:true,tasks:[{taskId:'ui_mobile',source_image_url:imageUrl}]}]
  ]){
    const result=await page.evaluate(async({endpoint,payload})=>{const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});return response.status;},{endpoint,payload});
    assert.equal(result,202);
  }
  await page.waitForFunction(async()=>{const ids=['ui_edit','ui_ultra','ui_mobile'];return (await Promise.all(ids.map(id=>fetch('/api/tasks/hyrule_tasks/'+id).then(r=>r.json())))).every(t=>t.status==='completed');});
  assert.equal(captured.length,4);assert.ok(captured.every(p=>p.model===sunburst));
  await clickRequired(page.locator('#modelChoice + .gsel-trigger'));
  await page.screenshot({path:path.join(output,'model-options.png'),animations:'disabled'});
  await page.keyboard.press('Escape');
  await clickRequired(page.locator('#rechargeBtn'));
  assert.doesNotMatch(await page.locator('#localStatus').innerText(),/算舟|suanzhou/i);
  assert.match(await page.locator('#localStatus').innerText(),/2\.5 Sunburst/);
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'browser-report.json'),JSON.stringify({passed:true,generations:captured.length,models:captured.map(p=>p.model),errors,interactions:getInteractionMetrics(context),scope:'isolated UI fixture; no external image calls'},null,2));
  console.log('Passed: model selection, saved choice, full main generation, auxiliary transports and neutral customer text.');
}finally{await browser.close();await new Promise(resolve=>app.server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});}
