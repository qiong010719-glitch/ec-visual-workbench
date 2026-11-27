import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {createWorkbench} from '../src/server.mjs';

// Static assets are served locally; every workflow endpoint is intercepted.
// The browser has an isolated profile and cannot reach Temu, DXM or a model.
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'listing-category-search-ui-'));
const app=createWorkbench({dataDirectory:directory,configuration:{WORKBENCH_FRESH:'true'},listingWorkflowAdapter:{},settingsCodec:{encode:value=>value,decode:value=>value}});
app.preferences.update({revision:0,browsers:[{key:'chrome',type:'chrome',name:'测试浏览器',debugPort:9456}],erpConnections:[{key:'dxm',name:'测试ERP',browserKey:'chrome',expectedAccount:'fixture'}],stores:[],collectionStores:[{key:'shein-a',erpKey:'dxm',platform:'shein',storeName:'测试店',site:'美国站'}]});
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+app.server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[],requests=[];
page.on('pageerror',error=>errors.push(error.message));
const goods=['601234567890001','601234567890002','601234567890003','601234567890004','601234567890005'];
const sourcePath=['家用电器','厨房小电器'],type='便携式果汁机';
const source={id:'source-fixture',keyword:type,erpKey:'dxm',binding:{erpConnection:{key:'dxm',name:'测试ERP'}},rows:goods.map(goodsId=>({goodsId,title:'来源商品 '+goodsId,status:'verified'}))};
const row=(goodsId,index)=>({id:'row-'+index,goodsId,storeBindingKey:'shein-a',storeName:'测试店',site:'美国站',title:['便携式果汁机 A','便携式果汁机 B','料理搅拌机','收纳架','已提交待核对商品'][index],locationStatus:'located',status:'waiting-category',saved:false,requiredFields:[{label:'产品分类',missing:true}],issues:[]});
const job={id:'job-search',workflowMode:'required-fields',fieldPolicy:'dxm-preserved-price-v1',keyword:type,createdAt:new Date().toISOString(),status:'inspected',availableActions:['process','prepare','pending','reconcile'],categorySearch:{supported:true},nativeBatch:{ready:true},sourceRows:goods.map((goodsId,index)=>({goodsId,sourceFacts:{categoryPath:index===3?['家居','收纳']:sourcePath,price:null}})),rows:goods.map(row)};
job.rows[2].productTypeConfirmation={productType:'料理搅拌机',sourcePath};job.rows[4].saveIntent={status:'unknown'};
job.rows.push({...row(goods[0],5),id:'row-other-store',storeBindingKey:'shein-b',storeName:'另一店',title:'另一店同商品'});
const candidates=[
  {candidateId:'search-ref-one',platformCategoryId:'shein-101',idKind:'platform',label:'榨汁机',path:['家居','厨房电器','榨汁机'],leaf:true,source:'store-search'},
  {candidateId:'search-ref-two',platformCategoryId:'shein-102',idKind:'platform',label:'榨汁机',path:['商用设备','饮品设备','榨汁机'],leaf:true,source:'store-recommendation'}
];
let searches=0,conflictOnce=true;
await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin!==base)return route.abort('blockedbyclient');
  if(url.pathname==='/api/free-sourcing')return route.fulfill({json:{jobs:[source],busy:false}});
  if(url.pathname==='/api/listing-workflow')return route.fulfill({json:{jobs:[job],busy:false,otherBusy:false}});
  if(!url.pathname.startsWith('/api/listing-workflow/jobs/'))return route.continue();
  const payload=route.request().postDataJSON();requests.push({path:url.pathname,payload});
  if(url.pathname.endsWith('/categories/search')){
    searches++;assert.equal(payload.goodsId,goods[0]);assert.equal(payload.storeBindingKey,'shein-a');
    assert.equal(payload.query,'果汁机');assert.equal(payload.productType,type);assert.equal(payload.usage,'水果榨汁');
    assert.equal(Object.hasOwn(payload,'confirmProductType'),false);
    return route.fulfill({json:{catalogId:'catalog-'+searches,catalogDigest:'digest-'+searches,goodsId:goods[0],storeBindingKey:'shein-a',scope:{jobId:job.id,account:'fixture',platform:'shein',mode:'marketplace',storeBindingKey:'shein-a',site:'美国站'},product:{id:'row-0',title:job.rows[0].title,usage:'水果榨汁',sourcePath,productType:type,productTypeConfirmed:false},query:payload.query,candidates,resolution:{status:'needs-confirmation',method:'model-ranking',category:null,proposedCandidate:candidates[0],rankedCandidates:candidates,reason:'现有候选仍需确认',modelReason:'用途为水果榨汁',confidence:1,confirmed:true},observedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+15*60*1000).toISOString()}});
  }
  if(url.pathname.endsWith('/categories/resolve')){
    assert.equal(payload.catalogId,'catalog-'+searches);assert.equal(payload.catalogDigest,'digest-'+searches);assert.equal(payload.candidateId,candidates[0].candidateId);
    assert.deepEqual(payload.goodsIds,goods.slice(0,2));assert.equal(payload.storeBindingKey,'shein-a');assert.equal(payload.productType,type);assert.equal(payload.confirmProductType,true);
    assert.equal(Object.hasOwn(payload,'category'),false,'the browser submits a candidate reference, never manufactures a platform category');
    if(conflictOnce){conflictOnce=false;return route.fulfill({status:409,json:{error:'来源资料已变化，请重新搜索并确认'}});}
    for(const item of job.rows.slice(0,2)){item.categorySelection={category:candidates[0],resolutionStatus:'resolved'};item.productTypeConfirmation={productType:type,sourcePath};item.status='ready';}
    return route.fulfill({json:job});
  }
  if(url.pathname.endsWith('/process')){
    assert.deepEqual(payload,{});job.status='running';job.progress={phase:'prepare',stage:'fill-fields',active:true,message:'正在填写所选分类的属性与必填项'};job.availableActions=['stop'];
    return route.fulfill({status:202,json:job});
  }
  throw new Error('Unexpected business request: '+url.pathname);
});
const panel=()=>page.locator(`.row-category[data-goods="${goods[0]}"][data-store="shein-a"]`);
async function selectBatch(){
  await panel().locator('[data-category-candidate]').first().check();
  await panel().locator('[data-category-field="scope"]').selectOption('batch');
  assert.equal(await panel().locator('[data-category-field="member"]').count(),2,'different types, paths, shops and uncertain submissions are excluded');
  assert.equal(await panel().locator('[data-category-field="member"]:checked').count(),1,'peers require an explicit per-product selection');
  await panel().locator(`[data-member-goods="${goods[1]}"]`).check();
  await panel().getByRole('button',{name:'确认所选 2 件商品分类',exact:true}).click();
  await page.getByText('批量确认前，请明确填写并确认所选商品的具体类型。',{exact:true}).waitFor();
  assert.equal(requests.filter(request=>request.path.endsWith('/categories/resolve')).length,searches-1);
  await panel().locator('[data-category-field="confirm-type"]').check();
  await panel().getByRole('button',{name:'确认所选 2 件商品分类',exact:true}).click();
}
try{
  await page.goto(base+'/sourcing/listing');await panel().waitFor();
  assert.equal(requests.length,0,'opening the workbench does not search or run a batch');
  assert.equal(await page.locator('.native-flow').count(),1);
  assert.match(await page.locator('.native-flow').innerText(),/批量填写属性与必填项.*保存并回读核对.*转入待发布/s);
  assert.equal(await page.locator('[data-job-action="prepare"],[data-job-action="pending"]').count(),0);
  await panel().locator('[data-category-field="query"]').fill('果汁机');
  await panel().locator('[data-category-field="product-type"]').fill(type);
  await panel().locator('[data-category-field="usage"]').fill('水果榨汁');
  await panel().getByRole('button',{name:'搜索本店真实分类',exact:true}).click();
  await panel().getByText('模型排序建议，尚未确认',{exact:true}).waitFor();
  assert.equal(searches,1);assert.equal(await panel().locator('[data-category-candidate]:checked').count(),0,'even confidence=1 does not pre-confirm a model choice');
  assert.match(await panel().locator('.category-candidates').innerText(),/家居 → 厨房电器 → 榨汁机/);
  assert.match(await panel().locator('.category-candidates').innerText(),/商用设备 → 饮品设备 → 榨汁机/);
  assert.equal(requests.some(request=>request.path.endsWith('/process')||request.path.endsWith('/categories/resolve')),false);
  await selectBatch();
  await page.getByText('来源资料已变化，请重新搜索并确认',{exact:true}).waitFor();
  assert.equal(await panel().locator('[data-category-candidate]').count(),0,'a stale server snapshot is discarded on 409');
  assert.equal(searches,1,'a conflict never automatically repeats a search or model request');
  await panel().getByRole('button',{name:'搜索本店真实分类',exact:true}).click();
  await panel().getByText('模型排序建议，尚未确认',{exact:true}).waitFor();
  // The earlier checkbox stays explicit but a new search starts with one member.
  await panel().locator('[data-category-candidate]').first().check();
  await panel().locator('[data-category-field="scope"]').selectOption('batch');
  assert.equal(await panel().locator('[data-category-field="member"]:checked').count(),1);
  await panel().locator(`[data-member-goods="${goods[1]}"]`).check();
  await panel().getByRole('button',{name:'确认所选 2 件商品分类',exact:true}).click();
  await page.getByText('已明确确认 2 件商品的分类。可继续执行本批可处理商品，其余待分类项单独保留。',{exact:true}).waitFor();
  assert.equal(requests.filter(request=>request.path.endsWith('/process')).length,0,'category confirmation never starts saving');
  assert.equal(await page.locator('[data-batch-count="category"]').innerText(),'4 件待分类','the other store and unresolved peers remain visible');
  await page.getByRole('button',{name:'继续处理本批到待发布',exact:true}).click();
  await page.getByText('当前进度：正在填写所选分类的属性与必填项',{exact:true}).waitFor();
  assert.match(await page.locator('.native-flow [aria-current="step"]').innerText(),/填写属性/);
  job.progress={phase:'verify',stage:'save-readback',active:true,message:'正在核对保存后的资料与原售价'};
  await page.locator('#refreshWorkflow').click();await page.getByText('当前进度：正在核对保存后的资料与原售价',{exact:true}).waitFor();
  assert.match(await page.locator('.native-flow [aria-current="step"]').innerText(),/保存并回读/);
  job.progress={phase:'pending',active:true,message:'正在核对待发布记录'};
  await page.locator('#refreshWorkflow').click();await page.getByText('当前进度：正在核对待发布记录',{exact:true}).waitFor();
  assert.match(await page.locator('.native-flow [aria-current="step"]').innerText(),/转入待发布/);
  job.nativeBatch={ready:false,reason:'该平台尚未接通原生批量表单'};job.availableActions=['process','prepare','pending','reconcile'];
  await page.locator('#refreshWorkflow').click();await page.getByText('原生批量自动填充待接通',{exact:true}).waitFor();
  assert.equal(await page.locator('.native-flow,[data-job-action="process"]').count(),0,'unsupported platform cannot appear ready even if actions are stale');
  assert.equal(await page.getByRole('button',{name:'逐件补齐本批必填项并保存',exact:true}).count(),1);
  assert.equal(requests.filter(request=>request.path.endsWith('/process')).length,1);
  job.needsReconcile=true;await page.locator('#refreshWorkflow').click();await page.getByText('已有执行结果待核对，完成核对后再修改分类。').first().waitFor();
  assert.equal(await page.locator('[data-category-action]').count(),0);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);console.log('分类搜索UI隔离测试通过：真实完整路径、模型只建议、显式同类型子集、409清候选、能力显隐与原生阶段。');
}finally{
  await browser.close();await new Promise(resolve=>app.server.close(resolve));
  assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});
}
