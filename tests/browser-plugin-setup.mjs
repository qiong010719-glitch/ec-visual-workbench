import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {createWorkbench} from '../src/server.mjs';

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'plugin-setup-browser-'));
const sourceUrl='https://www.temu.com/fixture-g-601105252678121.html';
const calls=[],requests=[],errors=[];
let pluginStatus='missing',clicks=0,searches=0,accountChecks=0,paidCalls=0,resumeFailureId=null;
const app=createWorkbench({dataDirectory:directory,configuration:{WORKBENCH_FRESH:'true'},
  sourcingClient:async()=>{paidCalls++;throw new Error('No paid provider is allowed in plugin setup tests');},
  freePluginAdapter:{
    check:async bound=>{calls.push({kind:'check',browser:bound.browserConfig.key});return {status:pluginStatus,message:pluginStatus==='ready'?'店小秘插件已启用；采集时仍需检查账号。':'此采集窗口尚未安装店小秘插件。',name:'店小秘助手',version:pluginStatus==='ready'?'2.9.9':''};},
    openSetup:async bound=>{calls.push({kind:'open',view:bound.view,browser:bound.browserConfig.key});return {message:`已在“${bound.browserConfig.name}”打开插件页面。`};}
  },
  freeSourcingAdapter:{
    search:async()=>{searches++;return {status:'ready',products:[{sourceUrl,title:'插件流程测试商品'}]};},
    collect:async args=>{args.beforeSubmit();clicks++;return {status:'submitted',pluginStatus:'success',receipt:{kind:'toast',text:'采集成功',sourceUrl,observedAt:new Date().toISOString()}};},
    returnToSearch:async()=>({status:'ready'})
  },
  freeCollectionAdapter:{check:async()=>{accountChecks++;},lookup:async()=>({status:'absent'}),verify:async()=>({status:'verified',evidence:{sourceUrl}})}
});
app.preferences.update({revision:0,browsers:[{key:'chrome-a',type:'chrome',name:'测试专用窗口',debugPort:9444},{key:'chrome-existing',type:'chrome',name:'测试日常谷歌',connectionMode:'existing'}],erpConnections:[{key:'erp-a',name:'测试ERP',browserKey:'chrome-a',expectedAccount:'fixture-account'},{key:'erp-existing',name:'日常谷歌ERP',browserKey:'chrome-existing',expectedAccount:'fixture-existing'}],stores:[]});
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+app.server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}});
const evidence=path.resolve('tests/results/plugin-setup');fs.mkdirSync(evidence,{recursive:true});
page.on('pageerror',error=>errors.push(error.message));
page.on('request',req=>{if(req.url().includes('/api/free-sourcing/plugin/')&&req.method()==='POST')requests.push({route:new URL(req.url()).pathname,body:req.postDataJSON()});});
await page.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin!==base)return route.abort();
  if(resumeFailureId&&url.pathname===`/api/free-sourcing/jobs/${resumeFailureId}/resume`)return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'浏览器或账号绑定已变化，请恢复原绑定再继续核对。'})});
  return route.continue();
});
try{
  await page.goto(base+'/sourcing/free');
  await page.locator('[data-plugin=check]:not([disabled])').waitFor();
  assert.equal(calls.length,0,'loading the UI must not open or inspect real Chrome automatically');
  assert.equal(await page.locator('#pluginConfigured').innerText(),'尚未检查');
  assert.match(await page.locator('#pluginBinding').innerText(),/独立 Chrome 窗口/);
  assert.match(await page.locator('#pluginMessage').innerText(),/到连接设置切换/);
  assert.equal(await page.locator('#pluginSetup a[href="/settings#browserSettings"]').count(),1);
  await page.selectOption('#freeErp','erp-existing');
  assert.match(await page.locator('#pluginBinding').innerText(),/测试日常谷歌 · 复用当前 Chrome/);
  assert.match(await page.locator('#pluginMessage').innerText(),/已有插件无需重装/);
  assert.match(await page.locator('#pluginMessage').innerText(),/保留店小秘页面/);
  assert.equal(await page.locator('[data-plugin=install]').innerText(),'查看插件安装状态');
  assert.equal(calls.length,0,'changing selected ERP only updates its mode and guidance');
  assert.equal(searches,0);assert.equal(accountChecks,0);assert.equal(clicks,0);
  await page.click('[data-plugin=manage]');await page.getByText('已在“测试日常谷歌”打开插件页面。',{exact:true}).waitFor();
  assert.deepEqual(calls.at(-1),{kind:'open',view:'manage',browser:'chrome-existing'});
  assert.deepEqual(requests.at(-1),{route:'/api/free-sourcing/plugin/open',body:{erpKey:'erp-existing',view:'manage'}});
  await page.selectOption('#freeErp','erp-a');
  assert.match(await page.locator('#pluginBinding').innerText(),/测试专用窗口 · 独立 Chrome 窗口/);
  assert.equal(await page.locator('[data-plugin=install]').innerText(),'在采集窗口安装插件');
  await page.click('[data-plugin=check]');await page.getByText('尚未安装',{exact:true}).waitFor();
  assert.equal(searches,0);assert.equal(accountChecks,0);assert.equal(clicks,0);
  await page.click('[data-plugin=install]');await page.getByText('已在“测试专用窗口”打开插件页面。',{exact:true}).waitFor();
  assert.deepEqual(calls.at(-1),{kind:'open',view:'install',browser:'chrome-a'});
  await page.locator('#pluginConfigured').filter({hasText:'尚未检查'}).waitFor();
  for(const view of ['manage','help']){await page.click(`[data-plugin=${view}]`);await page.locator(`[data-plugin=${view}]:not([disabled])`).waitFor();assert.deepEqual(calls.at(-1),{kind:'open',view,browser:'chrome-a'});}
  await page.fill('[name=keyword]','fixture product');await page.fill('[name=limit]','1');await page.fill('[name=captchaMaxAttempts]','0');await page.click('#startFree');
  await page.getByText('需要检查插件',{exact:true}).waitFor();
  const job=app.freeSourcing.view().jobs[0];assert.equal(job.status,'waiting-plugin');assert.equal(job.rows.length,0);assert.equal(job.captcha.attempts.length,0);
  assert.equal(searches,0);assert.equal(accountChecks,0);assert.equal(clicks,0);assert.equal(paidCalls,0);
  assert.equal(await page.locator('#startFree').isDisabled(),true);
  assert.equal(await page.locator('[data-plugin=install]').isDisabled(),false,'installation remains available for a paused task');
  const task=page.locator(`[data-job="${job.id}"]`);
  assert.equal(await task.locator('[data-action=plugin]').innerText(),'安装采集插件');
  resumeFailureId=job.id;
  await task.locator('[data-action=resume]').click();
  const oldFailure=`任务“${job.keyword}”（${job.id.slice(0,8)}）：浏览器或账号绑定已变化，请恢复原绑定再继续核对。`;
  await page.getByText(oldFailure,{exact:true}).waitFor();
  const polled=await page.waitForResponse(response=>response.url()===base+'/api/free-sourcing'&&response.request().method()==='GET');
  await polled.finished();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.locator('#notice').innerText(),oldFailure,'background refresh preserves the error until another user action');
  await page.click('#refresh');await page.locator('#refresh:not([disabled])').waitFor();
  assert.equal(await page.locator('#notice').isHidden(),true,'a successful manual refresh clears the obsolete action error');
  assert.equal(await page.locator('#notice').textContent(),'');
  await task.locator('[data-action=resume]').click();await page.getByText(oldFailure,{exact:true}).waitFor();
  await page.click('[data-action=plugin]');await page.locator('[data-action=plugin]:not([disabled])').waitFor();
  assert.deepEqual(requests.at(-1),{route:'/api/free-sourcing/plugin/open',body:{jobId:job.id,view:'install'}});
  assert.equal(calls.at(-1).browser,'chrome-a');
  assert.equal(await page.locator('#notice').innerText(),'已在“测试专用窗口”打开插件页面。','a new successful user action replaces the old failure');
  assert.equal(await page.locator('#notice').getAttribute('class'),'');
  resumeFailureId=null;
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${width}px overflow`);
    await page.screenshot({path:path.join(evidence,`missing-${width}.png`),fullPage:true});
  }
  const readyExplanation='店小秘插件已启用，点击“已处理，继续”后继续本任务。',savedMessage=app.freeSourcing.get(job.id).message;
  pluginStatus='ready';await page.click('[data-action=plugin-check]');await page.getByText('已启用',{exact:true}).waitFor();
  assert.deepEqual(requests.at(-1),{route:'/api/free-sourcing/plugin/check',body:{jobId:job.id}});
  assert.equal(await task.locator('.free-handoff').innerText(),readyExplanation);
  assert.equal(app.freeSourcing.get(job.id).status,'waiting-plugin','the card guidance does not resume the task');
  assert.equal(app.freeSourcing.get(job.id).message,savedMessage,'the card guidance does not overwrite persisted task history');
  assert.equal(clicks,0,'checking a plugin cannot resume the task');
  await page.getByRole('button',{name:'已处理，继续',exact:true}).click();await page.getByText('已完成',{exact:true}).waitFor();
  assert.equal(searches,1);assert.equal(clicks,1);assert.equal(paidCalls,0);
  const checks=calls.filter(c=>c.kind==='check').length;
  pluginStatus='missing';await page.getByRole('button',{name:'只核对结果',exact:true}).click();await page.getByText('已完成',{exact:true}).waitFor();
  assert.equal(clicks,1);assert.equal(calls.filter(c=>c.kind==='check').length,checks);
  await page.selectOption('#freeErp','erp-existing');await page.fill('[name=keyword]','existing product');await page.click('#startFree');
  await page.getByText('需要检查插件',{exact:true}).waitFor();
  const existingJob=app.freeSourcing.view().jobs.find(item=>item.erpKey==='erp-existing'),existingTask=page.locator(`[data-job="${existingJob.id}"]`);
  assert.equal(existingJob.binding.browserConfig.connectionMode,'existing');
  assert.equal(await existingTask.locator('[data-action=plugin]').innerText(),'查看本任务插件');
  await existingTask.locator('[data-action=plugin]').click();await existingTask.locator('[data-action=plugin]:not([disabled])').waitFor();
  assert.deepEqual(requests.at(-1),{route:'/api/free-sourcing/plugin/open',body:{jobId:existingJob.id,view:'manage'}});
  assert.deepEqual(calls.at(-1),{kind:'open',view:'manage',browser:'chrome-existing'});
  assert.equal(searches,1);assert.equal(clicks,1);assert.equal(paidCalls,0,'checking an existing task plugin never starts collection or installs an extension');
  pluginStatus='ready';await existingTask.locator('[data-action=plugin-check]').click();await page.getByText('已启用',{exact:true}).waitFor();
  assert.equal(await existingTask.locator('.free-handoff').innerText(),readyExplanation);
  assert.equal(app.freeSourcing.get(existingJob.id).status,'waiting-plugin');assert.equal(clicks,1);
  const latestSettings=app.preferences.view();
  app.preferences.update({revision:latestSettings.revision,browsers:latestSettings.browsers.map(item=>item.key==='chrome-existing'?{...item,name:'测试日常谷歌（配置已变更）'}:item),erpConnections:[...latestSettings.erpConnections.filter(item=>item.key==='erp-existing'),...latestSettings.erpConnections.filter(item=>item.key!=='erp-existing')]});
  await page.reload();await page.locator('[data-plugin=check]:not([disabled])').waitFor();
  assert.equal(await page.locator('#freeErp').inputValue(),'erp-existing');
  await page.click('[data-plugin=check]');await page.getByText('已启用',{exact:true}).waitFor();
  assert.equal(await existingTask.locator('.free-handoff').innerText(),existingJob.message,'ready check for a changed browser configuration must not replace the old task message, even when ERP and browser keys match');
  assert.equal(app.freeSourcing.get(existingJob.id).message,existingJob.message);assert.equal(clicks,1);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,clicks,searches,accountChecks,paidCalls,pluginCalls:calls.length,checks:['existing and dedicated guidance follows selected ERP without browser actions','plugin management uses existing Chrome binding','task errors identify keyword and short ID','background refresh retains errors','new manual actions clear obsolete errors','existing task plugin action opens management','ready plugin check updates guidance only for exact task binding','ready guidance preserves waiting state and stored history','missing preflight blocks all business','installation uses selected binding','paused task uses job binding','check does not resume','resume checks again','reconcile does not click again','390/1440 overflow'],evidence}));
}finally{
  await browser.close();await new Promise(resolve=>app.server.close(resolve));
  assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});
}
