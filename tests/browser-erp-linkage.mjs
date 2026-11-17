import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {merchantFixture} from './merchant-fixture.mjs';

const checks=[],reads=[];let offline=false;
const f=await merchantFixture({erpAdapter:{
  checkConnection:async(browser,erp)=>{checks.push({browser:browser.key,erp:erp.key});if(offline)throw new Error('测试：所选比特窗口不可连接');return {connected:true,loggedIn:true,account:'same-account',accountMatched:true};},
  validateMother:async({store,browserConfig})=>{reads.push({erp:store.erpConnection.key,browser:browserConfig.key});return {valid:true,issues:[],draftId:store.draftId,actualStore:store.expectedStore,actualSite:store.expectedSite,sourceMode:'product',shippingTemplate:'加拿大'};}
}});
const browser=await chromium.launch({channel:'msedge',headless:true}),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),settings=await context.newPage(),errors=[];
for(const p of [page,settings])p.on('pageerror',e=>errors.push(e.message));
const focus=()=>page.evaluate(()=>window.dispatchEvent(new Event('focus')));
const ready=()=>page.locator('#batchMother:not([disabled])').waitFor();
const output=path.resolve('tests/results/erp-linkage');fs.mkdirSync(output,{recursive:true});
try{
  let cfg=await f.api('/api/settings');const bitErp=cfg.stores[0].erpKey;
  const chrome={key:'chrome-browser',type:'chrome',name:'谷歌测试',debugPort:9444};
  cfg=f.app.preferences.update({revision:cfg.revision,browsers:[...cfg.browsers,chrome],erpConnections:[{...cfg.erpConnections[0],name:'比特 ERP',expectedAccount:'same-account'},{key:'chrome-erp',name:'谷歌 ERP',browserKey:chrome.key,expectedAccount:'same-account'},{key:'empty-erp',name:'未关联店铺 ERP',browserKey:chrome.key}],stores:cfg.stores.map((s,i)=>({...s,erpKey:i?'chrome-erp':bitErp}))});
  await page.goto(f.base+'/temu/listings');await page.locator('#erpConnection option[value="chrome-erp"]').waitFor({state:'attached'});
  assert.equal(await page.locator('#browser').count(),0);
  assert.equal(await page.inputValue('#erpConnection'),'');assert.equal(await page.locator('#targetStore').isDisabled(),true);
  await page.selectOption('#erpConnection','empty-erp');assert.match(await page.locator('#targetStore').textContent(),/尚未关联店铺/);
  await page.selectOption('#erpConnection',bitErp);
  assert.deepEqual(await page.locator('#targetStore option').evaluateAll(es=>es.map(e=>e.value)),['','merchant-ca']);
  await page.selectOption('#targetStore','merchant-ca');await ready();assert.match(await page.locator('#motherInfo a').getAttribute('href'),/987654321$/);
  await page.click('#checkConnection');await page.getByText('店小秘已登录：same-account',{exact:true}).waitFor();
  assert.deepEqual(checks.at(-1),{browser:'merchant-browser',erp:bitErp});
  offline=true;await page.click('#checkConnection');await page.getByText('测试：所选比特窗口不可连接',{exact:true}).first().waitFor();
  assert.ok(checks.every(c=>c.browser==='merchant-browser'),'connection errors cannot fall back to Chrome');offline=false;
  await page.selectOption('#erpConnection','chrome-erp');assert.equal(await page.inputValue('#targetStore'),'');assert.doesNotMatch(await page.locator('#connectionState').textContent(),/已登录/);
  assert.deepEqual(await page.locator('#targetStore option').evaluateAll(es=>es.map(e=>e.value)),['','merchant-other']);
  await page.selectOption('#targetStore','merchant-other');assert.match(await page.locator('#motherInfo a').getAttribute('href'),/987654331$/);
  await assert.rejects(f.api('/api/temu/erp/connection',{erpKey:bitErp,browserKey:chrome.key}),/不一致/);
  await page.selectOption('#erpConnection',bitErp);await page.selectOption('#targetStore','merchant-ca');
  await page.fill('#folderPath',f.input);await page.click('#importFolder');await page.locator('[data-product="1"]').waitFor();
  for(const field of await page.locator('[data-field=count]').all())await field.fill('1');await page.selectOption('#imageCount','1');
  await page.click('#createBatch');await page.locator('#generationPanel').waitFor();await ready();
  const task=(await f.api('/api/products'))[0];const full=await f.api('/api/products/'+task.id);
  assert.equal(full.erpKey,bitErp);assert.equal(full.browserKey,'merchant-browser');assert.equal(full.connectionBinding.browserConfig.key,'merchant-browser');
  const imported=await f.api('/api/products/import-folder',{folder:f.input});
  await assert.rejects(f.api('/api/products',{requestId:'wrong-erp',storeKey:'merchant-ca',erpKey:'chrome-erp',platform:'temu',products:imported.products,imageCount:1,ratio:'1:1',mode:'fast'}),/不属于/);
  await page.click('#planBatch');await page.waitForFunction(()=>document.querySelector('#generationState').textContent==='方案与标题已就绪');
  assert.ok(reads.length>0);assert.ok(reads.every(r=>r.erp===bitErp&&r.browser==='merchant-browser'));
  await page.reload();await ready();assert.equal(await page.inputValue('#erpConnection'),bitErp);
  await page.click('#generateBatch');await page.waitForFunction(()=>document.querySelector('#generationState').textContent==='素材已完成');
  await page.click('#reviewGenerated');await page.locator('.listing-row').nth(1).waitFor();await ready();
  await page.click('#prepareBatch');await page.locator('#executionPanel').waitFor();
  const job=(await f.api('/api/temu/erp/batches'))[0];assert.equal(job.store.erpKey,bitErp);assert.equal(job.browserConfig.key,'merchant-browser');
  await assert.rejects(f.api('/api/temu/erp/prepare',{previewId:job.previewId,storeKey:'merchant-ca',erpKey:'chrome-erp',rows:job.rows}),/不属于/);
  await page.click('#startBatch');await page.waitForFunction(()=>document.querySelector('#batchState').textContent==='全部完成');
  assert.equal(f.writes.length,2);assert.ok(f.writes.every(w=>w.browser==='independent-profile'));
  await page.reload();await page.waitForFunction(()=>document.querySelector('#batchState').textContent==='全部完成');assert.equal(await page.inputValue('#erpConnection'),bitErp);
  await f.api('/api/temu/erp/batches/'+job.id+'/start',{});assert.equal(f.writes.length,2);
  await page.click('#newBatch');await page.selectOption('#taskHistory','product:'+task.id);await page.locator('#executionPanel').waitFor();
  assert.equal(await page.inputValue('#erpConnection'),bitErp);
  await page.click('#newBatch');await page.fill('#folderPath',f.input);await page.click('#importFolder');await page.locator('[data-product="1"]').waitFor();
  for(const field of await page.locator('[data-field=count]').all())await field.fill('1');await page.selectOption('#imageCount','1');
  await page.click('#createBatch');await page.locator('#generationPanel').waitFor();await ready();
  const pending=(await f.api('/api/products'))[0];assert.notEqual(pending.id,task.id);

  // Change the actual saved ERP binding using the settings page, not the listing UI.
  await settings.goto(f.base+'/settings');await settings.click(`[data-erp-edit="${bitErp}"]`);
  await settings.selectOption('#erpForm [name=browserKey]',chrome.key);
  const saved=settings.waitForResponse(r=>r.url()===f.base+'/api/settings'&&r.request().method()==='POST');
  await settings.click('#erpForm button.primary');assert.equal((await saved).status(),200);await focus();
  await page.waitForFunction(()=>document.querySelector('#erpBinding').textContent.includes('绑定已变化'));
  assert.equal(await page.inputValue('#erpConnection'),bitErp);assert.equal(await page.locator('#planBatch').isDisabled(),true);
  const readCount=reads.length;
  await assert.rejects(f.api('/api/products/'+pending.id+'/plan',{}),/绑定已变化|配置已变化/);assert.equal(reads.length,readCount,'reject stale binding before opening any browser');
  await assert.rejects(f.api('/api/products/'+pending.id+'/generate',{}),/绑定已变化|配置已变化/);
  await assert.rejects(f.api('/api/temu/erp/prepare',{previewId:job.previewId,storeKey:'merchant-ca',erpKey:bitErp,rows:job.rows}),/绑定已变化|配置已变化/);
  await page.reload();await page.waitForFunction(()=>document.querySelector('#erpBinding').textContent.includes('绑定已变化'));assert.equal(await page.locator('#planBatch').isDisabled(),true);
  await page.screenshot({path:path.join(output,'changed-binding.png')});

  // A new batch uses the explicitly saved binding, with store/browser derived from the same ERP.
  await page.click('#newBatch');await page.click('#checkConnection');await page.getByText('店小秘已登录：same-account',{exact:true}).waitFor();
  assert.deepEqual(checks.at(-1),{browser:chrome.key,erp:bitErp});
  cfg=await f.api('/api/settings');assert.equal(cfg.stores.find(s=>s.key==='merchant-ca').browserKey,chrome.key);
  cfg=await f.api('/api/settings',{revision:cfg.revision,stores:cfg.stores.map(s=>s.key==='merchant-ca'?{...s,erpKey:'chrome-erp'}:s)});
  await focus();await page.waitForFunction(()=>document.querySelector('#targetStore').textContent.includes('尚未关联店铺'));
  assert.equal(await page.locator('#batchMother').isDisabled(),true,'a moved store must not remain usable under the old ERP');
  await page.selectOption('#erpConnection','chrome-erp');
  assert.deepEqual(await page.locator('#targetStore option').evaluateAll(es=>es.map(e=>e.value)),['','merchant-ca','merchant-other']);
  await page.selectOption('#targetStore','merchant-ca');await ready();
  await page.screenshot({path:path.join(output,'linked-selectors.png')});
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,realErpWrites:0,realGenerationCalls:0,checks,reads,fixtureWrites:f.writes.length,errors},null,2));
  console.log('ERP 联动通过：双浏览器同账号、ERP/店铺/母稿筛选、断连不回退、错配拒绝、生成及执行一致、刷新和历史恢复、设置改绑同步、旧任务阻止换环境、店铺转移与防重复保存。');
}finally{await context.close();await browser.close();await f.close();}
