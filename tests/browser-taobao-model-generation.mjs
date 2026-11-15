// Browser proof uses distinct labeled fixtures. It does not verify facial likeness or spend credits.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createWorkbench,root} from '../src/server.mjs';
const output=path.join(root,'tests/results/taobao-model-generation');fs.mkdirSync(path.join(output,'tmp'),{recursive:true});
process.env.TEMP=path.join(output,'tmp');process.env.TMP=process.env.TEMP;
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_URL||'playwright');
const calls=[],requests=[],errors=[],external=[],checks=[],dialogs=[];
let uploaded,generated,release,accept=false;
const gate=new Promise(r=>release=r);
const app=createWorkbench({dataDirectory:fs.mkdtempSync(path.join(output,'data-')),configuration:{},provider:async p=>{calls.push(p);if(p.kind==='model-reference'){await gate;return generated;}return uploaded;}});
await new Promise(r=>app.server.listen(0,'127.0.0.1',r));assert.notEqual(app.server.address().port,4185);
const base='http://127.0.0.1:'+app.server.address().port;
const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(output,'profile-')),{channel:'msedge',headless:true,viewport:{width:1600,height:1500},acceptDownloads:true,downloadsPath:path.join(output,'downloads'),env:{...process.env,LOCALAPPDATA:path.join(output,'browser-local'),APPDATA:path.join(output,'browser-roaming')}});
await context.addInitScript(()=>{localStorage.setItem('aplus_newbie_tour_v1','true');localStorage.setItem('hyrule_result_tour_done','true');});
await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin!==base&&!['blob:','data:'].includes(url.protocol)){external.push(url.origin);return route.abort();}
  if(req.method()==='POST'&&['/api/agent','/api/generate','/api/taobao/models/generate'].includes(url.pathname))requests.push({path:url.pathname,body:req.postDataJSON()});
  // Simulate an accepted POST whose response is lost. Only subsequent GETs may recover it.
  if(req.method()==='POST'&&url.pathname==='/api/taobao/models/generate'){await route.fetch();return route.abort('failed');}
  return route.continue();
});
const page=context.pages()[0]||await context.newPage();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.stack));page.on('dialog',d=>{dialogs.push(d.message());return accept?d.accept():d.dismiss();});
const field=async(id,value)=>{await page.locator('#'+id).click();await page.locator('#feTextarea').fill(value);await page.locator('#fieldEditorModal .modal-btn-confirm').click();};
try{
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>__idbRestored&&window.__customLayout?.taobao?.applied&&document.querySelector('#tbModelPresence'));
  assert.equal(await page.locator('#tbModelGenerationMessage').textContent(),'');
  const fixture=async(label,color)=>Buffer.from(await page.evaluate(({label,color})=>{const c=document.createElement('canvas');c.width=600;c.height=800;const x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,600,800);x.fillStyle='#20303a';x.font='24px sans-serif';x.fillText(label,40,350);x.fillText('流程测试素材，并非真实模特',40,400);return c.toDataURL('image/png').split(',')[1];},{label,color}),'base64');
  uploaded=await fixture('上传来源测试图','#b8d1df');generated=await fixture('系统来源测试图','#e3d3b0');
  await page.locator('#modeBtn_fast').click();
  for(const id of ['tbMainCount','tbSkuCount','tbDetailCount']){await page.locator('#'+id).fill('1');await page.locator('#'+id).dispatchEvent('change');}
  await field('prodName','固定模特柜子');await field('prodDesc','白色门板，保持规格');
  const chooser=page.waitForEvent('filechooser');await page.locator('[onclick="openUploader(\'产品主体图\')"]').click();await(await chooser).setFiles({name:'own.png',mimeType:'image/png',buffer:uploaded});
  await page.locator('#tbSkuFile').setInputFiles({name:'sku.png',mimeType:'image/png',buffer:uploaded});await page.waitForFunction(()=>__workbenchMaterials().length===2);
  await page.locator('#tbModelPresence').selectOption('yes');
  await page.locator('#tbModelFile').setInputFiles({name:'上传模特.png',mimeType:'image/png',buffer:uploaded});await page.locator('#tbModelMessage').filter({hasText:'模特参考已保存'}).waitFor();
  const original=await page.evaluate(()=>TaobaoModelState.capture());assert.equal(original.source,'upload');
  await page.locator('#tbModelSource').selectOption('generated');await page.locator('#tbModelDescription').fill('成年模特，米色衬衫');
  await page.locator('#tbModelGenerate').click();await page.waitForFunction(()=>!document.querySelector('#tbModelGenerate').disabled);
  assert.equal(requests.length,0);assert.equal(calls.length,0);assert.deepEqual(await page.evaluate(()=>TaobaoModelState.capture()),original);
  assert.match(dialogs[0],/确认付费生成/);checks.push('切换来源、取消费用确认均不提交；上传人物仍为已选模特');
  accept=true;await page.locator('#tbModelGenerate').click();
  await page.locator('#tbModelGenerationMessage').filter({hasText:'正在生成'}).waitFor();
  assert.equal(calls.length,1);assert.equal(await page.locator('#tbModelGenerate').isDisabled(),true);
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>__idbRestored);await page.locator('#nav-dash').click();
  await page.locator('#tbModelGenerationMessage').filter({hasText:'正在生成'}).waitFor();assert.equal(calls.length,1);
  assert.equal(requests.filter(r=>r.path==='/api/taobao/models/generate').length,1);
  assert.deepEqual(await page.evaluate(()=>TaobaoModelState.capture()),original);
  checks.push('已受理POST丢失响应、生成中刷新只查询原任务，不重复收费或更换已选人物');
  release();await page.locator('#tbModelCandidate').waitFor({state:'visible'});
  assert.deepEqual(await page.evaluate(()=>TaobaoModelState.capture()),original,'candidate must not auto-select');
  await page.locator('#tbModelUse').click();const selected=await page.evaluate(()=>TaobaoModelState.capture());
  assert.equal(selected.source,'generated');assert.notEqual(selected.id,original.id);assert.equal(selected.references[0].sha256,crypto.createHash('sha256').update(generated).digest('hex'));
  assert.equal(await page.evaluate(()=>__workbenchMaterials().length),2);
  await page.locator('#taobaoModel').screenshot({path:path.join(output,'two-sources.png')});
  checks.push('候选完成后必须明确使用才替换人物；独立身份、原图与哈希，不混进本品素材');
  await page.locator('#agentBtn').click();await page.locator('#agentConfirmOk').click();await page.waitForFunction(()=>!activeAgentTask&&document.querySelector('#sopText').value.includes('模特出镜'));await page.waitForFunction(()=>!document.querySelector('#championsOverlay').classList.contains('show'));
  await page.locator('#mainBtn').click();await page.waitForFunction(()=>[0,1,7].every(i=>imageSlots[i]?.url)&&activeKieTasks.length===0);await page.locator('#_ratingSkip').waitFor({state:'visible'});await page.locator('#_ratingSkip').click();
  assert.equal(calls.length,4);for(const call of calls.slice(1)){assert.equal(call.references.at(-1),selected.references[0].url);assert.ok(!call.references.includes(original.references[0].url));}
  await page.locator('#nav-dash').click();
  await page.locator('#localDraftButton').click();await page.locator('#draftNew').click();await page.locator('#draftTitle').fill('系统模特草稿');await page.locator('#draftForm button[type="submit"]').click();await page.locator('#draftError').filter({hasText:'已保存'}).waitFor();
  const saved=app.store.state.drafts.find(d=>d.title==='系统模特草稿');assert.deepEqual(saved.workbench.modelIdentity,selected);
  await page.locator('#localDraftEditor [data-close]').click();await page.locator('#tbModelClear').click();
  await page.locator('#localDraftButton').click();await page.locator('#draftCards .local-card').filter({hasText:'系统模特草稿'}).locator('[data-restore]').click();await page.waitForFunction(()=>!document.querySelector('#localDraftList').open&&TaobaoModelState.capture().source==='generated');
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>__idbRestored);await page.locator('#nav-dash').click();assert.deepEqual(await page.evaluate(()=>TaobaoModelState.capture()),selected);
  checks.push('主图/SKU/详情三种请求复用同一个系统模特；完整草稿、刷新保留同一来源与生成任务');
  const [zip]=await Promise.all([page.waitForEvent('download'),page.locator('#tbModelExport').click()]);await zip.saveAs(path.join(output,'generated-model-pack.zip'));
  const pack=await page.evaluate(async b64=>{const z=await JSZip.loadAsync(b64,{base64:true}),manifest=JSON.parse(await z.file('model-identity.json').async('string'));return {manifest,bytes:await z.file(manifest.references[0].file).async('base64')};},fs.readFileSync(path.join(output,'generated-model-pack.zip')).toString('base64'));
  assert.equal(pack.manifest.generationTaskId,selected.generationTaskId);assert.deepEqual(Buffer.from(pack.bytes,'base64'),generated);assert.equal(pack.manifest.videoGeneration,'not_implemented');assert.equal(pack.manifest.videoReview,'not_reviewed');
  checks.push('视频共用包保留系统模特原图、身份、任务来源；不冒称视频已接通或人脸已验收');
  const status=await(await fetch(base+'/api/status')).json();delete status.modelGenerationVersion;
  await page.route(base+'/api/status',route=>route.fulfill({json:status}));await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>__idbRestored);await page.locator('#nav-dash').click();
  const requestCount=requests.length;await page.locator('#agentBtn').click();await page.locator('#tbModelMessage').filter({hasText:'尚未加载系统模特功能'}).waitFor();assert.equal(requests.length,requestCount);
  await page.locator('#tbModelDescription').fill('成年模特，黑色衬衫');const before=dialogs.length;
  await page.locator('#tbModelGenerate').click();await page.locator('#tbModelMessage').filter({hasText:'尚未加载系统模特功能'}).waitFor();
  assert.equal(dialogs.length,before);assert.equal(calls.length,4);assert.equal(requests.filter(r=>r.path==='/api/taobao/models/generate').length,1);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  checks.push('旧后端缺少系统模特能力时，在费用确认和生成请求之前阻断');
  const report={passed:true,checks,fixtureImageCalls:calls.length,realImageCalls:0,realVideoCalls:0,external,errors};fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:error.message,checks,errors,requests:requests.map(r=>r.path)},null,2));throw error;}
finally{release();await context.close();app.server.closeAllConnections();await new Promise(r=>app.server.close(r));}
