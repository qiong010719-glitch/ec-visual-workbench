// Local fixture only: no credentials, remote APIs, or paid generation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createWorkbench,root} from '../src/server.mjs';

const output=path.join(root,'tests/results/taobao-simplified');
fs.mkdirSync(path.join(output,'tmp'),{recursive:true});
process.env.TEMP=path.join(output,'tmp');process.env.TMP=process.env.TEMP;
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_URL || 'playwright');
const directory=fs.mkdtempSync(path.join(output,'data-'));
const requests=[],generated=[],errors=[],checks=[];
let fixture;
const app=createWorkbench({dataDirectory:directory,configuration:{},researchOptions:{client:{configured:false}},provider:async request=>{generated.push(request);return fixture;}});
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
assert.notEqual(app.server.address().port,4185);
const address='http://127.0.0.1:'+app.server.address().port;
const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(output,'profile-')),{
  channel:'msedge',headless:true,viewport:{width:1440,height:1100},downloadsPath:path.join(output,'downloads'),
  env:{...process.env,LOCALAPPDATA:path.join(output,'browser-local'),APPDATA:path.join(output,'browser-roaming')}
});
await context.addInitScript(()=>{localStorage.setItem('aplus_newbie_tour_v1','true');localStorage.setItem('hyrule_result_tour_done','true');});
await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin!==address && !['blob:','data:'].includes(url.protocol))return route.abort();
  if(req.method()==='POST' && url.pathname==='/api/agent')return route.abort();
  if(req.method()==='POST' && ['/api/generate','/api/inpaint'].includes(url.pathname))requests.push({path:url.pathname,body:req.postDataJSON()});
  return route.continue();
});
const page=context.pages()[0]||await context.newPage();page.setDefaultTimeout(45000);
page.on('pageerror',e=>errors.push(e.message));
try {
  await page.goto(address,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__customLayout?.taobao?.applied && __idbRestored);
  for(const id of ['tbMainWidth','tbMainHeight','tbSkuFile','tbSetStyle'])assert.equal(await page.locator('#'+id).count(),1);
  assert.match(await page.locator('#tbMainHint').textContent(),/第一张主图可用场景或设计背景/);
  assert.equal(await page.locator('input[name="tbBg"][value="white"]').count(),1);
  checks.push('自定义尺寸、SKU上传、整套风格与按需白底入口保留');
  const source=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=800;canvas.height=1000;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#e6dbcb';ctx.fillRect(0,0,800,1000);
    ctx.fillStyle='#405479';ctx.fillRect(260,330,280,430);ctx.fillStyle='#152642';ctx.font='bold 60px sans-serif';ctx.textAlign='center';ctx.fillText('轻便耐用',400,120);ctx.font='23px sans-serif';ctx.fillText('本地测试样图 · 未真实出图',400,940);
    document.querySelector('#prodName').value='本地验收样品';document.querySelector('#prodDesc').value='完整展示商品';
    document.querySelector('#sopText').value='【主图】\n暖色客厅场景，完整展示商品。文案：轻便耐用';
    window._lastAgentTaskId='fixture_plan';
    imageSlots[0]={url:canvas.toDataURL('image/png'),id:'qa-fixture',finalPrompt:'文案：轻便耐用'};
    window.__customLayout.taobao.textPositions={0:{x:50,y:85}};window.__customLayout.taobao.textAnchors={0:{x:50,y:12}};
    buildGalleryLayout();renderSlot(0);switchView('adventure-log',document.querySelector('#nav-notes'));saveAppState();
    return imageSlots[0].url;
  });
  fixture=Buffer.from(source.split(',')[1],'base64');
  const absent=async()=>{
    for(const selector of ['[data-taobao-text-pin]','[data-taobao-text-origin]','[data-taobao-text-preset]','.taobao-text-stage','.taobao-text-region'])assert.equal(await page.locator(selector).count(),0,selector);
    assert.doesNotMatch(await page.locator('#galleryContainer').textContent(),/待移动原文|拖动.*文字|标记原字位置/);
  };
  await absent();
  await page.waitForFunction(()=>{const image=document.querySelector('#slot-0 > img');return image?.complete && image.naturalWidth===800;});
  await page.waitForFunction(()=>{const image=document.querySelector('#slot-0 > img').getBoundingClientRect();const actions=document.querySelector('#slot-0 .slot-actions').getBoundingClientRect();return actions.top>=image.bottom-1;});
  assert.equal(await page.locator('#slot-0 .slot-actions button').count()>=3,true);
  checks.push('成图上无拖字标记或框；图片与普通编辑、重绘、下载按钮互不遮挡');
  await page.screenshot({path:path.join(output,'01-gallery.png'),fullPage:true});
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem(__LS_KEY)||'{}').prodName==='本地验收样品');
  await page.reload({waitUntil:'networkidle'});
  await page.waitForFunction(()=>imageSlots[0]?.url);
  await page.evaluate(()=>{window._lastAgentTaskId='fixture_plan';switchView('adventure-log',document.querySelector('#nav-notes'));});
  await absent();checks.push('带旧文字位置的存档刷新后，不恢复拖字功能');
  const response=page.waitForResponse(r=>r.url()===address+'/api/generate' && r.request().method()==='POST');
  await page.locator('[data-taobao-redraw="0"]').click();assert.equal((await response).status(),202);
  await page.waitForFunction(()=>imageSlots[0]?.url?.startsWith('/media/') && !activeKieTasks.some(t=>t.slot===0));
  assert.equal(requests.length,1);assert.equal(requests[0].path,'/api/generate');
  assert.equal(requests[0].body.text_move,undefined);assert.equal(requests[0].body.mask_regions,undefined);
  assert.equal(generated.length,1);assert.match(generated[0].prompt,/暖色客厅场景/);
  assert.doesNotMatch(generated[0].prompt,/本图最终约束：白底|白底产品主图|文字位置要求/);
  await absent();checks.push('旧拖字状态下点击重绘仍只提交普通生成；首图场景要求保留，无强制白底');
  assert.deepEqual(errors,[]);
  await page.waitForFunction(()=>{const image=document.querySelector('#slot-0 > img');return image?.complete && !image.classList.contains('img-reveal');});
  await page.screenshot({path:path.join(output,'02-after-redraw.png'),fullPage:true});
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({checks,errors,requests:requests.map(r=>({path:r.path,text_move:r.body.text_move??false})),providerCalls:generated.length,realProviderCalls:0},null,2));
  console.log(JSON.stringify({checks,realProviderCalls:0,output}));
} finally {
  await context.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));
}
