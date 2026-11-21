// All generated media are labeled fixtures. No external or paid service is used.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createWorkbench,root} from '../src/server.mjs';
const output=path.join(root,'tests/results/taobao-sku-input');fs.mkdirSync(path.join(output,'tmp'),{recursive:true});
process.env.TEMP=path.join(output,'tmp');process.env.TMP=process.env.TEMP;
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_URL||'playwright');
const calls=[],requests=[],errors=[],external=[],checks=[];let product;
const app=createWorkbench({dataDirectory:fs.mkdtempSync(path.join(output,'data-')),configuration:{},provider:async p=>{calls.push(p);return product;}});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));assert.notEqual(app.server.address().port,4185);
const base='http://127.0.0.1:'+app.server.address().port;
const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(output,'profile-')),{channel:'msedge',headless:true,viewport:{width:1600,height:1400},env:{...process.env,LOCALAPPDATA:path.join(output,'browser-local'),APPDATA:path.join(output,'browser-roaming')}});
await context.addInitScript(()=>{localStorage.setItem('aplus_newbie_tour_v1','true');localStorage.setItem('hyrule_result_tour_done','true');});
await context.route('**/*',route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==base&&!['blob:','data:'].includes(url.protocol)){external.push(url.origin);return route.abort();}if(req.method()==='POST'&&['/api/agent','/api/generate'].includes(url.pathname))requests.push({path:url.pathname,body:req.postDataJSON()});return route.continue();});
const page=context.pages()[0]||await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
const field=async(id,value)=>{await page.locator('#'+id).click();await page.locator('#feTextarea').fill(value);await page.locator('#fieldEditorModal .modal-btn-confirm').click();};
const entry=(index,key)=>page.locator(`[data-sku-index="${index}"] [data-sku-field="${key}"]`);
const plan=async()=>{await page.locator('#nav-dash').click();await page.locator('#agentBtn').click();await page.locator('#agentConfirmOk').click();await page.waitForFunction(()=>!activeAgentTask&&document.querySelector('#sopText').value.includes('SKU规格确认'));await page.waitForFunction(()=>!document.querySelector('#championsOverlay').classList.contains('show'));};
const finish=async before=>{await page.locator('#mainBtn').click();await page.waitForFunction(old=>activeKieTasks.length===0&&[0,1,2,7].every(i=>imageSlots[i]?.url&&imageSlots[i].url!==old[i]),before||[]);await page.locator('#_ratingSkip').waitFor({state:'visible'});await page.locator('#_ratingSkip').click();};
try{
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>__idbRestored&&window.__customLayout?.taobao?.applied);
  const fixture=async(label,color)=>Buffer.from(await page.evaluate(({label,color})=>{const c=document.createElement('canvas');c.width=600;c.height=600;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,600,600);x.fillStyle='#172535';x.font='24px sans-serif';x.fillText(label,40,250);x.fillText('流程测试素材，不是真实生成',40,310);return c.toDataURL('image/png').split(',')[1];},{label,color}),'base64');
  product=await fixture('产品外观参考','#b8cfdf');const small=await fixture('SKU小号 40cm x 60cm','#e7c997'),large=await fixture('SKU大号 80cm x 120cm','#b7d8af');
  await page.locator('#modeBtn_fast').click();for(const [id,n] of [['tbMainCount','1'],['tbSkuCount','2'],['tbDetailCount','1']]){await page.locator('#'+id).fill(n);await page.locator('#'+id).dispatchEvent('change');}
  await field('prodName','帆布油画');await field('prodDesc','保持上传图中的外观');
  const chooser=page.waitForEvent('filechooser');await page.locator('[onclick="openUploader(\'产品主体图\')"]').click();await(await chooser).setFiles({name:'product.png',mimeType:'image/png',buffer:product});await page.waitForFunction(()=>__workbenchMaterials().length===1);
  assert.equal(await page.locator('#tbSkuPhoto,#tbSkuManual').count(),0);
  await page.locator('#agentBtn').click();await page.locator('#tbSkuError').filter({hasText:'上传图片或至少填写'}).waitFor();assert.equal(requests.length,0);
  await entry(0,'width').fill('0');await page.locator('#agentBtn').click();await page.locator('#tbSkuError').filter({hasText:'大于0'}).waitFor();assert.equal(requests.length,0);
  for(const [i,name,width,height] of [[0,'小号','40','60'],[1,'大号','80','120']]){await entry(i,'name').fill(name);await entry(i,'width').fill(width);await entry(i,'height').fill(height);}
  const upload=async(i,name,buffer)=>{
    const chooser=page.waitForEvent('filechooser');await page.locator(`[data-sku-index="${i}"] [data-sku-upload]`).click();
    await(await chooser).setFiles({name,mimeType:'image/png',buffer});await page.locator(`[data-sku-index="${i}"] [data-sku-preview]`).waitFor({state:'visible'});
  };
  await upload(0,'small.png',small);await upload(1,'large.png',large);
  await page.waitForFunction(()=>__workbenchMaterials().length===3);
  const ids=await page.evaluate(()=>__customLayout.taobao.skuSpecs.map(s=>s.photoId));assert.notEqual(ids[0],ids[1]);
  checks.push('图片与信息在同一SKU卡片，两个上传入口分别绑定；空卡片和0尺寸在构思提交前拦截');
  await page.locator('#tbSkuCount').fill('1');await page.locator('#tbSkuCount').dispatchEvent('change');await page.locator('#tbSkuCount').fill('2');await page.locator('#tbSkuCount').dispatchEvent('change');assert.equal(await entry(1,'width').inputValue(),'80');
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>__idbRestored);await page.locator('#nav-dash').click();
  assert.equal(await entry(0,'width').inputValue(),'40');assert.equal(await entry(1,'height').inputValue(),'120');
  assert.deepEqual(await page.evaluate(()=>__customLayout.taobao.skuSpecs.map(s=>s.photoId)),ids);
  await page.locator('[data-sku-index="0"]').screenshot({path:path.join(output,'sku-image-and-info.png')});
  checks.push('减少再增加SKU数量与刷新均保留每款图片绑定、名称、尺寸和单位');
  await plan();await finish();assert.equal(calls.length,4);
  const material=await page.evaluate(()=>__workbenchMaterials().map(({id,filename,url})=>({id,filename,url}))),own=material.find(m=>m.filename==='产品主体图_1').url;
  const skuCalls=calls.filter(p=>p.prompt.includes('本图职责：SKU规格确认'));assert.equal(skuCalls.length,2);
  for(const [i,width,other] of [[0,40,80],[1,80,40]]){
    const call=skuCalls.find(p=>p.prompt.includes('"宽":"'+width+'cm"'));
    assert.ok(call);assert.deepEqual(call.references,[material.find(m=>m.id===ids[i]).url]);assert.ok(!call.prompt.includes('"宽":"'+other+'cm"'));
  }
  const urls=await page.evaluate(()=>imageSlots.map(s=>s?.url));checks.push('两款模拟生成请求同时携带各自图片和所填规格，互不串款');
  await page.locator('#nav-dash').click();await page.locator('#localDraftButton').click();await page.locator('#draftNew').click();await page.locator('#draftTitle').fill('SKU图片与信息草稿');await page.locator('#draftForm button[type="submit"]').click();await page.locator('#draftError').filter({hasText:'已保存'}).waitFor();
  const saved=app.store.state.drafts.find(d=>d.title==='SKU图片与信息草稿');assert.equal(saved.workbench.app.customLayout.taobao.skuSpecs[1].height,'120');assert.equal(saved.workbench.app.customLayout.taobao.skuSpecs[1].photoId,ids[1]);
  await page.locator('#localDraftEditor [data-close]').click();await entry(0,'width').fill('41');await page.locator('#mainBtn').click();await page.locator('#logContent').filter({hasText:'重新构思'}).waitFor();assert.equal(calls.length,4);assert.deepEqual(await page.evaluate(()=>imageSlots.map(s=>s?.url)),urls);
  await page.locator('#nav-dash').click();await page.locator('#localDraftButton').click();await page.locator('#draftCards .local-card').filter({hasText:'SKU图片与信息草稿'}).locator('[data-restore]').click();await page.waitForFunction(()=>!document.querySelector('#localDraftList').open);assert.equal(await entry(0,'width').inputValue(),'40');assert.equal(calls.length,4);
  checks.push('完整草稿恢复图片与信息；修改尺寸后旧方案被拒绝且保留已有成图');
  await page.locator('#nav-dash').click();await page.locator('[data-sku-index="0"] [data-sku-remove]').click();
  assert.equal(await entry(0,'width').inputValue(),'40');assert.equal(await page.locator('[data-sku-index="0"] [data-sku-preview]').isVisible(),false);
  assert.equal(await page.locator('[data-sku-index="1"] [data-sku-photo]').inputValue(),ids[1]);
  assert.equal(await page.evaluate(id=>__workbenchMaterials().find(m=>m.id===id).filename,ids[1]),'SKU图_1');
  // Choosing an existing material must not be undone by the select's input event.
  await page.locator('[data-sku-index="0"] [data-sku-photo]').selectOption(ids[1]);
  assert.equal(await page.locator('[data-sku-index="0"] [data-sku-photo]').inputValue(),ids[1]);
  await page.locator('[data-sku-index="0"] [data-sku-photo]').selectOption('');
  assert.equal(await page.locator('[data-sku-index="1"] [data-sku-photo]').inputValue(),ids[1]);
  checks.push('删除第一款图片后第二款仍绑定原图；选取已有图可用，清除绑定保留填写信息');
  await plan();await finish(urls);assert.equal(calls.length,8);
  const mixed=calls.slice(4).filter(p=>p.prompt.includes('本图职责：SKU规格确认'));
  assert.deepEqual(mixed.find(p=>p.prompt.includes('"宽":"40cm"')).references,[own]);
  assert.deepEqual(mixed.find(p=>p.prompt.includes('"宽":"80cm"')).references,[material.find(m=>m.id===ids[1]).url]);
  checks.push('同一套允许部分SKU有图、部分仅填尺寸；无图款只取产品主体图，不借用别款图');
  const status=await(await fetch(base+'/api/status')).json();status.skuInputVersion=1;await page.route(base+'/api/status',route=>route.fulfill({json:status}));
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>__idbRestored);await page.locator('#nav-dash').click();const count=requests.length;await page.locator('#agentBtn').click();await page.locator('#tbSkuError').filter({hasText:'尚未加载SKU图片与信息合并功能'}).waitFor();assert.equal(requests.length,count);assert.equal(calls.length,8);
  checks.push('旧服务提前阻断，不静默丢弃合并输入');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const report={passed:true,checks,fixtureImageCalls:calls.length,realImageCalls:0,realPlannerCalls:0,errors,external};fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:error.message,checks,errors,requests:requests.map(r=>r.path)},null,2));throw error;}
finally{await context.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
