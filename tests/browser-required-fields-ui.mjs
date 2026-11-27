import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {createWorkbench} from '../src/server.mjs';

// All listing/category operations below are fixtures. No ERP browser is connected.
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'required-fields-ui-'));
const app=createWorkbench({dataDirectory:directory,configuration:{WORKBENCH_FRESH:'true'},listingWorkflowAdapter:{},settingsCodec:{encode:value=>value,decode:value=>value}});
app.preferences.update({revision:0,browsers:[{key:'chrome',type:'chrome',name:'测试浏览器',debugPort:9456}],erpConnections:[{key:'dxm',name:'测试ERP',browserKey:'chrome',expectedAccount:'fixture'}],stores:[],collectionStores:[
  {key:'shein-a',erpKey:'dxm',platform:'shein',storeName:'希音测试店A'},
  {key:'shein-b',erpKey:'dxm',platform:'shein',storeName:'希音测试店B'},
  {key:'temu-ca',erpKey:'dxm',platform:'temu',storeName:'Temu测试店',site:'加拿大站'}
]});
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+app.server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],requests=[];
page.on('pageerror',error=>errors.push(error.message));
const goods=['601234567890001','601234567890002'];
const facts={categoryPath:['家居','榨汁机'],price:{amount:'3.5',currency:'USD',kind:'displayed-sale'},selectedVariant:{selectionComplete:true,attributes:[{name:'颜色',value:'白色'}]}};
const source={id:'fixture-keyword-batch',keyword:'榨汁机',createdAt:'2026-11-24T00:00:00.000Z',erpKey:'dxm',binding:{erpConnection:{key:'dxm',name:'测试ERP'}},rows:goods.map((goodsId,index)=>({goodsId,title:'测试榨汁机'+(index+1),status:'verified'}))};
const jobs=[];
let legacySettings='';const legacyJobs=[];let legacySettingsWrites=0;
const legacyTemplate={id:'legacy-template',name:'旧版固定模板',version:1,erpKey:'dxm',platform:'temu',site:'加拿大站',category:{path:['家居','装饰']},rules:{},storeBindings:[{key:'legacy-temu',storeName:'旧模板测试店',site:'加拿大站'}]};
await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.origin!==base)return route.abort('blockedbyclient');
  if(legacySettings&&url.pathname==='/api/settings'){
    if(route.request().method()==='POST'){legacySettingsWrites++;return route.fulfill({status:400,json:{error:'旧后台不支持采集店铺'}});}
    const settings=app.preferences.view();delete settings[legacySettings==='missing-stores'?'collectionStores':'collectionPlatforms'];return route.fulfill({json:settings});
  }
  if(legacySettings&&url.pathname==='/api/listing-templates')return route.fulfill({json:{templates:[legacyTemplate]}});
  if(url.pathname==='/api/free-sourcing')return route.fulfill({json:{jobs:[source],busy:false}});
  if(url.pathname==='/api/listing-workflow')return route.fulfill({json:{jobs:legacySettings?legacyJobs:jobs,busy:false,otherBusy:false}});
  if(!url.pathname.startsWith('/api/listing-workflow/jobs'))return route.continue();
  const payload=route.request().method()==='POST'?route.request().postDataJSON():null;
  requests.push({path:url.pathname,payload});
  if(url.pathname==='/api/listing-workflow/jobs'){
    if(legacySettings){assert.equal(payload.templateId,legacyTemplate.id);assert.equal(payload.sourceJobId,undefined);assert.equal(payload.destinationKeys,undefined);assert.equal(payload.freeJobId,source.id);legacyJobs.push({id:payload.requestId,status:'created',rows:[],availableActions:[]});return route.fulfill({json:legacyJobs.at(-1)});}
    assert.equal(payload.sourceJobId,source.id);assert.equal(payload.templateId,undefined);assert.deepEqual(payload.goodsIds,goods);assert.deepEqual(payload.destinationKeys,['shein-a','shein-b']);
    jobs.push({id:payload.requestId,workflowMode:'required-fields',keyword:source.keyword,status:'inspected',createdAt:source.createdAt,availableActions:['prepare','publish'],sourceRows:goods.map(goodsId=>({goodsId,sourceFacts:structuredClone(facts)})),rows:goods.flatMap(goodsId=>['shein-a','shein-b'].map(storeBindingKey=>({goodsId,storeBindingKey,storeName:storeBindingKey==='shein-a'?'希音测试店A':'希音测试店B',title:'测试榨汁机',status:'waiting-category',locationStatus:'located',saved:false,requiredFields:[{label:'产品分类',missing:true},{label:'重量',missing:true}]})))});
    for(const row of jobs[0].rows)row.productTypeConfirmation={productType:'便携式榨汁机',sourcePath:facts.categoryPath};
    return route.fulfill({json:jobs[0]});
  }
  const job=jobs[0];
  if(url.pathname.endsWith('/categories/read')){
    const root=payload.path.length===0;
    assert.ok(['shein-a','shein-b'].includes(payload.storeBindingKey));
    return route.fulfill({json:{catalogId:payload.storeBindingKey+(root?'-catalog-root':'-catalog-home'),path:payload.path,options:[root?{id:'home',label:'家居',path:['家居'],leaf:false}:{id:'juicer',label:'榨汁机',path:['家居','榨汁机'],leaf:true}]}});
  }
  if(url.pathname.endsWith('/categories/select')){
    assert.equal(payload.storeBindingKeys.length,1);assert.deepEqual(payload.goodsIds,goods);assert.equal(payload.catalogId,payload.storeBindingKeys[0]+'-catalog-home');assert.deepEqual(payload.category,{id:'juicer',label:'榨汁机',path:['家居','榨汁机']});
    for(const row of job.rows.filter(row=>row.storeBindingKey===payload.storeBindingKeys[0]))row.categorySelection=payload.category;
    return route.fulfill({json:job});
  }
  if(url.pathname.endsWith('/prepare')){
    for(const row of job.rows){assert.equal(row.categorySelection?.id,'juicer');row.saved=true;row.ready=true;row.status='prepared';row.saveIntent={status:'confirmed'};row.requiredFields.forEach(field=>field.missing=false);}
    job.status='prepared';job.message='本批必填项已保存并核对。';job.availableActions=['pending','publish'];return route.fulfill({json:job});
  }
  if(url.pathname.endsWith('/pending')){
    for(const row of job.rows){row.status='pending-publication';row.publicationStatus='draft';row.moveIntent={status:'confirmed'};}
    job.status='pending-publication';job.message='本批商品已全部转入待发布。';job.availableActions=['reconcile'];return route.fulfill({json:job});
  }
  throw new Error('Unexpected fixture route: '+url.pathname);
});
try{
  await page.goto(base+'/sourcing/listing');
  await page.locator('#createListingJob:not([disabled])').waitFor();
  assert.equal(await page.locator('#listingMode').inputValue(),'required-fields');
  assert.equal(await page.locator('#templateLibrary').isVisible(),false);
  assert.equal(await page.locator('[data-run-destination]').count(),2);
  assert.equal(await page.locator('[data-run-destination="temu-ca"]').count(),0);
  await page.locator('#createListingJob').click();
  await page.locator('.listing-job').waitFor();
  assert.equal(await page.locator('[data-job-action="publish"]').count(),0);
  for(const storeKey of ['shein-a','shein-b']){
  const first=page.locator('.row-category[data-store="'+storeKey+'"]').first();
  await first.getByRole('button',{name:'读取并选择分类',exact:true}).click();
  await first.locator('[data-category-option]').selectOption('0');
  await first.getByText('家居',{exact:true}).waitFor();
  await first.locator('[data-category-option]').selectOption('0');
  await first.locator('[data-job-field="category-scope"]').selectOption('batch');
  assert.equal(await first.locator('[data-job-field="category-scope"] option').count(),2);
  await first.getByRole('button',{name:'确认使用此分类'}).click();
  await page.getByText('分类已确认。可继续处理本批，待分类或待价格的商品会单独保留。',{exact:true}).waitFor();
  }
  assert.equal(requests.filter(request=>request.path.endsWith('/categories/select')).length,2);
  assert.match(await page.locator('.row-category').first().innerText(),/家居 → 榨汁机/);
  await page.getByRole('button',{name:'逐件补齐本批必填项并保存',exact:true}).click();
  await page.getByRole('button',{name:'逐件将已就绪商品转入待发布',exact:true}).click();
  await page.locator('.job-head .state.pending-publication').waitFor();
  assert.equal(requests.some(request=>request.path.endsWith('/publish')),false);
  const output=path.resolve('tests/results/required-fields-ui');fs.mkdirSync(output,{recursive:true});
  await page.screenshot({path:path.join(output,'batch-pending-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.join(output,'batch-pending-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(base+'/settings#collectionStores');
  await page.locator('#newCollectionStore').click();
  await page.locator('#collectionStoreForm [name="storeName"]').fill('希音测试店C');
  await page.locator('#collectionStoreForm [name="platform"]').selectOption('shein');
  await page.locator('#saveCollectionStore').click();
  await page.getByText('“希音测试店C”采集箱绑定已保存，可在本批补全页选择。',{exact:true}).waitFor();
  const settings=app.preferences.view();assert.equal(settings.collectionStores.length,4);assert.equal(settings.stores.length,0);assert.equal(settings.collectionStores.find(store=>store.storeName==='希音测试店C').site,'');
  await page.screenshot({path:path.join(output,'collection-bindings.png'),fullPage:true});
  await page.goto(base+'/sourcing/listing?mode=template');
  await page.locator('#templateLibrary').waitFor({state:'visible'});
  assert.equal(await page.locator('#destinationSetup').isVisible(),false);
  const compatibilityMessage='请关闭旧工作台服务后重新启动，启用新版采集店铺功能',beforeLegacyRequests=requests.length;
  for(const shape of ['missing-stores','missing-platforms']){
    legacySettings=shape;
    await page.goto(base+'/sourcing/listing');
    await page.locator('#createListingHint').getByText(compatibilityMessage,{exact:true}).waitFor();
    assert.equal(await page.locator('#createListingJob').isDisabled(),true,shape);
    await page.locator('#listingJobForm').dispatchEvent('submit');
    await page.locator('#workflowNotice').getByText(compatibilityMessage,{exact:true}).waitFor();
    assert.equal(requests.length,beforeLegacyRequests,shape+' must not send automatic job requests');
    await page.goto(base+'/settings#collectionStores');
    await page.locator('#collectionBackendNotice').getByText(compatibilityMessage,{exact:true}).waitFor();
    assert.equal(await page.locator('#newCollectionStore').isDisabled(),true,shape);
    assert.equal(await page.locator('#saveCollectionStore').isDisabled(),true,shape);
    await page.locator('#collectionStoreForm').dispatchEvent('submit');
    await page.locator('#notice').getByText(compatibilityMessage,{exact:true}).waitFor();
    assert.equal(legacySettingsWrites,0,shape+' must reject collection settings before POST');
  }
  await page.goto(base+'/sourcing/listing?mode=template');
  await page.locator('#createListingJob:not([disabled])').waitFor();
  assert.equal(await page.locator('#templateLibrary').isVisible(),true);
  await page.locator('#createListingJob').click();
  await page.locator('#workflowNotice').getByText('本批上架任务已保存。可先核对认领记录和商品资料。',{exact:true}).waitFor();
  assert.equal(legacyJobs.length,1,'legacy template jobs remain available');
  assert.deepEqual(errors,[]);
  console.log('必填补全UI隔离验收通过：无母稿SHEIN绑定、同平台店铺分组、无模板建任务、逐级分类和catalogId、分类仅同店批量应用、转待发布不正式发布、旧模板入口与窄屏布局；旧后台禁用新功能并在提交处拒绝，旧模板任务仍可建立。');
}finally{
  await browser.close();await new Promise(resolve=>app.server.close(resolve));
  assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});
}
