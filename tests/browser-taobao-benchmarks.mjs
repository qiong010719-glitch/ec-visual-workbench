// Full benchmark-to-Taobao UI flow. All capture, vision and image services are local fixtures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createWorkbench,root} from '../src/server.mjs';

const output=path.join(root,'tests/results/taobao-benchmarks');
fs.mkdirSync(path.join(output,'tmp'),{recursive:true});
process.env.TEMP=path.join(output,'tmp');process.env.TMP=process.env.TEMP;
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE_URL || 'playwright');
const directory=fs.mkdtempSync(path.join(output,'data-'));
const fixtures={},generated=[],requests=[],errors=[],external=[],checks=[];
const captureCalls=[],analysisCalls=[];
const benchmarkLayout={background:'本地参考图的暖色背景',palette:['米色'],typography:'上方标题，下方标签',reading_order:['title','product'],regions:[{id:'title',kind:'text',box:[0.05,0.03,0.9,0.12],description:'顶部标题',style:'居中大字',max_chars:16},{id:'product',kind:'product',box:[0.1,0.2,0.8,0.7],description:'下部商品'}]};
const app=createWorkbench({dataDirectory:directory,configuration:{},researchOptions:{client:{configured:false}},benchmarkOptions:{
  source:{configured:async()=>true,resolve:async url=>({url,itemId:'123456789'}),getItem:async id=>{captureCalls.push(id);return {title:'仅作对标的商品',groups:{main:['https://img.alicdn.com/main.png'],sku:['https://img.alicdn.com/sku.jpg'],detail:['https://img.alicdn.com/detail.webp']}};}},
  download:async url=>fixtures[url.includes('detail')?'detail':url.includes('sku')?'sku':'main'].bytes,
  analyze:async bytes=>{analysisCalls.push(bytes.length);return benchmarkLayout;}
},provider:async request=>{
  generated.push(request);
  return fixtures[/只制作当前这一张 【高级A\+模块1】/.test(request.prompt)?'detail':/只制作当前这一张 【卖点图1】/.test(request.prompt)?'sku':'main'].bytes;
}});
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
assert.notEqual(app.server.address().port,4185);
const address='http://127.0.0.1:'+app.server.address().port;
const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(output,'profile-')),{
  channel:'msedge',headless:true,viewport:{width:1600,height:1100},downloadsPath:path.join(output,'downloads'),acceptDownloads:true,
  env:{...process.env,LOCALAPPDATA:path.join(output,'browser-local'),APPDATA:path.join(output,'browser-roaming')}
});
await context.addInitScript(()=>{localStorage.setItem('aplus_newbie_tour_v1','true');localStorage.setItem('hyrule_result_tour_done','true');});
await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.origin!==address && !['data:','blob:'].includes(url.protocol)){external.push(url.origin);return route.abort();}
  if(request.method()==='POST' && ['/api/agent','/api/generate','/api/inpaint'].includes(url.pathname))requests.push({path:url.pathname,body:request.postDataJSON()});
  return route.continue();
});
const page=context.pages()[0]||await context.newPage();page.setDefaultTimeout(30000);
page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
const input=async(id,value)=>{await page.locator('#'+id).fill(value);await page.locator('#'+id).dispatchEvent('change');};
const field=async(id,value)=>{await page.locator('#'+id).click();await page.locator('#feTextarea').fill(value);await page.locator('#fieldEditorModal .modal-btn-confirm').click();};
const download=async(action,filename)=>{
  const event=page.waitForEvent('download');await action();const result=await event;
  await result.saveAs(path.join(output,filename));return result;
};
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
try {
  await page.goto(address,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__customLayout?.taobao?.applied && __idbRestored);
  const images=await page.evaluate(()=>{
    const specs=[['main',600,600,'image/png'],['sku',640,800,'image/jpeg'],['detail',750,1100,'image/webp']];
    return specs.map(([key,width,height,mime])=>{
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#d9e7ec';ctx.fillRect(0,0,width,height);
      ctx.fillStyle=key==='sku'?'#965146':'#24475f';ctx.fillRect(width*.3,height*.3,width*.4,height*.4);
      ctx.font='24px sans-serif';ctx.fillStyle='#172c3d';ctx.textAlign='center';ctx.fillText('本地流程测试 · '+key,width/2,70);
      ctx.font='20px sans-serif';ctx.fillText('模拟图片，未真实出图',width/2,height-40);
      return {key,width,height,mime,url:canvas.toDataURL(mime)};
    });
  });
  for(const item of images)fixtures[item.key]={...item,bytes:Buffer.from(item.url.split(',')[1],'base64')};
  await page.locator('#modeBtn_fast').click();
  for(const [id,value] of [['tbMainCount','1'],['tbSkuCount','1'],['tbDetailCount','1'],['tbMainWidth','800'],['tbMainHeight','1200']])await input(id,value);
  await page.locator('#tbSetStyle').selectOption('warm_mood');
  await field('prodName','淘宝流程验收样品');await field('prodDesc','测试资料：蓝色主体，红色SKU规格，仅用于本地界面验收。');
  const chooser=page.waitForEvent('filechooser');
  await page.locator('[onclick="openUploader(\'产品主体图\')"]').click();
  await(await chooser).setFiles({name:'主体.png',mimeType:'image/png',buffer:fixtures.main.bytes});
  await page.locator('#tbSkuFile').setInputFiles({name:'红色SKU.jpg',mimeType:'image/jpeg',buffer:fixtures.sku.bytes});
  await page.waitForFunction(()=>window.__workbenchMaterials().length===2);
  await page.locator('#tbSkuUploadCount').filter({hasText:'已上传 1 张'}).waitFor();
  await page.locator('#customEditBtn').click();
  const cards=page.locator('#customSlotCards > div');
  assert.equal(await cards.count(),3);
  for(const [index,label] of [[0,'淘宝主图 1'],[1,'SKU图 1'],[2,'详情 1']])assert.equal(await cards.nth(index).locator('.font-bold').first().textContent(),label);
  assert.equal(await page.locator('#clAplusType').isVisible(),false);
  assert.match(await cards.nth(1).textContent(),/参考图：SKU图_1；结合本款填写信息/);
  assert.equal(await cards.nth(1).locator('[onclick^="toggleCustomRef"]').first().isVisible(),false);
  await cards.nth(0).locator('textarea').fill('主图专属：暖色客厅展示完整商品');
  await cards.nth(1).locator('textarea').fill('规格专属：保持红色外观');
  await cards.nth(2).locator('textarea').fill('详情专属：展示产品细节');
  await cards.nth(0).locator('[onclick^="toggleCustomRef"]').first().click();
  await page.locator('#customConfirmBtn').click();
  checks.push('真实界面填写资料、上传主体/SKU图、选择风格/尺寸、逐张要求和参考图');
  await page.locator('#taobaoBenchmarks summary').click();
  await page.locator('#tbBenchmarkLink').fill('https://item.taobao.com/item.htm?id=123456789');
  await page.locator('#tbBenchmarkFetch').click();
  await page.waitForFunction(()=>document.querySelector('#tbBenchmarkAssets').children.length===3);
  for(const [slot,id] of [[0,'main_1'],[1,'sku_1'],[7,'detail_1']])await page.locator('select[data-benchmark-slot="'+slot+'"]').selectOption(id);
  assert.equal(generated.length,0);assert.equal(analysisCalls.length,0);assert.equal(captureCalls.length,1);
  assert.equal(await page.locator('select[data-benchmark-slot="7"] option[value="main_1"]').count(),0);
  await page.locator('#tbBenchmarkAnalyze').click();
  await page.waitForFunction(()=>document.querySelector('#tbBenchmarkEnabled').checked);
  assert.equal(analysisCalls.length,3);assert.equal(generated.length,0);
  assert.equal(await page.evaluate(()=>window.__workbenchMaterials().length),2,'benchmark images stay out of own-product materials');
  await page.locator('#taobaoBenchmarks').screenshot({path:path.join(output,'benchmark-panel.png')});
  await page.reload({waitUntil:'networkidle'});
  await page.waitForFunction(()=>__idbRestored && document.querySelector('#tbBenchmarkEnabled')?.checked && document.querySelector('#tbBenchmarkAssets').children.length===3);
  assert.equal(await page.locator('select[data-benchmark-slot="1"]').inputValue(),'sku_1');
  assert.equal(captureCalls.length,1);assert.equal(analysisCalls.length,3);
  checks.push('读取链接、分类取图、逐张绑定、版式分析、刷新恢复；对标与本品素材隔离；分析不生图');
  await page.locator('#agentBtn').click();await page.locator('#agentConfirmOk').click();
  await page.waitForFunction(()=>document.querySelector('#sopText').value.includes('详情专属'));
  const plannedText=await page.locator('#sopText').inputValue();
  assert.match(plannedText,/画幅 2:3/);
  assert.match(plannedText,/画幅 3:4/);
  assert.doesNotMatch(plannedText,/21:9|横幅|宽幅/);
  await page.waitForFunction(()=>!document.querySelector('#championsOverlay').classList.contains('show'));
  await page.locator('#mainBtn').click();
  await page.waitForFunction(()=>[0,1,7].every(i=>imageSlots[i]?.url) && activeKieTasks.length===0);
  await page.locator('#_ratingSkip').waitFor({state:'visible'});await page.locator('#_ratingSkip').click();
  assert.equal(generated.length,3);assert.equal(requests.filter(r=>r.path==='/api/inpaint').length,0);
  const payload=requests.find(r=>r.path==='/api/generate').body;
  const sku=payload.categorized_images.find(item=>item.filename==='SKU图_1');
  assert.ok(sku?.url);const benchmarkState=await page.evaluate(()=>JSON.parse(localStorage.getItem('taobao-benchmark-v1')));
  const benchmarkJob=app.benchmarks.get(benchmarkState.jobId);
  assert.deepEqual(generated.find(r=>r.prompt.includes('只制作当前这一张 【卖点图1】')).references,[sku.url,benchmarkJob.assets.find(a=>a.id==='sku_1').localUrl]);
  assert.equal(payload.slot_directives.find(d=>d.slot===1).taobao_role,'sku');
  const skuPrompt=generated.find(r=>r.references[0]===sku.url).prompt;
  assert.match(skuPrompt,/SKU规格确认/);assert.match(skuPrompt,/对标图，仅参考适合SKU/);
  assert.doesNotMatch(skuPrompt,/10%—20%|要点，一眼看清/);
  for(const request of generated)assert.match(request.prompt,/最后1张只定义本图版式/);
  for(const request of generated)assert.match(request.prompt,/整套风格：暖色氛围/);
  assert.match(generated.find(r=>r.prompt.includes('只制作当前这一张 【主图】')).prompt,/主图专属/);
  for(const [slot,size] of [[0,'600×600'],[1,'640×800'],[7,'750×1100']]) {
    await page.locator('#slot-'+slot+' .taobao-image-size').filter({hasText:size}).waitFor();
    assert.equal(await page.locator('#slot-'+slot+' [data-taobao-redraw]').count(),1);
    assert.equal(await page.locator('#slot-'+slot+' button').filter({hasText:'重绘这一张'}).count(),1);
  }
  assert.match(await page.locator('#slot-0 .taobao-image-size').textContent(),/构图目标 800×1200/);
  assert.doesNotMatch(await page.locator('#galleryContainer').textContent(),/INPAINT|REDRAW|DOWNLOAD|待移动原文/);
  checks.push('主图、SKU、详情完整模拟链路；SKU引用正确；每张一个重绘按钮；实际尺寸与构图目标分开显示');
  await page.waitForFunction(()=>document.querySelectorAll('.tb-benchmark-comparison').length===3);
  checks.push('三类成图分别绑定准确对标；SKU仍用自己的SKU身份图；结果显示对应版式参考');
  const before=await page.evaluate(()=>imageSlots.map(item=>item?.url));
  await page.locator('#nav-dash').click();await page.locator('#customEditBtn').click();
  await cards.nth(0).locator('textarea').fill('更新要求：保持客厅场景');await page.locator('#customConfirmBtn').click();
  assert.deepEqual(await page.evaluate(()=>imageSlots.map(item=>item?.url)),before);
  await page.reload({waitUntil:'networkidle'});
  await page.waitForFunction(()=>__idbRestored && imageSlots[7]?.url);
  assert.equal(await page.locator('#tbMainWidth').inputValue(),'800');assert.equal(await page.locator('#tbMainHeight').inputValue(),'1200');
  assert.equal(await page.locator('#tbSetStyle').inputValue(),'warm_mood');
  assert.equal(await page.evaluate(()=>window.__customLayout.directives[0].req),'更新要求：保持客厅场景');
  assert.equal(await page.evaluate(()=>window.__workbenchMaterials().filter(m=>m.category==='SKU图').length),1);
  assert.deepEqual(await page.evaluate(()=>imageSlots.map(item=>item?.url)),before);
  await page.locator('#nav-notes').click();
  checks.push('修改逐张要求保留已有成图；刷新恢复资料、SKU素材、风格、尺寸、逐张要求和3张结果');
  await page.locator('#nav-dash').click();await page.locator('#localDraftButton').click();await page.locator('#draftNew').click();
  await page.locator('#draftTitle').fill('可恢复的淘宝案例');await page.locator('#draftForm button[type="submit"]').click();
  await page.locator('#draftError').filter({hasText:'已保存'}).waitFor();
  const saved=app.store.state.drafts.find(d=>d.title==='可恢复的淘宝案例');assert.ok(saved.workbench);
  assert.equal(saved.workbench.benchmark.mapping[7].assetId,'detail_1');
  await page.locator('#localDraftEditor [data-close]').click();
  await field('prodName','切换前未保存的另一个商品');await field('strictReq','这段文字不能串入恢复后的草稿');
  await page.locator('#tbBenchmarkClear').click();
  await page.locator('#tbSetStyle').selectOption('minimal');
  await page.locator('#localDraftButton').click();
  await page.locator('#draftCards .local-card').filter({hasText:'可恢复的淘宝案例'}).locator('[data-restore]').click();
  await page.waitForFunction(()=>!document.querySelector('#localDraftList').open&&document.querySelector('#prodName').value==='可恢复的淘宝案例');
  assert.ok(app.store.state.drafts.some(d=>d.title.includes('切换前未保存的另一个商品')),'unsaved work is backed up');
  assert.equal(await page.locator('#strictReq').inputValue(),saved.workbench.app.strictReq,'empty fields clear old product data');
  assert.equal(await page.locator('#tbSetStyle').inputValue(),'warm_mood');
  assert.equal(await page.evaluate(()=>window.__workbenchMaterials().length),2);
  assert.equal(await page.locator('select[data-benchmark-slot="7"]').inputValue(),'detail_1');
  await page.reload({waitUntil:'networkidle'});await page.waitForFunction(()=>__idbRestored&&document.querySelectorAll('.tb-benchmark-comparison').length===3);
  assert.deepEqual(await page.evaluate(()=>imageSlots.map(item=>item?.url)),before);
  assert.equal(generated.length,3);assert.equal(analysisCalls.length,3);assert.equal(captureCalls.length,1);
  checks.push('完整草稿恢复本品、SKU、逐图要求、风格、对标和成图；清空旧商品字段；自动备份切换前内容；刷新无额外付费请求');
  await page.locator('#nav-notes').click();
  const single=await download(()=>page.locator('#slot-0 button[onclick="downloadSingle(0)"]').click(),'single.png');
  assert.equal(single.suggestedFilename(),'淘宝主图1_600x600.png');
  assert.equal(digest(fs.readFileSync(path.join(output,'single.png'))),digest(fixtures.main.bytes));
  await page.evaluate(url=>{imageSlots[13]={url,id:'old-hidden-slot'};},before[0]);
  const archive=await download(()=>page.locator('#batchBtnContainer').click(),'complete.zip');
  assert.equal(archive.suggestedFilename(),'淘宝图片_3张.zip');
  async function zipFiles(filename) {
    return page.evaluate(async b64=>{
      const zip=await JSZip.loadAsync(b64,{base64:true}),out={};
      for(const [name,entry] of Object.entries(zip.files))if(!entry.dir)out[name]=await entry.async('base64');
      return out;
    },fs.readFileSync(path.join(output,filename)).toString('base64'));
  }
  const files=await zipFiles('complete.zip');
  assert.deepEqual(Object.keys(files).sort(),['SKU图1_640x800.jpg','淘宝主图1_600x600.png','详情1_750x1100.webp'].sort());
  for(const [name,key] of [['淘宝主图1_600x600.png','main'],['SKU图1_640x800.jpg','sku'],['详情1_750x1100.webp','detail']])assert.equal(digest(Buffer.from(files[name],'base64')),digest(fixtures[key].bytes));
  checks.push('单图和ZIP使用中文分类、实际像素与正确扩展名；PNG/JPEG/WebP下载字节均与原文件一致');
  await page.waitForFunction(()=>document.querySelector('#batchBtnContainer .btn-split-bottom').textContent.indexOf('正在打包')<0);
  await page.evaluate(()=>{imageSlots[1].url='/media/missing-fixture.jpg';});
  await download(()=>page.locator('#batchBtnContainer').click(),'partial.zip');
  const partial=await zipFiles('partial.zip');assert.equal(Object.keys(partial).length,3);
  assert.match(Buffer.from(partial['未下载图片.txt'],'base64').toString('utf8'),/SKU图 1/);
  assert.equal(generated.length,3,'download failures cannot submit generation');
  await page.evaluate(url=>{imageSlots[1].url=url;renderSlot(1);},before[1]);
  checks.push('缺失图片时明确列出未下载项，其他图片可下载，不重新生图');
  await page.waitForFunction(()=>[...document.querySelectorAll('#galleryContainer img')].every(img=>img.complete&&!img.classList.contains('img-reveal')));
  await page.screenshot({path:path.join(output,'gallery.png'),fullPage:true});
  await page.setViewportSize({width:1600,height:1600});
  await page.locator('#nav-dash').click();await page.locator('#taobaoShell').screenshot({path:path.join(output,'panel.png')});
  await page.locator('#customEditBtn').click();
  await page.locator('#customLayoutModal .prompt-modal-box').screenshot({path:path.join(output,'requirements.png')});
  await page.locator('#customLayoutModal button[onclick="cancelCustomLayout()"]').click();
  await page.locator('#tbBenchmarkClear').click();
  assert.equal(await page.locator('#tbBenchmarkAssets a').count(),0);
  assert.equal(await page.locator('#tbBenchmarkEnabled').isChecked(),false);
  assert.equal(await page.evaluate(()=>window.__workbenchMaterials().length),2);
  assert.equal(captureCalls.length,1);assert.equal(analysisCalls.length,3);assert.equal(generated.length,3);
  checks.push('清除对标不删除本品素材或成图，不追加模型请求');
  const failedId='empty-fixture',failed={id:failedId,status:'failed',assets:[],warnings:[],error:'Apify 任务已结束，但没有抓到这个商品（返回0条商品记录），因此没有取得图片。',acquisition:{runId:'fixtureRun1',usageTotalUsd:0.009,resultCount:0,resultCode:'EMPTY_RESULT'}};
  await page.route(address+'/api/taobao/benchmarks/'+failedId,route=>route.fulfill({json:failed}));
  await page.evaluate(id=>TaobaoBenchmarkState.restore({jobId:id,mapping:{},enabled:false,sourceUrl:'https://item.taobao.com/item.htm?id=123456789'}),failedId);
  assert.match(await page.locator('#tbBenchmarkMessage').textContent(),/返回0条商品记录/);
  assert.match(await page.locator('#tbBenchmarkTitle').textContent(),/读取未完成/);
  assert.equal(await page.locator('#tbBenchmarkBindings select').count(),0);
  assert.equal(await page.locator('#tbBenchmarkAnalyze').isDisabled(),true);
  assert.equal(await page.locator('#tbBenchmarkRun').getAttribute('href'),'https://console.apify.com/actors/runs/fixtureRun1');
  assert.match(await page.locator('#tbBenchmarkCost').textContent(),/0.0090/);
  assert.equal(captureCalls.length,1);assert.equal(analysisCalls.length,3);assert.equal(generated.length,3);
  checks.push('抓取空结果明确提示0条，隐藏空的逐图绑定，保留已有费用和原运行链接，不触发重抓/分析/生图');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,checks,errors,external,simulatedGenerations:generated.length,realModelCalls:0},null,2));
  console.log(JSON.stringify({passed:true,checks,simulatedGenerations:generated.length,realModelCalls:0,output}));
} catch(error) {
  await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});
  fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:error.message,checks,errors,external,requests:requests.map(r=>r.path)},null,2));
  throw error;
} finally {
  await context.close();app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));
}
