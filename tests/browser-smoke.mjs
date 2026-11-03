import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createWorkbench,root} from '../src/server.mjs';
import {clickRequired,createClickPacer,getInteractionMetrics} from '../tools/interaction.mjs';

const output=path.join(root,'tests/results');fs.mkdirSync(output,{recursive:true});
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ec-ui-test-'));
const image=fs.readFileSync(path.join(root,'public/mode-samples/fast_case2.jpg'));
// An explicit fixture backend exercises UI plumbing without real provider charges.
const app=createWorkbench({dataDirectory:directory,configuration:{},provider:async()=>image});
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
const address='http://127.0.0.1:'+app.server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
await context.addInitScript(()=>{
  localStorage.setItem('aplus_newbie_tour_v1','true');
  localStorage.setItem('hyrule_result_tour_done','true');
});
const page=await context.newPage();
const errors=[],external=[],checks=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('request',request=>{if(/^https?:/.test(request.url()) && !request.url().startsWith(address))external.push(request.url());});
const pacer=createClickPacer();
const fill=async(selector,value)=>pacer.perform(()=>page.locator(selector).fill(value),{kind:'fill',target:selector});
const select=async(selector,value)=>pacer.perform(()=>page.locator(selector).selectOption(value),{kind:'select',target:selector});
const click=selector=>clickRequired(page.locator(selector));
// Use one pacer for every action, including actions implemented by the shared click wrapper.
const act=async(selector)=>pacer.perform(()=>click(selector),{kind:'click',target:selector});
try {
  await page.goto(address);await page.locator('#localDraftButton').waitFor();
  await page.screenshot({path:path.join(output,'01-dashboard.png')});checks.push('首页原版布局与本地服务启动');
  // The preserved controls use a custom select shell, but native selects retain the selected state.
  await select('#designScope','main_and_6');
  await act('#prodName');await fill('#feTextarea','界面验收测试杯');await act('#fieldEditorModal .modal-btn-confirm');
  await act('#prodDesc');await fill('#feTextarea','系统验收资料，不代表真实商品。白色杯身，测试参考图。');await act('#fieldEditorModal .modal-btn-confirm');
  const chooser=page.waitForEvent('filechooser');
  await act('[onclick="openUploader(\'产品主体图\')"]');
  await (await chooser).setFiles(path.join(root,'public/mode-samples/fast_case2.jpg'));
  await page.waitForFunction(()=>document.querySelector('#materialPreviewGrid')?.querySelector('img'));
  await act('#agentBtn');await act('#agentConfirmOk');
  await page.waitForFunction(()=>document.querySelector('#sopText').value.includes('界面验收测试杯'));
  await page.waitForFunction(()=>!document.querySelector('#championsOverlay').classList.contains('show'));
  checks.push('资料填写、素材上传、构思完成和生成按钮解锁');
  page.on('dialog',dialog=>dialog.accept());
  await act('#mainBtn');
  await page.waitForFunction(()=>document.querySelectorAll('.quest-slot img').length>=7,{},{timeout:30000});
  await page.locator('#_ratingSkip').waitFor({state:'visible',timeout:10000});await act('#_ratingSkip');
  await page.screenshot({path:path.join(output,'02-gallery.png')});checks.push('7 个异步结果槽位、任务监听、图片归档（测试替身）');
  await act('#nav-dash');await act('#localDraftButton');await act('#draftNew');await act('#draftAddSku');
  await fill('[data-sku="code"]','QA-SKU-01');await fill('[data-sku="name"]','测试规格');await fill('[data-sku="price"]','9.9');await fill('[data-sku="stock"]','1');
  await act('#draftForm button[type=submit]');
  await page.locator('#draftError').filter({hasText:'已保存'}).waitFor();
  assert.equal(app.store.state.drafts.length,1);assert.equal(app.store.state.drafts[0].images.length,7);assert.equal(app.store.state.drafts[0].status,'draft');
  const download=page.waitForEvent('download');await act('#draftExport');const artifact=await download;await artifact.saveAs(path.join(output,'验收测试-草稿.zip'));
  assert.ok(fs.statSync(path.join(output,'验收测试-草稿.zip')).size>1000);
  await act('#draftList');await act('[data-edit]');
  assert.equal(await page.locator('[data-sku="stock"]').inputValue(),'1');
  await page.screenshot({path:path.join(output,'03-draft.png')});checks.push('SKU、草稿保存、重开核对、ZIP 导出');
  await act('#localDraftEditor [data-close]');await act('#nav-edit');
  await act('#editTabFree');
  await pacer.perform(()=>page.locator('#editMatInput').setInputFiles(path.join(root,'public/mode-samples/fast_case2.jpg')),{kind:'upload',target:'#editMatInput'});
  await page.locator('#editMatList img').waitFor({state:'visible'});
  await fill('#editPrompt','本地测试替身，用于验证编辑任务流程');await act('#editRunBtn');
  await page.locator('#editResultImg').waitFor({state:'visible'});checks.push('自由编辑任务结果显示（测试替身）');
  await page.screenshot({path:path.join(output,'04-editor.png')});
  await act('#nav-partners');await page.screenshot({path:path.join(output,'05-partners.png')});checks.push('合作页本地静态资源');
  await act('#nav-dash');await act('#modeBtn_master');await select('#designScope','custom');
  await fill('#clSub','1');await fill('#clAplus','1');await act('#customConfirmBtn');
  assert.equal(await page.evaluate(()=>getCurrentSlotTitles().filter(Boolean).length),3);
  await act('#agentBtn');await act('#agentConfirmOk');
  await page.waitForFunction(()=>!document.querySelector('#championsOverlay').classList.contains('show'));
  await act('#mainBtn');await page.waitForFunction(()=>document.querySelectorAll('.quest-slot img').length>=3);
  await page.locator('#_ratingSkip').waitFor({state:'visible'});await act('#_ratingSkip');
  checks.push('大师模式自定义 1 主图 + 1 副图 + 1 A+（测试替身）');
  await act('#nav-dash');await act('#modeBtn_ultra_fast');
  if(await page.locator('#ultraFastWarningModal').isVisible())await act('[onclick*="selectModeFromModal(\'ultra_fast\')"]');
  await select('#designScope','ultra_main_8');await act('#mainBtn');
  await page.locator('.ultra-card-img').waitFor({state:'visible'});checks.push('极速合图入口及独立图库（测试替身）');
  await act('[onclick="openCropModalFromSlot(0)"]');
  await page.locator('#cropResultsGrid img').first().waitFor({state:'visible'});
  assert.ok(await page.locator('#cropResultsGrid img').count()>0);await act('[onclick="closeCropModal()"]');checks.push('智能切片工具');
  await page.reload();await page.waitForFunction(()=>document.querySelector('#prodName').value==='界面验收测试杯');
  assert.equal(await page.locator('#generationMode').inputValue(),'ultra_fast');
  await page.locator('.ultra-card-img').waitFor({state:'visible'});
  checks.push('刷新后产品、素材和结果恢复');
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(output,'06-mobile.png')});checks.push('手机尺寸布局截图');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  fs.writeFileSync(path.join(output,'browser-report.json'),JSON.stringify({passed:true,provider:'explicit-test-fixture',checks,errors,externalRequests:external,interaction:pacer.metrics(),clicks:getInteractionMetrics(context)},null,2));
  console.log(JSON.stringify({passed:true,checks,errors,externalRequests:external,minimumInterval:pacer.metrics().minimumGapMs}));
} catch(error) {
  await page.screenshot({path:path.join(output,'failure.png')});
  fs.writeFileSync(path.join(output,'browser-report.json'),JSON.stringify({passed:false,checks,errors,externalRequests:external,error:error.message},null,2));
  throw error;
} finally {
  await browser.close();await new Promise(resolve=>app.server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});
}
