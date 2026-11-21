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
  await page.locator('#agentBtn').click();await page.locator('#tbSkuError').filter({hasText:'请先上传SKU图'}).waitFor();assert.equal(requests.length,0);
  await page.locator('#tbSkuManual').click();assert.equal(await page.locator('#tbSkuManual').getAttribute('aria-pressed'),'true');assert.equal(await page.locator('#tbSkuUpload').isVisible(),false);
  await page.locator('#agentBtn').click();await page.locator('#tbSkuError').filter({hasText:'SKU图 1 至少填写'}).waitFor();assert.equal(requests.length,0);
  await entry(0,'width').fill('0');await page.locator('#agentBtn').click();await page.locator('#tbSkuError').filter({hasText:'大于0'}).waitFor();assert.equal(requests.length,0);
  for(const [i,name,width,height] of [[0,'小号','40','60'],[1,'大号','80','120']]){await entry(i,'name').fill(name);await entry(i,'width').fill(width);await entry(i,'height').fill(height);}
  checks.push('两个模式可点击；缺少上传图、空尺寸和0尺寸均在构思提交前拦截');
  await page.locator('#tbSkuCount').fill('1');await page.locator('#tbSkuCount').dispatchEvent('change');await page.locator('#tbSkuCount').fill('2');await page.locator('#tbSkuCount').dispatchEvent('change');assert.equal(await entry(1,'width').inputValue(),'80');
  await page.locator('#tbSkuPhoto').click();const skuChooser=page.waitForEvent('filechooser');await page.locator('#tbSkuUpload').click();await(await skuChooser).setFiles([{name:'small.png',mimeType:'image/png',buffer:small},{name:'large.png',mimeType:'image/png',buffer:large}]);await page.waitForFunction(()=>__workbenchMaterials().length===3);
  await page.locator('#tbSkuManual').click();assert.equal(await entry(1,'height').inputValue(),'120');
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>__idbRestored);await page.locator('#nav-dash').click();assert.equal(await page.locator('#tbSkuManual').getAttribute('aria-pressed'),'true');assert.equal(await entry(0,'width').inputValue(),'40');assert.equal(await entry(1,'height').inputValue(),'120');
  await page.locator('#taobaoShell').screenshot({path:path.join(output,'manual-dimensions.png')});
  checks.push('切换模式、减少再增加SKU数量和刷新均保留各SKU尺寸与已上传图');
  await plan();await finish();assert.equal(calls.length,4);
  const material=await page.evaluate(()=>__workbenchMaterials().map(({filename,url})=>({filename,url}))),own=material.find(m=>m.filename==='产品主体图_1').url;
  const skuCalls=calls.filter(p=>p.prompt.includes('本图职责：SKU规格确认'));assert.equal(skuCalls.length,2);
  for(const p of skuCalls)assert.deepEqual(p.references,[own]);
  assert.ok(skuCalls.some(p=>p.prompt.includes('"宽":"40cm"')&&!p.prompt.includes('"宽":"80cm"')));assert.ok(skuCalls.some(p=>p.prompt.includes('"宽":"80cm"')&&!p.prompt.includes('"宽":"40cm"')));
  const urls=await page.evaluate(()=>imageSlots.map(s=>s?.url));checks.push('手填模式实际模拟请求逐SKU带正确尺寸，只用本品主体图，不读取未启用的SKU图');
  await page.locator('#nav-dash').click();await page.locator('#localDraftButton').click();await page.locator('#draftNew').click();await page.locator('#draftTitle').fill('手填尺寸草稿');await page.locator('#draftForm button[type="submit"]').click();await page.locator('#draftError').filter({hasText:'已保存'}).waitFor();
  const saved=app.store.state.drafts.find(d=>d.title==='手填尺寸草稿');assert.equal(saved.workbench.app.customLayout.taobao.skuSpecs[1].height,'120');
  await page.locator('#localDraftEditor [data-close]').click();await entry(0,'width').fill('41');await page.locator('#mainBtn').click();await page.locator('#logContent').filter({hasText:'重新构思'}).waitFor();assert.equal(calls.length,4);assert.deepEqual(await page.evaluate(()=>imageSlots.map(s=>s?.url)),urls);
  await page.locator('#nav-dash').click();await page.locator('#tbSkuPhoto').click();await page.locator('#localDraftButton').click();await page.locator('#draftCards .local-card').filter({hasText:'手填尺寸草稿'}).locator('[data-restore]').click();await page.waitForFunction(()=>!document.querySelector('#localDraftList').open&&document.querySelector('#tbSkuManual').getAttribute('aria-pressed')==='true');assert.equal(await entry(0,'width').inputValue(),'40');assert.equal(calls.length,4);
  checks.push('修改尺寸后旧方案被拒绝且保留成图；完整草稿恢复手填模式、各SKU尺寸和单位');
  await page.locator('#nav-dash').click();await page.locator('#tbSkuPhoto').click();await plan();await finish(urls);assert.equal(calls.length,8);
  const photoCalls=calls.slice(4).filter(p=>p.prompt.includes('本图职责：SKU规格确认'));
  assert.deepEqual(photoCalls.map(p=>p.references[0]).sort(),material.filter(m=>m.filename.startsWith('SKU图_')).map(m=>m.url).sort());
  for(const p of photoCalls){assert.equal(p.references.length,1);assert.ok(!p.prompt.includes('本SKU已确认数据'));}
  checks.push('上传模式重新构思后分别使用两张对应SKU图，忽略仍保存的手填尺寸');
  const status=await(await fetch(base+'/api/status')).json();delete status.skuInputVersion;await page.route(base+'/api/status',route=>route.fulfill({json:status}));
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>__idbRestored);await page.locator('#nav-dash').click();const count=requests.length;await page.locator('#agentBtn').click();await page.locator('#tbSkuError').filter({hasText:'尚未加载SKU尺寸功能'}).waitFor();assert.equal(requests.length,count);assert.equal(calls.length,8);
  checks.push('旧服务缺少SKU输入能力时提前阻断，不静默忽略尺寸');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const report={passed:true,checks,fixtureImageCalls:calls.length,realImageCalls:0,realPlannerCalls:0,errors,external};fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:error.message,checks,errors,requests:requests.map(r=>r.path)},null,2));throw error;}
finally{await context.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
