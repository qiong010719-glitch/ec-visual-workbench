import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {createWorkbench} from '../src/server.mjs';

// Every business endpoint is intercepted; this test never connects to an ERP
// or Temu browser. The temporary server supplies static workbench assets only.
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'listing-source-policy-ui-'));
const app=createWorkbench({dataDirectory:directory,configuration:{WORKBENCH_FRESH:'true'},listingWorkflowAdapter:{},settingsCodec:{encode:value=>value,decode:value=>value}});
app.preferences.update({revision:0,browsers:[{key:'chrome',type:'chrome',name:'测试浏览器',debugPort:9456}],erpConnections:[{key:'dxm',name:'测试ERP',browserKey:'chrome',expectedAccount:'fixture'}],stores:[],collectionStores:[{key:'shein-a',erpKey:'dxm',platform:'shein',storeName:'测试店',site:'美国站'}]});
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
const base='http://127.0.0.1:'+app.server.address().port;
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[],requests=[];
page.on('pageerror',error=>errors.push(error.message));
const goods=['601234567890001','601234567890002','601234567890003'];
const category={id:'office-cutter',label:'手工工具',path:['办公和学习用品','手工工具']};
const facts=(categoryPath=category.path,amount='15',currency='USD')=>({categoryPath,price:amount?{amount,currency,kind:'displayed-sale'}:null,selectedVariant:{selectionComplete:!!amount,attributes:[{name:'颜色',value:'紫色'}]},observedAt:'2026-11-25T10:00:00.000Z'});
const source={id:'source-fixture',keyword:'手工用品',erpKey:'dxm',binding:{erpConnection:{key:'dxm',name:'测试ERP'}},rows:goods.map(goodsId=>({goodsId,title:'来源商品 '+goodsId,status:'verified'}))};
const job={id:'job-fixture',workflowMode:'required-fields',fieldPolicy:'dxm-preserved-price-v1',keyword:source.keyword,createdAt:'2026-11-25T10:00:00.000Z',status:'inspected',availableActions:['source-facts','process','reconcile','publish'],sourceRows:[{goodsId:goods[0],sourceFacts:facts()},{goodsId:goods[1],sourceFacts:facts([],null)},{goodsId:goods[2],sourceFacts:facts(['家居','收纳'])}],rows:goods.map((goodsId,index)=>({goodsId,storeBindingKey:'shein-a',storeName:'测试店',site:'美国站',title:'商品 '+(index+1),locationStatus:'located',status:'waiting-category',saved:false,requiredFields:[{label:'产品分类',missing:false}],issues:[]}))};
job.nativeBatch={ready:true};
for(const row of job.rows.slice(0,2))row.productTypeConfirmation={productType:'手工工具',sourcePath:category.path};
Object.assign(job.rows[2],{status:'pending-publication',saved:true,ready:true,publicationStatus:'draft',movedToPending:true,saveIntent:{status:'confirmed'},moveIntent:{status:'confirmed'},categorySelection:{id:'storage',label:'收纳',path:['家居','收纳']}});
job.rows[1].sourceFactsStatus={ready:false,categoryReady:false,priceReady:true,issues:['未读取到来源分类'],categoryPath:[],price:null};
let reads=0;
await page.route('**/*',async route=>{
  const url=new URL(route.request().url());if(url.origin!==base)return route.abort('blockedbyclient');
  if(url.pathname==='/api/free-sourcing')return route.fulfill({json:{jobs:[source],busy:false}});
  if(url.pathname==='/api/listing-workflow')return route.fulfill({json:{jobs:[job],busy:false,otherBusy:false}});
  if(!url.pathname.startsWith('/api/listing-workflow/jobs/'))return route.continue();
  const payload=route.request().postDataJSON();requests.push({path:url.pathname,payload});
  if(url.pathname.endsWith('/categories/read')){
    reads++;assert.equal(payload.goodsId,goods[0]);
    return route.fulfill({json:{catalogId:'fixture-catalog',path:[],options:[{...category,leaf:true}],suggestion:{status:'matched',reason:reads===1?'旧建议需核对当前目录':'完整来源路径已唯一匹配当前目录',category:reads===1?{...category,id:'stale-id'}:category}}});
  }
  if(url.pathname.endsWith('/source-facts')){
    assert.deepEqual(payload,{});job.sourceRows[1].sourceFacts=facts(category.path,'41','JPY');
    job.rows[1].sourceFactsStatus={ready:true,categoryReady:true,priceReady:true,issues:[],...facts(category.path,'41','JPY')};job.rows[1].issues=[];
    return route.fulfill({status:202,json:job});
  }
  if(url.pathname.endsWith('/categories/select')){
    assert.deepEqual(payload.goodsIds,goods.slice(0,2));assert.deepEqual(payload.storeBindingKeys,['shein-a']);assert.deepEqual(payload.category,category);assert.equal(payload.catalogId,'fixture-catalog');
    for(const row of job.rows.slice(0,2)){row.categorySelection=structuredClone(category);row.status='ready';}
    return route.fulfill({json:job});
  }
  if(url.pathname.endsWith('/process')){
    assert.deepEqual(payload,{});assert.equal(job.rows[0].categorySelection?.id,category.id);
    Object.assign(job.rows[0],{status:'pending-publication',saved:true,ready:true,publicationStatus:'draft',movedToPending:true,saveIntent:{status:'confirmed'},moveIntent:{status:'confirmed'}});
    job.rows[1].status='needs-review';job.rows[1].sourceFactsStatus.priceReady=false;job.rows[1].issues=['店小秘售价保存后发生变化，需只读核对'];job.status='partial';job.message='已完成可处理条目，店铺价格待核对的商品单独保留。';job.availableActions=['source-facts','reconcile'];
    return route.fulfill({status:202,json:job});
  }
  if(url.pathname.endsWith('/native-edit')){
    assert.deepEqual(payload,{storeBindingKey:'shein-a'});job.nativeEdit={storeBindingKey:'shein-a',memberIds:[goods[1]],status:'opened',result:{opened:true}};return route.fulfill({status:202,json:job});
  }
  throw new Error('Unexpected business request: '+url.pathname);
});
try{
  await page.goto(base+'/sourcing/listing');await page.locator('.listing-job').waitFor();
  assert.equal(requests.length,0,'opening a task never starts business operations');
  assert.equal(await page.locator('[data-job-action="publish"]').count(),0);
  assert.equal(await page.locator('[data-job-action="prepare"],[data-job-action="pending"]').count(),0);
  assert.match(await page.locator('.batch-progress').innerText(),/3 件中/);
  assert.equal(await page.locator('[data-batch-count="completed"]').innerText(),'1 件已全部转待发布');
  assert.equal(await page.locator('[data-batch-count="category"]').innerText(),'2 件待分类');
  assert.equal(await page.locator('[data-batch-count="price"]').innerText(),'0 件待核对店铺价','missing Temu price cannot block an existing DXM price');
  assert.match(await page.locator('.row-category').first().innerText(),/基础字段.*分类确认后继续读取完整必填项/);
  assert.doesNotMatch(await page.locator('.row-category').first().innerText(),/当前已填写/);
  assert.match(await page.locator('.row-source-facts').first().innerText(),/15 USD/);
  assert.match(await page.locator('.row-source-facts').first().innerText(),/颜色：紫色/);
  assert.match(await page.locator('.source-read-hint').innerText(),/打开 Temu.*只读取/);

  let panel=page.locator('.row-category[data-goods="'+goods[0]+'"]').first();
  await panel.getByRole('button',{name:'读取并选择分类',exact:true}).click();
  await panel.locator('[data-category-option]').waitFor();
  assert.equal(await panel.locator('[data-category-option]').inputValue(),'','stale suggestion IDs cannot be preselected');
  await panel.locator('[data-category-option]').selectOption('0');
  assert.equal(await panel.locator('[data-job-field="category-scope"] option').count(),1,'unknown source paths are excluded from category copying');
  assert.equal(requests.filter(request=>request.path.endsWith('/categories/select')||request.path.endsWith('/process')).length,0);
  await page.getByRole('button',{name:'补读 Temu 来源资料（只读）',exact:true}).click();
  await page.getByText('41 JPY',{exact:true}).waitFor();
  await panel.getByRole('button',{name:'重新读取',exact:true}).click();
  await panel.getByText('完整来源路径已唯一匹配当前目录',{exact:true}).waitFor();
  assert.equal(await panel.locator('[data-category-option]').inputValue(),'0','a current unique leaf suggestion is only preselected');
  assert.equal(requests.filter(request=>request.path.endsWith('/categories/select')||request.path.endsWith('/process')).length,0,'reading source or category suggestions never confirms or starts processing');
  await panel.locator('[data-job-field="category-scope"]').selectOption('batch');
  assert.equal(await panel.locator('[data-job-field="category-scope"] option:checked').innerText(),'本店已确认同类型的 2 件商品');
  await panel.getByRole('button',{name:'确认使用此分类',exact:true}).click();
  await page.getByText('分类已确认。可继续处理本批，待分类或待价格的商品会单独保留。',{exact:true}).waitFor();
  assert.equal(requests.filter(request=>request.path.endsWith('/process')).length,0,'category confirmation still requires an explicit continue click');
  await page.getByRole('button',{name:'继续处理本批到待发布',exact:true}).click();
  await page.locator('[data-job-action="process"]').waitFor({state:'detached'});
  assert.equal(await page.locator('[data-batch-count="completed"]').innerText(),'2 件已全部转待发布');
  assert.equal(await page.locator('[data-batch-count="category"]').innerText(),'0 件待分类');
  assert.equal(await page.locator('[data-batch-count="price"]').innerText(),'1 件待核对店铺价');
  assert.equal(requests.filter(request=>request.path.endsWith('/process')).length,1);
  assert.equal(requests.some(request=>request.path.endsWith('/publish')),false);

  job.nativeBatch={ready:false,reason:'当前平台原生批量自动填充未接通。'};job.availableActions=['prepare','pending','native-edit','reconcile'];
  await page.locator('#refreshWorkflow').click();await page.getByText('原生批量自动填充待接通',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-job-action="process"]').count(),0);
  assert.equal(await page.getByRole('button',{name:'逐件补齐本批必填项并保存',exact:true}).count(),1);
  assert.equal(await page.getByRole('button',{name:'逐件将已就绪商品转入待发布',exact:true}).count(),1);
  await page.getByRole('button',{name:'打开本店原生批量编辑',exact:true}).click();
  assert.equal(requests.filter(request=>request.path.endsWith('/native-edit')).length,1);
  assert.match(await page.locator('.native-store-actions').innerText(),/仅打开所选店铺.*不填写或保存/);
  job.availableActions=['reconcile'];job.rows[1].saveIntent={status:'unknown'};job.rows[1].status='unknown';
  await page.locator('#refreshWorkflow').click();await page.locator('[data-job-action="source-facts"]').waitFor({state:'detached'});
  assert.equal(await page.locator('.row-category[data-goods="'+goods[1]+'"] [data-category-action]').count(),0,'uncertain submissions remain read-only');
  delete job.availableActions;await page.locator('#refreshWorkflow').click();await page.locator('[data-job-action]').waitFor({state:'detached'});
  assert.equal(requests.filter(request=>request.path.endsWith('/process')).length,1,'refresh cannot restart a finished request');
  const output=path.resolve('tests/results/listing-source-policy');fs.mkdirSync(output,{recursive:true});
  await page.screenshot({path:path.join(output,'batch-source-policy-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.join(output,'batch-source-policy-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log('来源策略UI隔离测试通过：分类与同规格币种售价、真实目录建议、同来源子集、独立等待计数、连续处理显式操作、未知提交保护和窄屏布局。');
}finally{
  await browser.close();await new Promise(resolve=>app.server.close(resolve));
  assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});
}
