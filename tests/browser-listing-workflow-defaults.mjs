import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {createWorkbench} from '../src/server.mjs';

// This browser uses an isolated workbench and never connects to an ERP browser.
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'listing-defaults-ui-'));
const app=createWorkbench({dataDirectory:directory,configuration:{WORKBENCH_FRESH:'true'},listingWorkflowAdapter:{},settingsCodec:{encode:value=>Buffer.from(value).toString('base64'),decode:value=>Buffer.from(value,'base64').toString()}});
app.preferences.update({revision:0,browsers:[{key:'chrome-fixture',type:'chrome',name:'测试浏览器',debugPort:9444}],erpConnections:[{key:'erp-fixture',name:'测试ERP',browserKey:'chrome-fixture',expectedAccount:'fixture'}],stores:[]});
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+app.server.address().port;
const {token}=await fetch(base+'/api/session').then(response=>response.json());
const api=async(route,payload)=>{
  const response=await fetch(base+'/api/'+route,payload===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token},body:JSON.stringify(payload)});
  const result=await response.json();assert.equal(response.ok,true,result.error);return result;
};
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
let saveRequests=0;
page.on('request',request=>{if(request.url()===base+'/api/listing-templates'&&request.method()==='POST')saveRequests++;});
const idle=()=>page.locator('#saveTemplate:not([disabled])').waitFor();
const save=async()=>{
  const response=page.waitForResponse(response=>response.url()===base+'/api/listing-templates'&&response.request().method()==='POST');
  await page.locator('#saveTemplate').click();assert.equal((await response).status(),200);await idle();
  return (await api('listing-templates')).templates.find(item=>item.id===newestId||item.name==='固定批量配置');
};
let newestId;
try{
  await page.goto(base+'/sourcing/listing?mode=template');await idle();
  assert.equal(await page.locator('#templateCategoryMode').inputValue(),'replace');
  assert.equal(await page.locator('#templateInventoryMode').inputValue(),'fixed');
  assert.equal(await page.locator('#templateInventoryQuantity').inputValue(),'10000');
  assert.equal(await page.locator('#templateSaveMode').inputValue(),'draft');
  for(const suffix of ['Length','Width','Height','Weight'])assert.equal(await page.locator('#templatePackage'+suffix).inputValue(),'');
  await page.locator('#templateName').fill('固定批量配置');
  await page.locator('#templateCategory').fill('家居、厨房用品 > 装饰字画 > 海报和印刷品');
  let saved=await save();newestId=saved.id;
  assert.deepEqual(saved.rules.inventory,{mode:'fixed',quantity:10000});
  assert.equal(saved.rules.categoryMode,'replace');assert.equal(saved.rules.packageDefaults,undefined);
  assert.equal(saved.rules.saveMode,'draft');
  await page.reload();await page.locator('#editTemplate:not([disabled])').click();await idle();
  assert.equal(await page.locator('#templateInventoryQuantity').inputValue(),'10000');
  assert.match(await page.locator('#templateSummary').innerText(),/每个 SKU 10000/);

  await page.locator('#templatePackageLength').fill('60');
  const priorRequests=saveRequests;
  await page.locator('#saveTemplate').click();
  await page.locator('#workflowNotice.error').waitFor();
  assert.match(await page.locator('#workflowNotice').innerText(),/同时填写/);assert.equal(saveRequests,priorRequests);
  for(const [suffix,value] of [['Width','40'],['Height','5'],['Weight','1.25']])await page.locator('#templatePackage'+suffix).fill(value);
  saved=await save();assert.deepEqual(saved.rules.packageDefaults,{lengthCm:60,widthCm:40,heightCm:5,weightKg:1.25});
  assert.match(await page.locator('#templateSummary').innerText(),/60 × 40 × 5 cm · 1.25 kg/);
  await page.reload();await page.locator('#editTemplate:not([disabled])').click();await idle();
  assert.equal(await page.locator('#templatePackageWeight').inputValue(),'1.25');

  // Hidden legacy rules and store-specific exceptions survive editing common defaults.
  const enriched=await api('listing-templates',{...saved,rules:{...saved.rules,futureRule:{retain:'yes'}},storeBindings:[{key:'store-a',storeName:'测试店铺',site:'加拿大站',overrides:{inventory:{mode:'preserve'}}}]});
  await page.reload();await page.locator('#editTemplate:not([disabled])').click();await idle();
  await page.locator('#clearPackageDefaults').click();
  await page.locator('#templateInventoryMode').selectOption('preserve');
  assert.equal(await page.locator('#templateInventoryQuantity').isDisabled(),true);
  saved=await save();assert.equal(saved.version,enriched.version+1);assert.equal(saved.rules.packageDefaults,undefined);
  assert.deepEqual(saved.rules.inventory,{mode:'preserve'});assert.deepEqual(saved.rules.futureRule,{retain:'yes'});
  assert.deepEqual(saved.storeBindings[0].overrides,{inventory:{mode:'preserve'}});
  await page.reload();await page.locator('#editTemplate:not([disabled])').click();await idle();
  assert.equal(await page.locator('#templateInventoryMode').inputValue(),'preserve');
  assert.equal(await page.locator('#templateSaveMode').inputValue(),'draft');
  assert.equal(await page.locator('#templateInventoryQuantity').isDisabled(),true);

  // Older templates do not acquire the new stock/category defaults just by opening.
  const legacy=await api('listing-templates',{name:'旧模板',erpKey:'erp-fixture',platform:'temu',site:'加拿大站',productType:'帆布画',rules:{},storeBindings:[]});
  await page.reload();await page.locator('#activeTemplate:not([disabled])').selectOption(legacy.id);
  await page.locator('#editTemplate').click();await idle();
  assert.equal(await page.locator('#templateCategoryMode').inputValue(),'match');
  assert.equal(await page.locator('#templateSaveMode').inputValue(),'ready');
  assert.equal(await page.locator('#templateInventoryMode').inputValue(),'preserve');
  await page.locator('#templateInventoryMode').selectOption('fixed');
  await page.locator('#templateInventoryQuantity').fill('1.5');
  const beforeInvalid=saveRequests;
  await page.locator('#templateForm').evaluate(form=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
  await page.locator('#workflowNotice.error').waitFor();assert.match(await page.locator('#workflowNotice').innerText(),/整数/);assert.equal(saveRequests,beforeInvalid);
  await page.locator('#templateInventoryQuantity').fill('0');
  const zeroResponse=page.waitForResponse(response=>response.url()===base+'/api/listing-templates'&&response.request().method()==='POST');
  await page.locator('#saveTemplate').click();assert.equal((await zeroResponse).status(),200);await idle();
  const zero=(await api('listing-templates')).templates.find(item=>item.id===legacy.id);assert.deepEqual(zero.rules.inventory,{mode:'fixed',quantity:0});
  assert.equal(zero.rules.categoryMode,'match');
  const job={id:'packaging-review-fixture',status:'needs-review',templateSnapshot:{name:'包装修改核对',version:1},rows:[{goodsId:'601234567890001',storeName:'测试店铺',site:'加拿大站',status:'needs-review',locationStatus:'located',saved:true,ready:false,saveIntent:{status:'confirmed'},issues:['包装重量待补']}],availableActions:['review-corrections']};
  let corrections=0;
  await page.route(base+'/api/listing-workflow',route=>route.fulfill({json:{jobs:[job],busy:false,otherBusy:false}}));
  await page.route(base+'/api/listing-workflow/jobs/'+job.id+'/review-corrections',route=>{
    assert.equal(route.request().method(),'POST');assert.deepEqual(route.request().postDataJSON(),{});corrections++;
    job.availableActions=[];return route.fulfill({json:job});
  });
  await page.locator('#refreshWorkflow').click();
  await page.getByText('草稿已保存并回读，仍有待补项。',{exact:true}).waitFor();
  await page.getByRole('button',{name:'核对包装修改',exact:true}).click();
  await page.locator('[data-job-action="review-corrections"]').waitFor({state:'detached'});
  assert.equal(corrections,1);
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);
  console.log('固定模板批量设置浏览器回归通过：新模板库存10000、旧模板保留原值、分类和草稿保存模式、包装完整性校验、保存回读、禁用统一设置、店铺差异保留、库存整数校验、包装修改动作和窄屏布局；未连接ERP。');
}finally{
  await browser.close();await new Promise(resolve=>app.server.close(resolve));
  assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});
}
