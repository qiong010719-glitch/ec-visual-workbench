import {_electron as electron} from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import readline from 'node:readline';
import sharp from 'sharp';
import {merchantFixture} from './merchant-fixture.mjs';

const output=path.resolve('../outputs/desktop-experience-20261109',process.env.AUDIT_PASS||'before');fs.mkdirSync(output,{recursive:true});
const desktopData=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-experience-'));
const sample=fs.readFileSync('public/mode-samples/fast_case2.jpg');
let imageCalls=0,failImage=false;const writes=[];
const f=await merchantFixture({titlePlanner:async g=>g.sets.map((s,i)=>({setId:s.id,title:'Canvas Wall Art Design '+(i+1),englishTitle:'Canvas Wall Art Design '+(i+1)})),provider:async()=>{imageCalls++;if(failImage){failImage=false;throw new Error('验收模拟：图片服务临时不可用，请重试失败图片');}return sample;},erpAdapter:{
  checkConnection:async()=>({connected:true,erpOpen:true,loggedIn:true,account:'audit-merchant',accountMatched:true}),
  openLogin:async()=>({message:'验收模拟登录连接'}),
  runDraft:async args=>{writes.push({store:args.store.key,mother:args.store.draftId,code:args.row.productCode});args.onProgress('saving');return {draftId:'AUDIT-'+writes.length,url:'https://www.dianxiaomi.com/web/popTemu/edit?id=123456789',published:false,sourceUnchanged:true};}
}});
f.templateCatalog.push({id:'701',name:'验收帆布画模板'},{id:'702',name:'验收装饰画模板'});
const initial=f.app.preferences.view();f.app.preferences.update({revision:initial.revision,stores:[],erpConnections:[],browsers:[]});
for(const dir of ['CANVAS-A','CANVAS-B'])await sharp(sample).png().toFile(path.join(f.input,dir,'01.png'));
const environment={...process.env,WORKBENCH_DESKTOP_TEST:'true',WORKBENCH_DESKTOP_DATA:desktopData};
for(const key of ['ELECTRON_RUN_AS_NODE','SUANZHOU_IMAGE_API_KEY','SUANZHOU_API_KEY','PLANNER_API_KEY','VISION_API_KEY'])delete environment[key];
const app=await electron.launch({args:['.'],env:environment,timeout:60000});
const page=await app.firstWindow(),errors=[],steps=[],checks=[];
await page.locator('#intake').waitFor({timeout:45000});await page.waitForLoadState('load');
page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.on('page-title-updated',e=>{e.preventDefault();win.setTitle('独立验收窗口 · Temu 工作台');});win.setTitle('独立验收窗口 · Temu 工作台');});
const origin=new URL(page.url()).origin;
await page.route(url=>url.origin===origin&&(url.pathname.startsWith('/api/')||url.pathname.startsWith('/media/')),async route=>{
  try{const url=new URL(route.request().url());const request=route.request(),headers={...request.headers(),host:new URL(f.base).host};if(headers.origin)headers.origin=f.base;if(headers.referer)headers.referer=f.base+'/';const response=await fetch(f.base+url.pathname+url.search,{method:request.method(),headers,body:['GET','HEAD'].includes(request.method())?undefined:request.postDataBuffer(),signal:AbortSignal.timeout(20000)});await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});}
  catch(error){console.log('PROXY_ERROR '+error.message);await route.abort();}
});
const lineReader=process.env.AUDIT_INTERACTIVE==='true'?readline.createInterface({input:process.stdin,terminal:false}):null;
const iterator=lineReader?.[Symbol.asyncIterator]();
async function capture(name,notes={}){
  await page.evaluate(()=>new Promise(resolve=>{let last=scrollY,stable=0,frames=0;function settle(){stable=scrollY===last?stable+1:0;last=scrollY;if(stable>=8||++frames>180)resolve();else requestAnimationFrame(settle);}requestAnimationFrame(settle);}));
  await page.screenshot({path:path.join(output,name+'.png'),fullPage:false,animations:'disabled'});
  fs.writeFileSync(path.join(output,name+'.aria.txt'),await page.locator('body').ariaSnapshot());
  const metrics=await page.evaluate(()=>{
    const header=document.querySelector('.workbench-header')?.getBoundingClientRect();
    const notice=document.querySelector('#notice:not([hidden]),#listingNotice:not([hidden])');const box=notice?.getBoundingClientRect();
    return {viewport:{width:innerWidth,height:innerHeight},overflow:document.documentElement.scrollWidth>innerWidth,headerBottom:header?.bottom,notice:box?{text:notice.textContent,top:box.top,bottom:box.bottom,coveredByHeader:box.top<(header?.bottom||0)&&box.bottom>0}:null};
  });
  steps.push({name,url:page.url(),notes,metrics});fs.writeFileSync(path.join(output,'steps.json'),JSON.stringify(steps,null,2));
  assert.equal(metrics.overflow,false,name+' must fit the desktop width');
  if(process.env.AUDIT_VERIFY==='true'){
    if(name==='03-settings-saved'){assert.equal(metrics.notice.coveredByHeader,false);assert.ok(metrics.notice.top>=metrics.headerBottom&&metrics.notice.bottom<metrics.viewport.height);}
    const next={'06-planned':'generateBatch','07-generation-failure':'retryBatch','08-generated':'reviewGenerated'}[name];
    if(next)assert.deepEqual(await page.locator('#generationPanel .toolbar .primary').evaluateAll(nodes=>nodes.map(n=>n.id)),[next]);
    if(name==='07-generation-failure')assert.equal(await page.locator('#generateBatch').isDisabled(),true);
    if(name==='09-review'){assert.equal(await page.locator('[data-row="0"] [data-earlier]').first().isDisabled(),true);assert.match(await page.locator('#prepareHint').textContent(),/已选择 验收加拿大店/);}
  }
  console.log(JSON.stringify({checkpoint:name,screenshot:path.join(output,name+'.png'),metrics,notes}));
  if(iterator&&steps.length>=Number(process.env.AUDIT_RESUME_AT||1)){console.log('CHECKPOINT_READY');const next=await iterator.next();if(next.done||next.value.trim()==='stop')throw new Error('Audit stopped at checkpoint');}
}
async function saveForm(form){const response=page.waitForResponse(r=>r.url().endsWith('/api/settings')&&r.request().method()==='POST');await page.locator(form==='#storeForm'?'#saveStore':form+' button.primary').click();assert.equal((await response).status(),200);}
try{
  await page.reload();await page.locator('#intake').waitFor();
  assert.equal(await page.evaluate(()=>typeof window.desktop.chooseFolder),'function');
  await capture('01-first-launch',{goal:'首次打开，寻找下一步；当前为无店铺的独立验收环境'});

  await page.getByRole('link',{name:'设置',exact:true}).click();await page.locator('#modelForm').waitFor();
  await capture('02-settings-entry',{goal:'查找模型、浏览器、ERP与母稿的配置顺序'});
  await page.locator('#browserForm [name="type"]').selectOption('chrome');await page.locator('#browserForm [name="name"]').fill('验收浏览器');await page.locator('#browserForm [name="debugPort"]').fill('9339');await saveForm('#browserForm');
  await page.locator('#erpForm [name="name"]').fill('验收店小秘');await page.locator('#erpForm [name="expectedAccount"]').fill('audit-merchant');await saveForm('#erpForm');
  await page.locator('#storeForm [name="expectedStore"]').fill('验收加拿大店');await page.locator('#storeForm [name="expectedSite"]').fill('加拿大站');await page.locator('#continueStore').click();
  await page.locator('[data-template="0"] [data-field="name"]').fill('帆布画');await page.locator('[data-template="0"] [data-field="draftId"]').fill('https://www.dianxiaomi.com/web/popTemu/edit?id=220114595116064422');
  await page.click('#addTemplate');await page.locator('[data-template="1"] [data-field="name"]').fill('装饰画');await page.locator('[data-template="1"] [data-field="draftId"]').fill('https://www.dianxiaomi.com/web/popTemu/edit?id=220114595116854972');
  await saveForm('#storeForm');await capture('03-settings-saved',{goal:'在长页面底部保存后，能否看见成功反馈'});
  const settings=await f.api('/api/settings'),store=settings.stores[0];assert.deepEqual(store.templates.map(t=>t.draftId),['220114595116064422','220114595116854972']);checks.push('两份长ID母稿通过桌面表单独立保存');

  await page.getByRole('link',{name:'店铺上架',exact:true}).click();await page.selectOption('#targetStore',store.key);
  await page.fill('#folderPath',path.join(f.dir,'不存在的素材'));await page.click('#importFolder');await page.waitForFunction(()=>document.querySelector('#listingNotice').classList.contains('error'));
  await capture('04-invalid-folder',{goal:'错误路径能否给出可操作的提示'});
  await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},f.input);
  await page.click('#browseFolder');assert.equal(await page.inputValue('#folderPath'),f.input);await page.click('#importFolder');await page.locator('[data-product="1"]').waitFor();
  await page.locator('[data-product="0"] [data-field="name"]').fill('暖色装饰画');await page.locator('[data-product="1"] [data-field="name"]').fill('客厅装饰画');
  await page.locator('[data-product="0"] [data-field="count"]').fill('1');await page.locator('[data-product="1"] [data-field="count"]').fill('1');await page.locator('[data-product="1"] [data-field="templateKey"]').selectOption(store.templates[1].key);await page.selectOption('#imageCount','2');
  await page.locator('#createBatch').scrollIntoViewIfNeeded();await capture('05-import-and-edit',{goal:'检查产品资料、图片、母稿、数量和主操作布局'});
  await page.click('#createBatch');await page.locator('#generationPanel').waitFor();const batchId=await page.evaluate(()=>JSON.parse(localStorage.getItem('listing-active-task')).id);
  await page.click('#planBatch');await page.waitForFunction(()=>document.querySelector('#generationState').textContent==='方案与标题已就绪');
  await page.locator('#generationPanel').scrollIntoViewIfNeeded();await capture('06-planned',{goal:'是否明确区分构思完成、尚未生图、标题保存及下一步'});
  await page.locator('#batchProducts [data-title="title"]').first().fill('Warm Canvas Art for Living Room');await page.locator('[data-save-titles]').first().click();await page.waitForFunction(()=>document.querySelector('#listingNotice').textContent.includes('标题与英文版本已保存'));
  await page.reload();await page.locator('#generationPanel').waitFor();assert.equal(await page.locator('#batchProducts [data-title="title"]').first().inputValue(),'Warm Canvas Art for Living Room');checks.push('标题保存后刷新恢复');
  failImage=true;await page.click('#generateBatch');await page.waitForFunction(()=>document.querySelector('#generationState').textContent==='需要处理');
  await page.locator('#generationPanel').scrollIntoViewIfNeeded();await capture('07-generation-failure',{goal:'模拟一张图片失败，定位原因及重试入口；图片来自仓库样例，不代表实际模型质量'});
  const callsBeforeRetry=imageCalls;await page.click('#retryBatch');await page.waitForFunction(()=>document.querySelector('#generationState').textContent==='素材已完成');assert.equal(imageCalls,callsBeforeRetry+1);checks.push('失败重试只补一张图片');
  await capture('08-generated',{goal:'生成完成后，文件位置、图片与进入核对的入口是否明确'});
  const generated=await f.api('/api/products/'+batchId);assert.ok(fs.existsSync(generated.resultPackage.workbook));
  await page.click('#reviewGenerated');await page.locator('.listing-row').nth(1).waitFor();
  await page.locator('#reviewPanel').scrollIntoViewIfNeeded();await capture('09-review',{goal:'核对标题、图片顺序、逐商品母稿与执行方式'});
  const firstCode=await page.getByLabel('商品1货号').inputValue(),secondImage=await page.locator('[data-row="0"] [data-earlier]').nth(1).getAttribute('data-earlier');await page.locator('[data-row="0"] [data-earlier]').nth(1).click();await page.reload();await page.locator('.listing-row').nth(1).waitFor();assert.equal(await page.getByLabel('商品1货号').inputValue(),firstCode);assert.equal(await page.locator('[data-row="0"] [data-earlier]').first().getAttribute('data-earlier'),secondImage);checks.push('图片排序刷新恢复');
  await page.click('#prepareBatch');await page.locator('#executionPanel').waitFor();await capture('10-execution-ready',{goal:'执行前能否清楚判断店铺、条目和仅保存草稿的范围'});
  await page.click('#startBatch');await page.waitForFunction(()=>document.querySelector('#batchState').textContent==='全部完成');assert.equal(writes.length,2);assert.notEqual(writes[0].mother,writes[1].mother);
  await capture('11-completed',{goal:'模拟ERP完成后是否有清楚结果、核验状态与防重复执行'});
  await page.reload();await page.locator('#executionPanel').waitFor();assert.equal(writes.length,2);assert.equal(await page.locator('#startBatch').isDisabled(),true);checks.push('两条模拟ERP草稿母稿独立，刷新不重复执行');

  await page.click('#newBatch');await page.click('#folderTab');await page.fill('#folderPath',generated.resultPackage.folder);await page.click('#importFolder');await page.locator('.listing-row').nth(1).waitFor();checks.push('结果Excel和图片能重新导入');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1000,720));await page.locator('#reviewPanel').scrollIntoViewIfNeeded();
  await capture('12-small-window',{goal:'最小桌面窗口1000×720，检查横向溢出、操作遮挡与滚动'});
  await page.getByRole('link',{name:'单品设计',exact:true}).click();await page.locator('#prodName').waitFor();await page.waitForFunction(()=>document.querySelector('.ws-header h2')?.textContent==='生图工作台');await page.evaluate(()=>TemuWorkbench.ready);
  await capture('13-single-design',{goal:'从上架切到单品设计，检查导航一致性和复杂表单层级'});

  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1424,961));
  await page.locator('#designScope').selectOption('main_count');await page.locator('#mainImageCount').selectOption('2');await page.locator('#imageRatio').selectOption('3:4');
  for(const [id,value] of [['prodName','验收装饰画，50×100cm，无框'],['prodDesc','单幅帆布装饰画，适合客厅墙面；保持原图图案。']]){await page.locator('#'+id).click();await page.locator('#feTextarea').fill(value);if(id==='prodDesc'){await page.waitForTimeout(1300);assert.equal(await page.locator('.driver-overlay').count(),0,'automatic tour must not cover an active editor');}await page.locator('[onclick="confirmFieldEditor()"]').click();}
  const chooserPromise=page.waitForEvent('filechooser');await page.locator('[onclick^="openUploader"]').filter({hasText:'产品主体图'}).click();await (await chooserPromise).setFiles(path.join(f.input,'CANVAS-A','01.png'));
  await page.waitForFunction(()=>document.querySelector('#uploadCountIndicator').textContent==='1/8');
  await page.locator('#agentBtn').click();await page.locator('#agentConfirmOk').waitFor();
  await capture('14-single-confirm',{goal:'通过实际字段弹窗和图片选择完成单品输入，检查构思前确认信息'});
  await page.locator('#agentConfirmOk').click();await page.waitForFunction(()=>document.querySelector('#sopText').value.includes('画幅 3:4')&&!document.querySelector('#championsOverlay').classList.contains('show'));
  await page.locator('#singlePlanReview summary').click();await page.locator('#sopText').scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(()=>document.querySelector('.workspace-grid').getBoundingClientRect().bottom<=document.querySelector('#singlePlanReview').getBoundingClientRect().top),'expanded plan must not overlap the input panels');
  const planText=await page.locator('#sopText').inputValue(),editedPlan=planText+'\n验收补充：保留原图的外观与颜色。';await page.locator('#sopText').fill(editedPlan);await page.reload();await page.locator('#nav-dash').click();await page.locator('#singlePlanReview summary').click();assert.equal(await page.locator('#sopText').inputValue(),editedPlan);checks.push('单品设计方案可展开编辑，刷新后保留');
  await page.locator('#sopText').scrollIntoViewIfNeeded();await capture('15-single-plan',{goal:'单品构思结果与两张竖图范围，方案修改后刷新恢复；使用本地规划规则'});
  const beforeSingle=imageCalls;await page.locator('#mainBtn').click();await page.waitForFunction(()=>document.querySelectorAll('.quest-slot img').length===2&&activeKieTasks.length===0);
  if(await page.locator('#_ratingSkip').isVisible())await page.locator('#_ratingSkip').click();
  assert.equal(imageCalls,beforeSingle+2);await page.reload();await page.waitForSelector('.quest-slot img');assert.equal(imageCalls,beforeSingle+2);checks.push('单品2张竖图完成并刷新恢复，无重复生成');
  await capture('16-single-result',{goal:'单品生成结果与刷新恢复；图片服务仍为测试替身'});

  assert.deepEqual(errors,[]);const report={passed:true,steps:steps.length,checks,errors,imageCalls,simulatedErpWrites:writes,realModelCalls:0,realErpWrites:0,limitations:['模型、图像和ERP接口为明确测试替身','系统文件夹选择器仅验证Electron桥接及返回结果，未由电脑控制接口操作系统对话框','不验证真实模型成图质量、第三方登录与正式发布']};
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  for(const name of ['failure.txt','failure.png'])fs.rmSync(path.join(output,name),{force:true});
}catch(error){fs.writeFileSync(path.join(output,'failure.txt'),error.stack);await page.screenshot({path:path.join(output,'failure.png'),timeout:10000}).catch(()=>{});throw error;}
finally{lineReader?.close();await app.close();await f.close();fs.rmSync(desktopData,{recursive:true,force:true});}
