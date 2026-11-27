import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createListingTemplates} from '../src/listing-templates.mjs';
import {createListingWorkflow} from '../src/listing-workflow.mjs';

const clone=value=>structuredClone(value);
const goodsIds=['601234567890001','601234567890002'];
function fixture(t,{complete=true,publish=false}={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'listing-workflow-'));
  t.after(()=>{assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});});
  const erpConnection={key:'erp-fixture',provider:'dianxiaomi',browserKey:'chrome-fixture',expectedAccount:'fixture-account',name:'测试店小秘'},browserConfig={key:'chrome-fixture',type:'chrome',debugPort:9222};
  const preferences={erp:()=>clone(erpConnection),browser:()=>clone(browserConfig)},templates=createListingTemplates({directory:path.join(directory,'templates'),preferences});
  const template=templates.save({name:'加拿大帆布画',erpKey:erpConnection.key,platform:'temu',site:'加拿大站',productType:'帆布画',category:complete?{path:['家居、厨房用品','装饰字画','海报和印刷品']}:{},rules:{},storeBindings:[{key:'store-one',storeName:'店铺1',warehouse:complete?'仓库1':'',shippingTemplate:complete?'加拿大':'',dispatch:complete?'2个工作日内发货':''},{key:'store-two',storeName:'店铺2测试',warehouse:complete?'仓库2':'',shippingTemplate:complete?'加拿大2':'',dispatch:complete?'1个工作日内发货':''}]});
  const freeJob={id:'free-fixture-01',erpKey:erpConnection.key,keyword:'canvas wall art',binding:{erpConnection:clone(erpConnection),browserConfig:clone(browserConfig)},rows:goodsIds.map((goodsId,index)=>({goodsId,sourceUrl:`https://www.temu.com/fixture-g-${goodsId}.html`,title:`测试商品${index+1}`,status:'verified',evidence:{editUrl:`https://www.dianxiaomi.com/web/productCrawl/edit?id=21983579462844462${index}`,sourceUrl:`https://www.temu.com/fixture-g-${goodsId}.html`}}))};
  const freeSourcing={view:()=>({jobs:[clone(freeJob)]})},calls=[],saved=new Set(),published=new Set();
  const backend={
    inspect:async args=>{calls.push('inspect');return {rows:args.rows.flatMap((row,index)=>args.templateSnapshot.storeBindings.map((store,storeIndex)=>({goodsId:row.goodsId,storeBindingKey:store.key,sourceUrl:row.sourceUrl,storeName:store.storeName,site:store.site,status:'located',issues:[],platformEditUrl:`https://www.dianxiaomi.com/web/popTemu/edit?id=220114595121490${index}${storeIndex}0`})))};},
    prepare:async args=>{calls.push('prepare:'+args.row.id);await args.beforeSave({url:args.row.platformEditUrl,before:{title:args.row.title,empty:''}});saved.add(args.row.id);return {status:'prepared',ready:true,saved:true,published:false,issues:[],url:args.row.platformEditUrl};},
    verify:async args=>{calls.push('verify:'+args.row.id);return {status:saved.has(args.row.id)?'prepared':'needs-review',ready:saved.has(args.row.id),saved:saved.has(args.row.id),published:published.has(args.row.id),issues:saved.has(args.row.id)?[]:['尚未保存'],url:args.row.platformEditUrl};}
  };
  if(publish)backend.publish=async args=>{calls.push('publish:'+args.row.id);await args.beforePublish({url:args.row.platformEditUrl});published.add(args.row.id);return {published:true,issues:[]};};
  let otherBusy=false;
  const options={directory:path.join(directory,'workflow'),configuration:{SADCAPTCHA_API_KEY:'fixture-secret'},preferences,templates,freeSourcing,adapter:backend,isOtherBusy:()=>otherBusy};
  const request={requestId:'listing-fixture-01',freeJobId:freeJob.id,goodsIds,templateId:template.id,templateVersion:template.version};
  return {directory,erpConnection,browserConfig,templates,template,freeJob,backend,options,request,calls,saved,published,setOtherBusy:value=>{otherBusy=value;},service:createListingWorkflow(options)};
}
async function idle(service){const until=Date.now()+4000;while(service.isBusy()){if(Date.now()>until)throw new Error('fixture timeout');await new Promise(resolve=>setTimeout(resolve,2));}}
async function run(service,id,action){service.run(id,action);await idle(service);return service.get(id);}

function requiredFixture(t){
  const f=fixture(t,{publish:true});
  f.destinations=f.template.storeBindings.map(store=>({key:store.key,erpKey:f.erpConnection.key,platform:'temu',storeName:store.storeName,storeId:store.key,site:store.site}));
  f.options.preferences.view=()=>({collectionStores:clone(f.destinations)});
  f.request={requestId:'required-fixture',workflowMode:'required-fields',sourceJobId:f.freeJob.id,goodsIds:[...goodsIds],destinationKeys:f.destinations.map(store=>store.key)};
  f.categories=[{id:'100',label:'电动榨汁机',path:['电动榨汁机'],leaf:true},{id:'101',label:'手动榨汁机',path:['手动榨汁机'],leaf:true},{id:'200',label:'厨房用品',path:['厨房用品'],leaf:false}];
  f.backend.readCategories=async args=>({account:f.erpConnection.expectedAccount,platform:args.templateSnapshot.platform,storeBindingKey:args.storeBinding.key,path:clone(args.path),options:args.path.length?[]:clone(f.categories)});
  f.pending=new Set();
  f.backend.moveToPending=async args=>{
    f.calls.push('pending:'+args.row.id);
    await args.beforeMoveToPending({draftId:args.row.draftId,goodsId:args.row.goodsId,storeBindingKey:args.row.storeBindingKey,url:args.row.platformEditUrl,sourceUrl:args.row.sourceUrl,from:'collection',to:'pending-publication'});
    const persisted=JSON.parse(fs.readFileSync(path.join(f.options.directory,'state.json'),'utf8')).jobs[f.request.requestId].rows.find(row=>row.id===args.row.id);assert.equal(persisted.moveIntent.status,'pending');
    f.pending.add(args.row.id);await args.onMovedToPending({draftId:args.row.draftId,movedToPending:true,publicationStatus:'draft'});
    return {publicationStatus:'draft',publicationNotSubmitted:true,movedToPending:true,published:false,submitted:false,saved:true,ready:true,issues:[]};
  };
  f.backend.verifyPublication=async args=>({readOnly:true,publicationStatus:f.pending.has(args.row.id)?'draft':'unknown',publicationNotSubmitted:true,movedToPending:f.pending.has(args.row.id),published:false,submitted:false,saved:true,ready:f.pending.has(args.row.id),issues:[]});
  return f;
}
async function selectRequired(f,jobId){
  for(const store of f.destinations){
    const catalog=await f.service.readCategories(jobId,{goodsId:goodsIds[0],storeBindingKey:store.key,path:[]});
    for(const [index,goodsId] of goodsIds.entries())f.service.selectCategories(jobId,{goodsIds:[goodsId],storeBindingKeys:[store.key],catalogId:catalog.catalogId,category:f.categories[index]});
  }
}

test('SHEIN claim receipts must retain exact store IDs and cannot invent a site selection',async t=>{
  for(const mutation of ['wrong-store-id','invented-site','extra-store'])await t.test(mutation,async t=>{
    const f=requiredFixture(t);f.destinations.forEach(store=>{store.platform='shein';store.site='美国站';});
    f.backend.inspect=async args=>({rows:args.rows.flatMap(row=>args.templateSnapshot.storeBindings.map(store=>({goodsId:row.goodsId,storeBindingKey:store.key,status:'unclaimed'})))});
    let submissions=0;
    f.options.allocationAdapter={claimDestinations:async args=>{
      const destinations=args.destinations.map(item=>({...item,site:''}));
      if(mutation==='wrong-store-id')destinations[0].storeId='wrong';
      if(mutation==='invented-site')destinations[0].site='美国站';
      if(mutation==='extra-store')destinations.push({platform:'shein',storeName:'未选店铺',storeId:'other',site:''});
      await args.beforeClaim({goodsIds:[...goodsIds],destinations,skipDuplicates:true});submissions++;return {submitted:true};
    }};
    f.service=createListingWorkflow(f.options);const job=f.service.create(f.request);await run(f.service,job.id,'inspect');
    const result=await run(f.service,job.id,'claim');assert.equal(submissions,0);assert.equal(result.claimIntent,undefined);assert.match(result.message,/不一致/);
  });
});

test('changing a SHEIN site label cannot replay an unresolved claim to the same store',async t=>{
  const f=requiredFixture(t);f.destinations.forEach(store=>{store.platform='shein';store.site='美国站';});
  const other=f.destinations.map(store=>({...store,key:store.key+'-ca',site:'加拿大站'}));f.destinations.push(...other);
  f.backend.inspect=async args=>({rows:args.rows.flatMap(row=>args.templateSnapshot.storeBindings.map(store=>({goodsId:row.goodsId,storeBindingKey:store.key,status:'unclaimed'})))});
  let submissions=0;
  f.options.allocationAdapter={claimDestinations:async args=>{await args.beforeClaim({goodsIds:[...goodsIds],destinations:args.destinations.map(item=>({...item,site:''})),skipDuplicates:true});submissions++;throw new Error('fixture unknown receipt');}};
  f.service=createListingWorkflow(f.options);const first=f.service.create(f.request);await run(f.service,first.id,'inspect');
  assert.equal((await run(f.service,first.id,'claim')).claimIntent.status,'unknown');
  const second=f.service.create({...f.request,requestId:'other-site-label',destinationKeys:other.map(store=>store.key)});await run(f.service,second.id,'inspect');
  const blocked=await run(f.service,second.id,'claim');assert.match(blocked.message,/相同商品仍有未决提交/);assert.equal(submissions,1);assert.equal(blocked.claimIntent,undefined);
});

test('restored SHEIN jobs retain manual IDs but accept account-bound unique-name evidence for ID-less controls',async t=>{
  const f=requiredFixture(t);f.destinations.forEach(store=>{store.platform='shein';store.site='美国站';});
  f.backend.inspect=async args=>({rows:args.rows.flatMap(row=>args.templateSnapshot.storeBindings.map(store=>({goodsId:row.goodsId,storeBindingKey:store.key,status:'unclaimed'})))});
  let submissions=0;
  f.options.allocationAdapter={claimDestinations:async args=>{
    const destinations=args.destinations.map(item=>({...item,storeId:'',site:''}));
    await args.beforeClaim({goodsIds:[...goodsIds],destinations,skipDuplicates:true,storeIdentityEvidence:{account:f.erpConnection.expectedAccount,pageUrl:'https://www.dianxiaomi.com/web/productCrawl/dataAcquisition',shops:destinations.map(item=>({...item,disabled:false}))}});
    submissions++;return {status:'needs-review',submitted:true};
  }};
  const created=f.service.create(f.request),before=clone(created.destinationSnapshot);
  f.service=createListingWorkflow(f.options);await run(f.service,created.id,'reconcile');
  const job=await run(f.service,created.id,'claim');
  assert.equal(submissions,1);assert.deepEqual(job.destinationSnapshot,before);assert.deepEqual(job.claimIntent.destinations.map(item=>item.storeId),['store-one','store-two']);
  assert.ok(job.claimIntent.payload.destinations.every(item=>item.storeId===''));
  assert.equal(job.claimIntent.payload.storeIdentityEvidence.account,'fixture-account');assert.equal(job.claimIntent.status,'unknown');
  assert.throws(()=>f.service.run(job.id,'claim'),/核对|认领|提交/);assert.equal(submissions,1);
});

test('ID-less SHEIN claim evidence cannot be missing, cross-account, ambiguous, disabled or inconsistent',async t=>{
  for(const mutation of ['missing','account','page','duplicate','disabled','real-id','wrong-platform'])await t.test(mutation,async t=>{
    const f=requiredFixture(t);f.destinations.forEach(store=>{store.platform='shein';store.site='美国站';});
    f.backend.inspect=async args=>({rows:args.rows.flatMap(row=>args.templateSnapshot.storeBindings.map(store=>({goodsId:row.goodsId,storeBindingKey:store.key,status:'unclaimed'})))});
    let submissions=0;
    f.options.allocationAdapter={claimDestinations:async args=>{
      const destinations=args.destinations.map(item=>({...item,storeId:'',site:''}));
      const storeIdentityEvidence={account:f.erpConnection.expectedAccount,pageUrl:'https://www.dianxiaomi.com/web/productCrawl/dataAcquisition',shops:destinations.map(item=>({...item,disabled:false}))};
      if(mutation==='account')storeIdentityEvidence.account='other-account';
      if(mutation==='page')storeIdentityEvidence.pageUrl='https://example.com';
      if(mutation==='duplicate')storeIdentityEvidence.shops.push({...storeIdentityEvidence.shops[0]});
      if(mutation==='disabled')storeIdentityEvidence.shops[0].disabled=true;
      if(mutation==='real-id')storeIdentityEvidence.shops[0].storeId='wrong';
      if(mutation==='wrong-platform')storeIdentityEvidence.shops[0].platform='temu';
      await args.beforeClaim({goodsIds:[...goodsIds],destinations,skipDuplicates:true,...(mutation==='missing'?{}:{storeIdentityEvidence})});submissions++;return {submitted:true};
    }};
    f.service=createListingWorkflow(f.options);const job=f.service.create(f.request);await run(f.service,job.id,'inspect');
    const result=await run(f.service,job.id,'claim');assert.equal(submissions,0);assert.equal(result.claimIntent,undefined);
    assert.match(result.message,/编号|账号|页面|重名|停用|未找到/);
  });
});

test('required-field jobs freeze configured collection destinations without a fixed listing template',t=>{
  const f=requiredFixture(t);f.templates.snapshot=()=>{throw new Error('fixed template must not be read');};
  const job=f.service.create(f.request);assert.equal(job.workflowMode,'required-fields');assert.equal(job.completionMode,'pending');assert.equal(job.templateSnapshot.rules.autoFillRequired,true);assert.equal(job.rows.length,4);assert.ok(job.rows.every(row=>row.categoryRequired));assert.equal(job.configurationReadiness.ready,false);
  assert.equal(f.service.create({...f.request,requestId:'same-required'}).id,job.id);assert.throws(()=>f.service.create({...f.request,goodsIds:[goodsIds[0]]}),/任务编号已用于/);
  f.destinations[1].platform='shein';assert.throws(()=>f.service.create({...f.request,requestId:'mixed-platforms'}),/同一平台和站点/);
  f.destinations[1].platform='temu';f.destinations[1].erpKey='another-erp';assert.throws(()=>f.service.create({...f.request,requestId:'wrong-erp'}),/同一ERP账号/);
});

test('category selection requires fresh leaf evidence for the same account platform and store',async t=>{
  const f=requiredFixture(t);
  for(const row of f.freeJob.rows)row.sourceFacts={goodsId:row.goodsId,sourceUrl:row.sourceUrl,observedAt:new Date().toISOString(),categoryPath:['家用电器','榨汁机'],selectedVariant:{selectionComplete:false,attributes:[]},priceCandidates:[]};
  const job=f.service.create(f.request);await run(f.service,job.id,'inspect');
  const input={goodsId:goodsIds[0],storeBindingKey:'store-one',path:[]},catalog=await f.service.readCategories(job.id,input);
  const select={goodsIds:[goodsIds[0]],storeBindingKeys:['store-one'],catalogId:catalog.catalogId,category:f.categories[0]};
  assert.throws(()=>f.service.selectCategories(job.id,{...select,category:f.categories[2]}),/末级目录/);
  assert.throws(()=>f.service.selectCategories(job.id,{...select,category:{...f.categories[0],id:'invented'}}),/末级目录/);
  assert.throws(()=>f.service.selectCategories(job.id,{...select,storeBindingKeys:['store-two']}),/末级目录/);
  await assert.rejects(f.service.readCategories(job.id,{...input,path:['猜测分类']}),/刚读取的目录/);
  const selected=f.service.selectCategories(job.id,select);assert.equal(selected.rows.filter(row=>!row.categoryRequired).length,1);assert.equal(selected.rows.find(row=>row.storeBindingKey==='store-one'&&row.goodsId===goodsIds[0]).category.id,'100');
  await f.service.readCategories(job.id,input);assert.throws(()=>f.service.selectCategories(job.id,select),/目录已过期/);
  const fresh=await f.service.readCategories(job.id,input),realNow=Date.now;try{Date.now=()=>realNow()+16*60*1000;assert.throws(()=>f.service.selectCategories(job.id,{...select,catalogId:fresh.catalogId}),/目录已过期/);}finally{Date.now=realNow;}
  const reader=f.backend.readCategories;for(const bad of [{account:'other-account'},{platform:'shein'},{storeBindingKey:'store-two'}]){f.backend.readCategories=async args=>({...await reader(args),...bad});await assert.rejects(f.service.readCategories(job.id,input),/账号、平台、店铺或路径/);}f.backend.readCategories=reader;
  const restored=createListingWorkflow(f.options);await run(restored,job.id,'reconcile');assert.throws(()=>restored.selectCategories(job.id,{...select,catalogId:fresh.catalogId}),/目录已过期/);
});

test('per-product selected categories reach preparation and the batch stops at pending publication',async t=>{
  const f=requiredFixture(t),job=f.service.create(f.request);await run(f.service,job.id,'inspect');assert.throws(()=>f.service.run(job.id,'prepare'),/未选择末级分类/);await selectRequired(f,job.id);
  const base=f.backend.prepare,seen=[];f.backend.prepare=async args=>{seen.push([args.row.goodsId,args.storeBinding.key,args.templateSnapshot.category.id]);assert.equal(args.completionMode,'pending');assert.equal(args.templateSnapshot.rules.autoFillRequired,true);return base(args);};
  const preparedJob=await run(f.service,job.id,'prepare');assert.deepEqual(seen.map(row=>row[2]),['100','100','101','101']);assert.ok(preparedJob.availableActions.includes('pending'));assert.ok(!preparedJob.availableActions.includes('publish'));
  assert.throws(()=>f.service.run(job.id,'publish'),/只允许转入待发布/);assert.throws(()=>f.service.selectCategories(job.id,{goodsIds:[goodsIds[0]],storeBindingKeys:['store-one'],category:f.categories[1]}),/已有提交记录/);
  const result=await run(f.service,job.id,'pending');assert.equal(result.status,'pending-ready');assert.equal(result.totals.pending,4);assert.equal(result.totals.published,0);assert.ok(result.rows.every(row=>row.moveIntent.status==='confirmed'&&!row.publishIntent));assert.equal(f.calls.filter(call=>call.startsWith('pending:')).length,4);assert.equal(f.calls.filter(call=>call.startsWith('publish:')).length,0);
});

test('an unknown pending move requires readback and never repeats the recorded movement',async t=>{
  const f=requiredFixture(t),job=f.service.create(f.request);await run(f.service,job.id,'inspect');await selectRequired(f,job.id);await run(f.service,job.id,'prepare');
  const base=f.backend.moveToPending;let first=true;f.backend.moveToPending=async args=>{if(!first)return base(args);first=false;await args.beforeMoveToPending({draftId:args.row.draftId,goodsId:args.row.goodsId,storeBindingKey:args.row.storeBindingKey,url:args.row.platformEditUrl,sourceUrl:args.row.sourceUrl,from:'collection',to:'pending-publication'});f.calls.push('unknown-pending');f.pending.add(args.row.id);throw new Error('response lost');};
  const failed=await run(f.service,job.id,'pending');assert.equal(failed.rows[0].moveIntent.status,'unknown');assert.deepEqual(failed.availableActions,['reconcile']);
  const restored=createListingWorkflow(f.options);await run(restored,job.id,'reconcile');const result=await run(restored,job.id,'pending');assert.equal(result.status,'pending-ready');assert.equal(f.calls.filter(call=>call==='unknown-pending').length,1);assert.equal(f.calls.filter(call=>call.startsWith('pending:')).length,3);assert.equal(f.calls.filter(call=>call.startsWith('publish:')).length,0);
});

test('required-field claiming uses selected destinations and journals before submission without an ERP template',async t=>{
  const f=requiredFixture(t),inspect=f.backend.inspect;let claimed=false;
  f.backend.inspect=async args=>{const result=await inspect(args);return claimed?result:{rows:result.rows.map(row=>({...row,status:'unclaimed',platformEditUrl:null}))};};
  f.options.allocationAdapter={claimDestinations:async args=>{assert.equal(args.allocationSnapshot,undefined);assert.deepEqual(args.destinations.map(item=>item.storeId),['store-one','store-two']);await args.beforeClaim({goodsIds:[...goodsIds],destinations:clone(args.destinations),skipDuplicates:true});const stored=JSON.parse(fs.readFileSync(path.join(f.options.directory,'state.json'),'utf8')).jobs[f.request.requestId];assert.equal(stored.claimIntent.status,'pending');claimed=true;return {status:'claimed',submitted:true};}};
  f.service=createListingWorkflow(f.options);const job=f.service.create(f.request),checked=await run(f.service,job.id,'inspect');assert.ok(checked.availableActions.includes('claim'));const result=await run(f.service,job.id,'claim');assert.equal(result.claimIntent.status,'confirmed');assert.equal(result.totals.located,4);assert.equal(result.allocationSnapshot,undefined);
});

test('required-field SHEIN and TikTok jobs never expose or dispatch the Temu package correction reviewer',async t=>{
  for(const platform of ['shein','tiktok']){
    const f=requiredFixture(t);f.destinations.forEach(store=>{store.platform=platform;store.site='';});
    const inspect=f.backend.inspect;f.backend.inspect=async args=>({rows:(await inspect(args)).rows.map(row=>({...row,site:'',platformEditUrl:row.platformEditUrl.replace('/popTemu/',`/${platform}Product/`)}))});
    let reviews=0;f.backend.reviewCorrections=async()=>{reviews++;throw new Error('Temu reviewer must not receive a different platform');};
    f.backend.prepare=async args=>{await args.beforeSave({url:args.row.platformEditUrl,expectedSnapshot:{url:args.row.platformEditUrl}});f.saved.add(args.row.id);return {saved:true,ready:false,published:false,issues:['待人工核对']};};
    const job=f.service.create(f.request);await run(f.service,job.id,'inspect');await selectRequired(f,job.id);const prepared=await run(f.service,job.id,'prepare');
    assert.ok(prepared.rows.every(row=>row.saveIntent?.status==='confirmed'&&row.saved));assert.ok(!prepared.availableActions.includes('review-corrections'));
    assert.throws(()=>f.service.run(job.id,'review-corrections'),/此平台暂不支持/);assert.equal(reviews,0);
  }
});

function allocationFixture(t){
  const f=fixture(t),inspect=f.backend.inspect,missing=new Set([JSON.stringify([goodsIds[0],'store-two'])]);
  const allocationTemplate={id:'4915',name:'画板',destinations:f.template.storeBindings.map(store=>({platform:'temu',storeName:store.storeName,site:'加拿大'}))};
  f.backend.inspect=async args=>{const result=await inspect(args);return {rows:result.rows.map(row=>missing.has(JSON.stringify([row.goodsId,row.storeBindingKey]))?{...row,platformEditUrl:null,status:'unclaimed'}:row)};};
  const allocator={readTemplates:async()=>({templates:[clone(allocationTemplate)]}),claim:async args=>{
    const ids=args.sourceRows.map(row=>row.goodsId);f.calls.push('claim:'+ids.join(','));
    await args.beforeClaim({templateId:args.allocationSnapshot.id,templateName:args.allocationSnapshot.name,goodsIds:ids,destinations:clone(args.allocationSnapshot.destinations),skipDuplicates:true});
    const state=JSON.parse(fs.readFileSync(path.join(f.options.directory,'state.json'),'utf8')),job=Object.values(state.jobs).find(item=>item.claimIntent?.status==='pending');assert.ok(job,'claim intent must exist before external submission');
    for(const row of job.rows)if(ids.includes(row.goodsId))missing.delete(row.id);
    return {status:'claimed',submitted:true,issues:[],receipt:{success:ids.length*2}};
  }};
  f.options.allocationAdapter=allocator;f.service=createListingWorkflow(f.options);
  return {...f,missing,allocator,allocationTemplate};
}

test('allocation read diagnostics survive restart, redact credentials, and clear on a fresh read',async t=>{
  const f=allocationFixture(t),job=f.service.create(f.request),read=f.allocator.readTemplates;
  f.allocator.readTemplates=async()=>{throw Object.assign(new Error('目录未展开'),{data:{allocationDiagnostics:{stage:'catalog',pageTitle:'Product',labels:['fixture-secret'],password:'private'}}});};
  await assert.rejects(f.service.syncAllocation(job.id,{templateName:'画板'}),/目录未展开/);
  const restored=createListingWorkflow(f.options),diagnostics=restored.get(job.id).allocationDiagnostics;
  assert.equal(diagnostics.stage,'catalog');assert.deepEqual(diagnostics.labels,['[已隐藏]']);assert.equal(diagnostics.password,undefined);
  f.allocator.readTemplates=read;await restored.syncAllocation(job.id,{templateName:'画板'});
  assert.equal(restored.get(job.id).allocationDiagnostics,undefined);assert.equal(restored.get(job.id).error,null);
});

test('pager failure keeps bounded diagnostic evidence without reporting incomplete scanning as success',async t=>{
  const f=fixture(t),job=f.service.create(f.request),inspect=f.backend.inspect;
  f.backend.inspect=async()=>{throw Object.assign(new Error('未翻到目标页'),{data:{pagerDiagnostics:{pagerCount:2,currentPage:1,inputs:[{title:'页数',value:'1'}],secret:'private',note:'fixture-secret'}}});};
  const failed=await run(f.service,job.id,'inspect');
  assert.equal(failed.status,'needs-review');assert.equal(failed.totals.located,0);assert.equal(failed.pagerDiagnostics.currentPage,1);assert.equal(failed.pagerDiagnostics.secret,undefined);assert.equal(failed.pagerDiagnostics.note,'[已隐藏]');
  const restored=createListingWorkflow(f.options);assert.equal(restored.get(job.id).pagerDiagnostics.inputs[0].title,'页数');
  f.backend.inspect=inspect;const recovered=await run(restored,job.id,'reconcile');assert.equal(recovered.pagerDiagnostics,undefined);assert.equal(recovered.totals.located,4);
});

test('row pager failure evidence stays on that inspection, redacts secrets, limits size and survives restart',async t=>{
  const f=fixture(t),job=f.service.create(f.request),inspect=f.backend.inspect;
  f.backend.inspect=async args=>{const result=await inspect(args);result.rows[0]={...result.rows[0],status:'needs-review',issues:['未翻到草稿所在页'],pagerDiagnostics:{currentPage:1,targetPage:2,note:'fixture-secret',password:'private'}};result.rows[1]={...result.rows[1],status:'needs-review',issues:['分页失败'],pagerDiagnostics:{note:'x'.repeat(20000)}};return result;};
  const failed=await run(f.service,job.id,'inspect');assert.equal(failed.totals.located,2);assert.equal(failed.rows[0].locationStatus,'needs-review');assert.equal(failed.rows[0].ready,false);assert.equal(failed.rows[0].platformEditUrl,null);assert.equal(failed.rows[0].inspection.pagerDiagnostics.note,'[已隐藏]');assert.equal(failed.rows[0].inspection.pagerDiagnostics.password,undefined);assert.match(failed.rows[1].inspection.pagerDiagnostics.captureError,/超过大小限制/);assert.equal(failed.pagerDiagnostics,undefined);
  const restored=createListingWorkflow(f.options);assert.equal(restored.get(job.id).rows[0].inspection.pagerDiagnostics.targetPage,2);assert.equal(restored.get(job.id).rows[0].locationStatus,'needs-review');
});

test('creation captures only verified source products and expands immutable template/store snapshots',t=>{
  const f=fixture(t),job=f.service.create(f.request);
  assert.equal(job.rows.length,4);assert.equal(job.totals.products,2);assert.equal(job.totals.stores,2);assert.deepEqual(job.availableActions,['inspect']);
  assert.equal(job.rows[0].collectionEditUrl,f.freeJob.rows[0].evidence.editUrl);assert.equal(job.templateVersion,1);assert.equal(job.templateSnapshot.storeBindings[0].warehouse,'仓库1');
  f.templates.save({...f.template,storeBindings:f.template.storeBindings.map(store=>({...store,warehouse:'新仓库'}))});
  job.templateSnapshot.storeBindings[0].warehouse='改返回对象';
  assert.equal(f.service.get(job.id).templateSnapshot.storeBindings[0].warehouse,'仓库1');
  assert.equal(f.service.get(job.id).binding.erpConnection.expectedAccount,'fixture-account');
});

test('request IDs are idempotent and equivalent requests reuse the persisted task even after restart',t=>{
  const f=fixture(t),one=f.service.create(f.request);
  assert.equal(f.service.create(f.request).id,one.id);
  const duplicate=f.service.create({...f.request,requestId:'another-request',goodsIds:[...goodsIds].reverse(),storeKeys:['store-two','store-one']});
  assert.equal(duplicate.id,one.id);assert.equal(f.service.view().jobs.length,1);
  const restored=createListingWorkflow(f.options);assert.equal(restored.get('another-request').id,one.id);
  assert.throws(()=>restored.create({...f.request,goodsIds:[goodsIds[0]]}),error=>error.status===409);
});

test('unverified, duplicated or mismatched source evidence cannot create a task',t=>{
  const f=fixture(t);
  f.freeJob.rows[0].status='collected';assert.throws(()=>f.service.create(f.request),/尚未唯一核实/);
  f.freeJob.rows[0].status='verified';f.freeJob.rows.push(clone(f.freeJob.rows[0]));assert.throws(()=>f.service.create(f.request),/尚未唯一核实/);
  f.freeJob.rows.pop();f.freeJob.rows[0].evidence.sourceUrl=f.freeJob.rows[1].sourceUrl;assert.throws(()=>f.service.create(f.request),/可靠的来源链接/);
  f.freeJob.rows[0].evidence.sourceUrl=f.freeJob.rows[0].sourceUrl;f.freeJob.rows[0].evidence.editUrl=f.freeJob.rows[1].evidence.editUrl;assert.throws(()=>f.service.create(f.request),/同一条通用采集记录/);
  assert.equal(f.service.view().jobs.length,0);
});

test('incomplete fixed templates allow task creation and inspection but not preparation',async t=>{
  const f=fixture(t,{complete:false}),job=f.service.create(f.request),inspected=await run(f.service,job.id,'inspect');
  assert.equal(inspected.status,'inspected');assert.equal(inspected.totals.located,4);assert.equal(inspected.configurationReadiness.ready,false);
  assert.ok(!inspected.availableActions.includes('prepare'));assert.throws(()=>f.service.run(job.id,'prepare'),/配置尚未完成/);
  assert.equal(f.calls.filter(call=>call.startsWith('prepare:')).length,0);
});

test('account and browser binding changes block task execution before adapter calls',async t=>{
  const f=fixture(t),job=f.service.create(f.request);
  f.erpConnection.expectedAccount='other-account';assert.throws(()=>f.service.run(job.id,'inspect'),/绑定已变化/);assert.deepEqual(f.service.get(job.id).availableActions,[]);
  f.erpConnection.expectedAccount='fixture-account';f.browserConfig.debugPort=9333;assert.throws(()=>f.service.run(job.id,'inspect'),/绑定已变化/);
  assert.equal(f.calls.length,0);f.browserConfig.debugPort=9222;
  const original=f.backend.prepare;f.backend.prepare=async args=>{f.erpConnection.expectedAccount='changed-before-save';return original(args);};
  await run(f.service,job.id,'inspect');const failed=await run(f.service,job.id,'prepare');
  assert.equal(failed.rows[0].saveIntent,undefined);assert.equal(f.saved.size,0);
});

test('inspection distinguishes unclaimed and ambiguous targets without touching other goods or stores',async t=>{
  const f=fixture(t),base=f.backend.inspect,job=f.service.create(f.request);
  f.backend.inspect=async args=>{const result=await base(args);result.rows[0]={...result.rows[0],status:'unclaimed',platformEditUrl:null};result.rows[1]={...result.rows[1],status:'ambiguous',platformEditUrl:null,issues:['有两个候选记录']};return result;};
  const result=await run(f.service,job.id,'inspect');
  assert.equal(result.totals.unclaimed,1);assert.equal(result.totals.ambiguous,1);assert.equal(result.totals.located,2);assert.ok(!result.availableActions.includes('prepare'));
  assert.equal(result.rows[0].status,'unclaimed');assert.equal(result.rows[1].status,'ambiguous');
});

test('adapter results cannot expand task scope or map different products to one draft',async t=>{
  const f=fixture(t),job=f.service.create(f.request),base=f.backend.inspect;
  f.backend.inspect=async args=>{const result=await base(args);result.rows.push({...result.rows[0],goodsId:'601234567899999'});return result;};
  let result=await run(f.service,job.id,'inspect');assert.match(result.message,/无关或重复/);assert.equal(result.rows.length,4);assert.equal(result.totals.located,0);
  f.backend.inspect=async args=>{const result=await base(args);result.rows[1].platformEditUrl=result.rows[0].platformEditUrl;return result;};
  result=await run(f.service,job.id,'inspect');assert.match(result.message,/同一个平台草稿/);assert.equal(result.totals.located,0);
});

test('save intent is on disk before every write, fixed template is reused and no publish action is advertised without adapter support',async t=>{
  const f=fixture(t),job=f.service.create(f.request),base=f.backend.prepare;
  f.backend.prepare=async args=>{assert.equal(args.templateSnapshot.version,1);const result=await base(args);const persisted=JSON.parse(fs.readFileSync(path.join(f.options.directory,'state.json'),'utf8')).jobs[job.id].rows.find(row=>row.id===args.row.id);assert.equal(persisted.saveIntent.status,'pending');assert.equal(persisted.saveIntent.payload.before.empty,'');return result;};
  await run(f.service,job.id,'inspect');const result=await run(f.service,job.id,'prepare');
  assert.equal(result.status,'prepared');assert.equal(result.totals.prepared,4);assert.ok(result.rows.every(row=>row.saveIntent.status==='confirmed'));
  assert.ok(!result.availableActions.includes('publish'));assert.ok(!result.availableActions.includes('prepare'));
  assert.throws(()=>f.service.run(job.id,'publish'),/发布执行尚未接通/);assert.equal(f.calls.filter(call=>call.startsWith('prepare:')).length,4);
});

test('uncertain save pauses later products, survives restart and permits read-only reconciliation without another save',async t=>{
  const f=fixture(t),job=f.service.create(f.request);
  f.backend.prepare=async args=>{await args.beforeSave({url:args.row.platformEditUrl});f.saved.add(args.row.id);f.calls.push('save-once');throw new Error('timeout fixture-secret');};
  await run(f.service,job.id,'inspect');const uncertain=await run(f.service,job.id,'prepare');
  assert.equal(uncertain.rows[0].saveIntent.status,'unknown');assert.deepEqual(uncertain.availableActions,['reconcile']);assert.ok(!JSON.stringify(uncertain).includes('fixture-secret'));
  assert.equal(f.calls.filter(call=>call==='save-once').length,1);assert.throws(()=>f.service.run(job.id,'prepare'),/先只读核对/);
  const restored=createListingWorkflow(f.options),recovered=await run(restored,job.id,'reconcile');
  assert.equal(recovered.rows[0].saveIntent.status,'confirmed');assert.equal(recovered.rows[0].status,'prepared');assert.equal(f.calls.filter(call=>call==='save-once').length,1);
  assert.equal(recovered.totals.prepared,1);assert.ok(recovered.availableActions.includes('prepare'));
});

test('a missing save-intent hook cannot be presented as a successful save',async t=>{
  const f=fixture(t),job=f.service.create(f.request);
  f.backend.prepare=async()=>({saved:true,ready:true,issues:[],published:false});
  await run(f.service,job.id,'inspect');const result=await run(f.service,job.id,'prepare');
  assert.equal(result.totals.prepared,0);assert.equal(result.rows[0].saveIntent.protocolViolation,'missing-beforeSave');assert.equal(result.rows[0].saveIntent.status,'unknown');
  assert.deepEqual(result.availableActions,['reconcile']);assert.ok(result.rows.every(row=>row.saved===false));
});

test('new template versions cannot replay an unresolved write against the same target draft',async t=>{
  const f=fixture(t),old=f.service.create(f.request);
  f.backend.prepare=async args=>{await args.beforeSave({url:args.row.platformEditUrl});f.calls.push('unknown-save');throw new Error('unknown');};
  await run(f.service,old.id,'inspect');await run(f.service,old.id,'prepare');
  const updated=f.templates.save({...f.template,notes:'新版模板'}),fresh=f.service.create({...f.request,requestId:'listing-version-two',templateVersion:updated.version});
  assert.notEqual(fresh.id,old.id);await run(f.service,fresh.id,'inspect');const result=await run(f.service,fresh.id,'prepare');
  assert.match(result.rows[0].issues.join(),/相同商品提交结果尚未核对/);assert.equal(result.rows[0].saveIntent,undefined);
  assert.equal(f.service.get(old.id).rows[0].saveIntent.status,'unknown');
  // The new task may process a different untouched row, but never the old unknown draft.
  assert.equal(f.calls.filter(call=>call==='unknown-save').length,2);
});

test('publication is offered only after every selected target is ready and its intent is recorded before submission',async t=>{
  const f=fixture(t,{publish:true}),job=f.service.create(f.request),base=f.backend.publish;
  assert.ok(!job.availableActions.includes('publish'));await run(f.service,job.id,'inspect');let prepared=await run(f.service,job.id,'prepare');assert.ok(prepared.availableActions.includes('publish'));
  f.backend.publish=async args=>{const result=await base(args);const persisted=JSON.parse(fs.readFileSync(path.join(f.options.directory,'state.json'),'utf8')).jobs[job.id].rows.find(row=>row.id===args.row.id);assert.equal(persisted.publishIntent.status,'pending');return result;};
  const result=await run(f.service,job.id,'publish');assert.equal(result.status,'completed');assert.equal(result.totals.published,4);assert.ok(!result.availableActions.includes('publish'));
  assert.ok(result.rows.every(row=>row.publishIntent.status==='confirmed'));assert.equal(f.calls.filter(call=>call.startsWith('publish:')).length,4);
});

test('accepted publication continues the remaining targets and is reconciled without resubmission',async t=>{
  const f=fixture(t,{publish:true}),job=f.service.create(f.request);
  await run(f.service,job.id,'inspect');await run(f.service,job.id,'prepare');
  f.backend.publish=async args=>{await args.beforePublish({url:args.row.platformEditUrl});f.calls.push('publish-accepted');return {submitted:true,published:false};};
  const result=await run(f.service,job.id,'publish');assert.equal(result.rows[0].publishIntent.status,'accepted');assert.equal(result.rows[0].published,false);assert.deepEqual(result.availableActions,['reconcile']);
  assert.equal(f.calls.filter(call=>call==='publish-accepted').length,4);assert.throws(()=>f.service.run(job.id,'publish'),/当前商品状态/);assert.equal(result.status,'submitted');assert.equal(result.totals.submitted,4);assert.equal(result.totals.published,0);
  await run(f.service,job.id,'reconcile');assert.equal(f.calls.filter(call=>call==='publish-accepted').length,4);assert.equal(f.service.get(job.id).rows[0].publishIntent.status,'accepted');
});

test('stop prevents the next product and busy execution rejects concurrent actions',async t=>{
  const f=fixture(t),job=f.service.create(f.request),base=f.backend.prepare;let release,entered;
  const started=new Promise(resolve=>{entered=resolve;});
  f.backend.prepare=async args=>{entered();await new Promise(resolve=>{release=resolve;});return base(args);};
  await run(f.service,job.id,'inspect');f.service.run(job.id,'prepare');await started;
  assert.throws(()=>f.service.run(job.id,'inspect'),/有任务正在运行/);assert.deepEqual(f.service.get(job.id).availableActions,['stop']);
  f.service.stop(job.id);release();await idle(f.service);
  assert.equal(f.saved.size,0);assert.equal(f.service.get(job.id).status,'paused');assert.ok(f.service.get(job.id).rows.every(row=>!row.saveIntent));
  f.setOtherBusy(true);assert.throws(()=>f.service.run(job.id,'inspect'),/有任务正在运行/);
});

test('restart recovers pending intent as unknown and requires reconciliation even for previously completed preparation',async t=>{
  const f=fixture(t),job=f.service.create(f.request);await run(f.service,job.id,'inspect');await run(f.service,job.id,'prepare');
  let restored=createListingWorkflow(f.options);assert.deepEqual(restored.get(job.id).availableActions,['reconcile']);
  const file=path.join(f.options.directory,'state.json'),state=JSON.parse(fs.readFileSync(file,'utf8'));state.jobs[job.id].rows[0].saveIntent.status='pending';state.jobs[job.id].status='running';fs.writeFileSync(file,JSON.stringify(state));
  restored=createListingWorkflow(f.options);assert.equal(restored.get(job.id).rows[0].saveIntent.status,'unknown');assert.ok(restored.get(job.id).rows[0].saveIntent.interruptedAt);
  assert.equal(f.calls.filter(call=>call.startsWith('prepare:')).length,4);
});

test('failed read-only reconciliation after restart does not reopen saving or publishing',async t=>{
  const f=fixture(t),job=f.service.create(f.request);await run(f.service,job.id,'inspect');
  const restored=createListingWorkflow(f.options);f.backend.inspect=async()=>{throw new Error('无法读取当前页面');};
  const result=await run(restored,job.id,'reconcile');assert.equal(result.needsReconcile,true);assert.deepEqual(result.availableActions,['reconcile']);
  assert.throws(()=>restored.run(job.id,'prepare'),/先只读核对/);
});

test('explicit candidate selection is persisted but must be rechecked before preparation',async t=>{
  const f=fixture(t),job=f.service.create(f.request),base=f.backend.inspect,draftId='220114595121499999';
  const candidate={draftId,platformEditUrl:`https://www.dianxiaomi.com/web/popTemu/edit?id=${draftId}`,site:'加拿大',editorUrlObserved:false};
  f.backend.inspect=async args=>{
    const result=await base(args),row=result.rows[0],choice=args.resolvedTargets.find(target=>target.goodsId===row.goodsId&&target.storeBindingKey===row.storeBindingKey);
    if(choice){assert.equal(choice.draftId,draftId);result.rows[0]={...row,...candidate,status:'located'};}
    else result.rows[0]={...row,status:'ambiguous',platformEditUrl:null,candidates:[candidate],issues:['多个候选']};
    return result;
  };
  await run(f.service,job.id,'inspect');const selected=f.service.resolve(job.id,{goodsId:goodsIds[0],storeBindingKey:'store-one',draftId});
  assert.equal(selected.rows[0].resolvedTarget.draftId,draftId);assert.equal(selected.rows[0].resolvedTarget.editorUrlObserved,false);assert.equal(selected.rows[0].locationStatus,'pending');assert.equal(selected.rows[0].platformEditUrl,null);assert.ok(!selected.availableActions.includes('prepare'));
  assert.equal(selected.rows[0].saveIntent,undefined);assert.equal(f.calls.filter(call=>call.startsWith('prepare:')).length,0);
  const restored=createListingWorkflow(f.options);assert.equal(restored.get(job.id).rows[0].resolvedTarget.draftId,draftId);
  const result=await run(restored,job.id,'reconcile');assert.equal(result.rows[0].locationStatus,'located');assert.equal(result.rows[0].platformEditUrl,candidate.platformEditUrl);
  assert.equal(result.rows[0].draftId,draftId);assert.ok(result.availableActions.includes('prepare'));
  assert.equal(restored.resolve(job.id,{goodsId:goodsIds[0],storeBindingKey:'store-one',draftId}).rows[0].resolvedTarget.selectedAt,selected.rows[0].resolvedTarget.selectedAt);
});

test('candidate resolution refuses arbitrary IDs, URLs, other stores and malformed observed candidates',async t=>{
  const f=fixture(t),job=f.service.create(f.request),base=f.backend.inspect,draftId='220114595121499998';
  let candidate={draftId,platformEditUrl:`https://www.dianxiaomi.com/web/popTemu/edit?id=${draftId}`};
  f.backend.inspect=async args=>{const result=await base(args);result.rows[0]={...result.rows[0],status:'ambiguous',platformEditUrl:null,candidates:[clone(candidate)]};return result;};
  await run(f.service,job.id,'inspect');
  const selection={goodsId:goodsIds[0],storeBindingKey:'store-one',draftId};
  assert.throws(()=>f.service.resolve(job.id,{...selection,draftId:'220114595121490000'}),/候选商品不存在/);
  assert.throws(()=>f.service.resolve(job.id,{...selection,platformEditUrl:'https://malicious.example/edit'}),/现场候选商品编号|核对返回的候选商品编号/);
  assert.throws(()=>f.service.resolve(job.id,{...selection,storeBindingKey:'another-store'}),/不属于本次任务/);
  candidate={draftId,platformEditUrl:'https://malicious.example/edit?id='+draftId};await run(f.service,job.id,'inspect');assert.throws(()=>f.service.resolve(job.id,selection),/编辑地址未通过/);
  candidate={draftId,platformEditUrl:`https://www.dianxiaomi.com/web/popTemu/edit?id=${draftId}`,storeName:'别人的店'};await run(f.service,job.id,'inspect');assert.throws(()=>f.service.resolve(job.id,selection),/来源、店铺或站点/);
  assert.equal(f.service.get(job.id).rows[0].resolvedTarget,undefined);
});

test('a new inspection cannot substitute another draft for an explicitly selected candidate',async t=>{
  const f=fixture(t),job=f.service.create(f.request),base=f.backend.inspect,draftId='220114595121499997';let selected=false;
  f.backend.inspect=async args=>{const result=await base(args);if(!selected)result.rows[0]={...result.rows[0],status:'ambiguous',platformEditUrl:null,candidates:[{draftId,platformEditUrl:`https://www.dianxiaomi.com/web/popTemu/edit?id=${draftId}`}]};return result;};
  await run(f.service,job.id,'inspect');f.service.resolve(job.id,{goodsId:goodsIds[0],storeBindingKey:'store-one',draftId});selected=true;
  const result=await run(f.service,job.id,'inspect');assert.match(result.message,/不能替换已明确选定/);assert.equal(result.rows[0].locationStatus,'pending');assert.equal(result.rows[0].resolvedTarget.draftId,draftId);assert.ok(!result.availableActions.includes('prepare'));
});

test('allocation selection is separate from the listing template and claims only sources with a missing destination',async t=>{
  const f=allocationFixture(t),job=f.service.create(f.request);await run(f.service,job.id,'inspect');
  assert.throws(()=>f.service.run(job.id,'claim'),/认领分配模板/);
  const synced=await f.service.syncAllocation(job.id);assert.equal(synced.allocationCatalog.templates[0].name,'画板');
  const selected=f.service.selectAllocation(job.id,{templateId:'4915'});assert.equal(selected.allocationSnapshot.id,'4915');assert.equal(selected.templateSnapshot.id,f.template.id);assert.ok(selected.availableActions.includes('claim'));
  const result=await run(f.service,job.id,'claim');assert.equal(result.claimIntent.status,'confirmed');assert.deepEqual(result.claimIntent.goodsIds,[goodsIds[0]]);assert.equal(result.totals.located,4);assert.ok(!result.availableActions.includes('claim'));
  assert.equal(f.calls.filter(call=>call.startsWith('claim:')).length,1);assert.equal(f.calls.find(call=>call.startsWith('claim:')),'claim:'+goodsIds[0]);
  assert.equal(result.claimIntent.payload.skipDuplicates,true);assert.equal(result.claimIntent.confirmedRows.length,2);
  assert.throws(()=>f.service.selectAllocation(job.id,{templateId:'4915'}),/已有认领提交记录/);
});

test('allocation destinations must exactly cover the selected task stores and all-located tasks never re-claim',async t=>{
  const f=allocationFixture(t),job=f.service.create(f.request);
  f.allocationTemplate.destinations.push({platform:'tiktok',storeName:'任务外店铺',site:'日本'});
  await f.service.syncAllocation(job.id);assert.throws(()=>f.service.selectAllocation(job.id,{templateId:'4915'}),/必须与本任务所选上架店铺一致/);
  f.allocationTemplate.destinations.pop();await f.service.syncAllocation(job.id,{templateName:'画板'});f.service.selectAllocation(job.id,{templateId:'4915'});
  f.missing.clear();const result=await run(f.service,job.id,'inspect');assert.ok(!result.availableActions.includes('claim'));assert.throws(()=>f.service.run(job.id,'claim'),/当前商品状态/);
  assert.equal(f.calls.filter(call=>call.startsWith('claim:')).length,0);
});

test('allocation pre-submit hook enforces the exact source set, destination set and skip-duplicate option',async t=>{
  const f=allocationFixture(t),job=f.service.create(f.request);await run(f.service,job.id,'inspect');await f.service.syncAllocation(job.id);f.service.selectAllocation(job.id,{templateId:'4915'});
  f.allocator.claim=async args=>{await args.beforeClaim({templateId:'4915',templateName:'画板',goodsIds:[goodsIds[0]],destinations:args.allocationSnapshot.destinations,skipDuplicates:false});throw new Error('must not reach external submission');};
  const result=await run(f.service,job.id,'claim');assert.equal(result.claimIntent,undefined);assert.match(result.message,/重复跳过设置不一致/);
  assert.equal(f.calls.filter(call=>call.startsWith('claim:')).length,0);
});

test('unknown allocation submission survives restart and reconciliation confirms targets without replay',async t=>{
  const f=allocationFixture(t),job=f.service.create(f.request),claim=f.allocator.claim;
  await run(f.service,job.id,'inspect');await f.service.syncAllocation(job.id);f.service.selectAllocation(job.id,{templateId:'4915'});
  f.allocator.claim=async args=>{await claim(args);throw new Error('connection lost after claim');};
  const result=await run(f.service,job.id,'claim');assert.equal(result.claimIntent.status,'unknown');assert.deepEqual(result.availableActions,['reconcile']);assert.throws(()=>f.service.run(job.id,'claim'),/先只读核对/);
  const restored=createListingWorkflow(f.options),checked=await run(restored,job.id,'reconcile');assert.equal(checked.claimIntent.status,'confirmed');assert.equal(checked.totals.located,4);assert.equal(f.calls.filter(call=>call.startsWith('claim:')).length,1);
  assert.equal(checked.allocationSnapshot.name,'画板');assert.ok(checked.availableActions.includes('prepare'));
});

test('new-version tasks cannot repeat an unresolved allocation submission from another task',async t=>{
  const f=allocationFixture(t),job=f.service.create(f.request);
  await run(f.service,job.id,'inspect');await f.service.syncAllocation(job.id);f.service.selectAllocation(job.id,{templateId:'4915'});
  f.allocator.claim=async args=>{await args.beforeClaim({templateId:'4915',templateName:'画板',goodsIds:args.sourceRows.map(row=>row.goodsId),destinations:args.allocationSnapshot.destinations,skipDuplicates:true});f.calls.push('unknown-claim');throw new Error('unknown allocation');};
  await run(f.service,job.id,'claim');
  const updated=f.templates.save({...f.template,notes:'new version'}),newJob=f.service.create({...f.request,requestId:'new-allocation-task',templateVersion:updated.version});
  await run(f.service,newJob.id,'inspect');await f.service.syncAllocation(newJob.id);f.service.selectAllocation(newJob.id,{templateId:'4915'});
  const result=await run(f.service,newJob.id,'claim');assert.match(result.message,/相同商品仍有未决提交/);assert.equal(result.claimIntent,undefined);assert.equal(f.calls.filter(call=>call==='unknown-claim').length,1);
});

const movementPayload=args=>({draftId:args.row.draftId,goodsId:args.row.goodsId,storeBindingKey:args.row.storeBindingKey,url:args.row.platformEditUrl,sourceUrl:args.row.sourceUrl,from:'collection',to:'pending-publication'});
async function preparedFixture(t){
  const f=fixture(t,{publish:true}),job=f.service.create({...f.request,goodsIds:[goodsIds[0]],storeKeys:['store-one']});
  await run(f.service,job.id,'inspect');await run(f.service,job.id,'prepare');return {...f,job};
}

test('unknown collection-to-pending movement is journaled and resumes publication only after read-only confirmation',async t=>{
  const f=await preparedFixture(t),{job}=f;let moves=0,publishes=0,verifies=0;
  f.backend.publish=async args=>{
    await args.beforeMoveToPending(movementPayload(args));
    const row=JSON.parse(fs.readFileSync(path.join(f.options.directory,'state.json'),'utf8')).jobs[job.id].rows[0];
    assert.equal(row.moveIntent.status,'pending');assert.equal(row.publishIntent,undefined);moves++;
    throw new Error('connection lost after moving');
  };
  const pending=await run(f.service,job.id,'publish');assert.equal(pending.rows[0].moveIntent.status,'unknown');assert.equal(pending.rows[0].publishIntent,undefined);assert.deepEqual(pending.availableActions,['reconcile']);
  f.backend.verifyPublication=async args=>{verifies++;assert.equal(args.row.moveIntent.status,'unknown');assert.equal(args.beforePublish,undefined);return {publicationStatus:'draft',movedToPending:true,publicationNotSubmitted:true,ready:true,saved:true,published:false,readOnly:true,issues:[],platformEditUrl:args.row.platformEditUrl};};
  f.backend.inspect=async()=>{throw new Error('moved drafts must not be searched in collection');};
  const restored=createListingWorkflow(f.options),recovered=await run(restored,job.id,'reconcile');
  assert.equal(recovered.rows[0].moveIntent.status,'confirmed');assert.equal(recovered.rows[0].publishIntent,undefined);assert.ok(recovered.availableActions.includes('publish'));assert.equal(recovered.rows[0].publicationStatus,'draft');
  f.backend.publish=async args=>{assert.equal(args.row.moveIntent.status,'confirmed');await args.beforePublish({url:args.row.platformEditUrl,draftId:args.row.draftId});publishes++;return {publicationStatus:'online',published:true,movedToPending:true,issues:[]};};
  const result=await run(restored,job.id,'publish');assert.equal(result.status,'completed');assert.equal(result.rows[0].published,true);assert.equal(moves,1);assert.equal(publishes,1);assert.equal(verifies,1);
});

test('unknown movement never repeats and blocks another template version against the same draft',async t=>{
  const f=await preparedFixture(t),{job}=f;let moves=0;
  f.backend.publish=async args=>{await args.beforeMoveToPending(movementPayload(args));moves++;return {publicationStatus:'unknown',movedToPending:false,publicationNotSubmitted:true,issues:['moving receipt unavailable']};};
  await run(f.service,job.id,'publish');
  f.backend.verifyPublication=async()=>({publicationStatus:'unknown',movedToPending:false,publicationNotSubmitted:true,readOnly:true,issues:['still unknown']});
  const checked=await run(f.service,job.id,'reconcile');assert.equal(checked.rows[0].moveIntent.status,'unknown');assert.equal(checked.rows[0].publishIntent,undefined);assert.deepEqual(checked.availableActions,['reconcile']);assert.throws(()=>f.service.run(job.id,'publish'),/先只读核对/);
  const updated=f.templates.save({...f.template,notes:'second version'}),fresh=f.service.create({...f.request,goodsIds:[goodsIds[0]],storeKeys:['store-one'],requestId:'unknown-move-new-version',templateVersion:updated.version});
  await run(f.service,fresh.id,'inspect');const blocked=await run(f.service,fresh.id,'prepare');assert.match(blocked.rows[0].issues.join(),/相同商品提交结果尚未核对/);assert.equal(blocked.rows[0].saveIntent,undefined);assert.equal(moves,1);
});

test('movement hooks validate exact draft identity and cannot commit a different product',async t=>{
  const f=await preparedFixture(t),{job}=f;
  f.backend.publish=async args=>{await args.beforeMoveToPending({...movementPayload(args),draftId:'220114595121499999'});throw new Error('must not write');};
  const result=await run(f.service,job.id,'publish');assert.equal(result.rows[0].moveIntent,undefined);assert.equal(result.rows[0].publishIntent,undefined);assert.match(result.rows[0].issues.join(),/草稿、来源或店铺/);
});

test('a confirmed move without publication can recover only with freshly ready saved data',async t=>{
  const f=await preparedFixture(t),{job}=f;
  f.backend.publish=async args=>{await args.beforeMoveToPending(movementPayload(args));await args.onMovedToPending({draftId:args.row.draftId,movedToPending:true,publicationStatus:'draft'});return {publicationStatus:'unknown',movedToPending:true,publicationNotSubmitted:true,issues:['menu unavailable']};};
  await run(f.service,job.id,'publish');
  f.backend.verifyPublication=async()=>({publicationStatus:'draft',movedToPending:true,publicationNotSubmitted:true,readOnly:true,saved:true,ready:false,issues:['snapshot changed']});
  const blocked=await run(f.service,job.id,'reconcile');assert.equal(blocked.rows[0].moveIntent.status,'confirmed');assert.equal(blocked.rows[0].publishIntent,undefined);assert.ok(!blocked.availableActions.includes('publish'));
});

test('publication readback preserves submitted, listed, reviewing and online as different outcomes without replay',async t=>{
  const f=await preparedFixture(t),{job}=f;let publishes=0,status='submitted';
  f.backend.publish=async args=>{await args.beforePublish({url:args.row.platformEditUrl});publishes++;return {publicationStatus:'submitted',submitted:true,published:false,issues:[]};};
  f.backend.verifyPublication=async()=>({publicationStatus:status,movedToPending:true,readOnly:true,submitted:true,published:status==='online',issues:[]});
  await run(f.service,job.id,'publish');
  for(status of ['listed','reviewing','pending-launch','submitted']){const result=await run(f.service,job.id,'reconcile');assert.equal(result.rows[0].publicationStatus,status);assert.equal(result.rows[0].published,false);assert.equal(result.rows[0].publishIntent.status,'accepted');assert.deepEqual(result.availableActions,['reconcile']);}
  status='online';const final=await run(f.service,job.id,'reconcile');assert.equal(final.rows[0].publicationStatus,'online');assert.equal(final.rows[0].published,true);assert.equal(final.rows[0].publishIntent.status,'confirmed');assert.equal(final.status,'completed');assert.equal(publishes,1);
});

test('a read-only preflight finding of an existing listing is recorded without inventing a new publish submission',async t=>{
  const f=await preparedFixture(t),{job}=f;
  f.backend.publish=async()=>({publicationStatus:'listed',submitted:true,published:false,readOnly:true,issues:[]});
  const result=await run(f.service,job.id,'publish');assert.equal(result.rows[0].publishIntent,undefined);assert.equal(result.rows[0].publicationStatus,'listed');assert.equal(result.rows[0].published,false);assert.deepEqual(result.availableActions,['reconcile']);
});

test('restarting an accepted partial queue offers readback and then publishes only the remaining targets',async t=>{
  const f=fixture(t,{publish:true}),job=f.service.create(f.request),counts=new Map();
  await run(f.service,job.id,'inspect');await run(f.service,job.id,'prepare');
  f.backend.publish=async args=>{await args.beforePublish({url:args.row.platformEditUrl});counts.set(args.row.id,(counts.get(args.row.id)||0)+1);if(counts.size===1)f.service.stop(job.id);return {publicationStatus:'submitted',submitted:true,published:false,issues:[]};};
  const first=await run(f.service,job.id,'publish');assert.equal(first.totals.submitted,1);assert.equal(first.totals.prepared,3);assert.ok(first.availableActions.includes('reconcile'));assert.ok(first.availableActions.includes('publish'));
  f.backend.verifyPublication=async args=>({publicationStatus:'reviewing',submitted:true,readOnly:true,published:false,issues:[],platformEditUrl:args.row.platformEditUrl});
  const restored=createListingWorkflow(f.options);assert.deepEqual(restored.get(job.id).availableActions,['reconcile']);const checked=await run(restored,job.id,'reconcile');assert.ok(checked.availableActions.includes('publish'));assert.ok(checked.availableActions.includes('reconcile'));assert.equal(checked.totals.prepared,3);
  const result=await run(restored,job.id,'publish');assert.equal(result.status,'submitted');assert.equal(result.totals.submitted,4);assert.equal(result.totals.published,0);assert.equal(counts.size,4);assert.ok([...counts.values()].every(count=>count===1));assert.ok(!result.availableActions.includes('publish'));
});

test('a failed or unknown publication stops later targets even after an earlier accepted receipt',async t=>{
  const f=fixture(t,{publish:true}),job=f.service.create(f.request);let writes=0;
  await run(f.service,job.id,'inspect');await run(f.service,job.id,'prepare');
  f.backend.publish=async args=>{await args.beforePublish({url:args.row.platformEditUrl});writes++;return writes===1?{publicationStatus:'submitted',submitted:true,issues:[]}:{publicationStatus:'failed',error:'invalid price',issues:[]};};
  const result=await run(f.service,job.id,'publish');assert.equal(writes,2);assert.equal(result.rows[0].publishIntent.status,'accepted');assert.equal(result.rows[1].publicationStatus,'failed');assert.equal(result.rows[2].publishIntent,undefined);assert.equal(result.rows[3].publishIntent,undefined);assert.deepEqual(result.availableActions,['reconcile']);
});

test('adapter progress persists without promoting partial matches into final row results',async t=>{
  const f=fixture(t),job=f.service.create(f.request),original=f.backend.inspect;let entered,release;
  const started=new Promise(resolve=>{entered=resolve;});
  f.backend.inspect=async args=>{
    await args.onProgress({phase:'scan',stage:'page',page:2,scanned:100,total:138,message:'正在扫描第2页'});
    await args.onProgress({phase:'match',stage:'matched',targets:4,matched:3,counts:{sources:2,stores:2,candidates:5,located:3,ambiguous:1,unclaimed:0,needsReview:0}});
    await args.onProgress({phase:'inspect',stage:'row-complete',rowIndex:1,rowCount:4,targets:4,inspected:1,goodsId:goodsIds[0],storeBindingKey:'store-one',result:{status:'located',draftId:'220114595121490000',platformEditUrl:'https://www.dianxiaomi.com/web/popTemu/edit?id=220114595121490000',issues:[],candidateCount:1},message:'已核对1/4个目标'});
    entered();await new Promise(resolve=>{release=resolve;});return original(args);
  };
  f.service.run(job.id,'inspect');await started;
  const current=f.service.get(job.id),disk=JSON.parse(fs.readFileSync(path.join(f.options.directory,'state.json'),'utf8')).jobs[job.id];
  assert.equal(current.message,'已核对1/4个目标');assert.equal(current.progress.active,true);assert.equal(current.progress.inspected,1);assert.equal(disk.progress.result.status,'located');assert.equal(current.totals.located,0);assert.ok(current.rows.every(row=>row.locationStatus==='pending'&&row.platformEditUrl===null));assert.deepEqual(current.availableActions,['stop']);
  release();await idle(f.service);const done=f.service.get(job.id);assert.equal(done.progress.active,false);assert.ok(done.progress.finishedAt);assert.equal(done.totals.located,4);
});

test('next row progress retains a bounded redacted lastCompleted summary without committing partial rows',async t=>{
  const f=fixture(t),job=f.service.create(f.request),original=f.backend.inspect;let entered,release;
  const started=new Promise(resolve=>{entered=resolve;});
  f.backend.inspect=async args=>{
    await args.onProgress({phase:'inspect',stage:'row-complete',rowIndex:1,rowCount:4,inspected:1,goodsId:goodsIds[0],storeBindingKey:'store-one',result:{status:'needs-review',draftId:'220114595121490000',platformEditUrl:'https://www.dianxiaomi.com/web/popTemu/edit?id=220114595121490000',account:'private',snapshot:{title:'private'},issueCount:25,issues:Array.from({length:25},()=>('fixture-secret fixture-account https://example.com/private '+'x'.repeat(400)))}});
    await args.onProgress({phase:'inspect',stage:'row-start',rowIndex:2,rowCount:4,inspected:1,goodsId:goodsIds[0],storeBindingKey:'store-two',message:'正在核对2/4'});
    entered();await new Promise(resolve=>{release=resolve;});return original(args);
  };
  f.service.run(job.id,'inspect');await started;
  const current=f.service.get(job.id),disk=JSON.parse(fs.readFileSync(path.join(f.options.directory,'state.json'),'utf8')).jobs[job.id],last=current.progress.lastCompleted;
  assert.equal(current.progress.rowIndex,2);assert.equal(current.progress.stage,'row-start');assert.equal(current.progress.result,undefined);assert.equal(last.rowIndex,1);assert.equal(last.storeBindingKey,'store-one');assert.equal(last.result.issueCount,25);assert.equal(last.result.issues.length,10);assert.ok(last.result.issues.every(issue=>issue.length<=300));assert.equal(last.result.platformEditUrl,undefined);assert.equal(last.result.account,undefined);assert.equal(last.result.snapshot,undefined);
  const text=JSON.stringify(last);assert.ok(!text.includes('fixture-secret'));assert.ok(!text.includes('fixture-account'));assert.ok(!text.includes('https://'));assert.deepEqual(disk.progress.lastCompleted,last);assert.equal(current.totals.located,0);assert.ok(current.rows.every(row=>row.locationStatus==='pending'));
  release();await idle(f.service);const restored=createListingWorkflow(f.options);assert.deepEqual(restored.get(job.id).progress.lastCompleted,last);
});

test('a proven preflight failure without movement or publication intent can recover after preparation readback',async t=>{
  const f=await preparedFixture(t),{job}=f;let attempts=0;
  f.backend.publish=async args=>{attempts++;if(attempts===1)return {publicationStatus:'unknown',publicationNotSubmitted:true,moveAttempted:false,issues:['publication menu unavailable']};await args.beforePublish({url:args.row.platformEditUrl});return {publicationStatus:'submitted',submitted:true,issues:[]};};
  const blocked=await run(f.service,job.id,'publish');assert.equal(blocked.rows[0].publicationPreflightBlocked,true);assert.equal(blocked.rows[0].moveIntent,undefined);assert.equal(blocked.rows[0].publishIntent,undefined);assert.ok(!blocked.availableActions.includes('publish'));
  f.backend.verifyPublication=async()=>{throw new Error('no external intent exists to reconcile');};
  const checked=await run(f.service,job.id,'reconcile');assert.ok(checked.availableActions.includes('publish'));assert.equal(checked.rows[0].publicationStatus,undefined);
  const result=await run(f.service,job.id,'publish');assert.equal(result.rows[0].publishIntent.status,'accepted');assert.equal(result.status,'submitted');assert.equal(attempts,2);assert.equal(f.calls.filter(value=>value.startsWith('prepare:')).length,1);
});

test('reconciliation of untouched drafts keeps observed missing fields and never invokes save verification',async t=>{
  const f=fixture(t),job=f.service.create(f.request),inspect=f.backend.inspect;let verifications=0;
  const issues=['缺少产品分类','缺少运费模板'],snapshot={items:[{label:'产品分类',selections:[]},{label:'运费模板',selections:[]}]};
  f.backend.inspect=async args=>{const result=await inspect(args);result.rows[0]={...result.rows[0],issues:clone(issues),snapshot:clone(snapshot)};result.rows[1]={...result.rows[1],status:'ambiguous',platformEditUrl:null,issues:['存在多个候选'],candidates:[{draftId:'220114595121490010',platformEditUrl:'https://www.dianxiaomi.com/web/popTemu/edit?id=220114595121490010'}]};return result;};
  f.backend.verify=async()=>{verifications++;throw new Error('缺少与本商品及店铺一致的保存前快照，未推定保存成功');};
  await run(f.service,job.id,'inspect');const restored=createListingWorkflow(f.options),result=await run(restored,job.id,'reconcile');
  assert.equal(verifications,0);assert.equal(f.calls.filter(call=>call==='inspect').length,2);assert.deepEqual(result.rows[0].issues,issues);assert.deepEqual(result.rows[0].inspection.snapshot,snapshot);assert.equal(result.rows[0].saveIntent,undefined);assert.equal(result.rows[0].reconciliation,undefined);assert.equal(result.rows[0].saved,false);assert.equal(result.rows[0].ready,false);assert.equal(result.rows[1].inspection.candidates.length,1);assert.equal(result.rows[1].locationStatus,'ambiguous');assert.equal(result.needsReconcile,false);
});

test('mixed reconciliation verifies only rows with a save attempt and preserves untouched inspection issues',async t=>{
  const f=fixture(t),job=f.service.create(f.request),inspect=f.backend.inspect;let verifications=0;
  f.backend.prepare=async args=>{await args.beforeSave({url:args.row.platformEditUrl});f.saved.add(args.row.id);throw new Error('save receipt lost');};
  await run(f.service,job.id,'inspect');await run(f.service,job.id,'prepare');
  f.backend.inspect=async args=>{const result=await inspect(args);result.rows[1].issues=['缺少仓库'];return result;};
  const verify=f.backend.verify;f.backend.verify=async args=>{verifications++;assert.ok(args.row.saveIntent);return verify(args);};
  const result=await run(f.service,job.id,'reconcile');assert.equal(verifications,1);assert.equal(result.rows[0].saveIntent.status,'confirmed');assert.equal(result.rows[0].ready,true);assert.deepEqual(result.rows[1].issues,['缺少仓库']);assert.equal(result.rows[1].reconciliation,undefined);
});

test('mixed recovery cannot rebind or block a moved draft when collection inspection finds another candidate',async t=>{
  const f=fixture(t,{publish:true}),job=f.service.create(f.request),originalInspect=f.backend.inspect;
  await run(f.service,job.id,'inspect');
  const file=path.join(f.options.directory,'state.json'),disk=JSON.parse(fs.readFileSync(file,'utf8')),row=disk.jobs[job.id].rows[0],originalUrl=row.platformEditUrl;
  row.saveIntent={status:'confirmed',payload:{url:originalUrl}};row.saved=true;row.ready=true;row.moveIntent={status:'unknown',payload:{draftId:row.draftId,url:originalUrl}};
  fs.writeFileSync(file,JSON.stringify(disk));let reads=0;
  f.backend.inspect=async args=>{const result=await originalInspect(args);result.rows[0]={...result.rows[0],draftId:'220114595121499888',platformEditUrl:'https://www.dianxiaomi.com/web/popTemu/edit?id=220114595121499888'};return result;};
  f.backend.verifyPublication=async args=>{reads++;assert.equal(args.row.platformEditUrl,originalUrl);return {publicationStatus:'draft',movedToPending:true,publicationNotSubmitted:true,readOnly:true,saved:true,ready:true,issues:[],platformEditUrl:originalUrl};};
  const restored=createListingWorkflow(f.options),result=await run(restored,job.id,'reconcile');
  assert.equal(reads,1);assert.equal(result.rows[0].platformEditUrl,originalUrl);assert.equal(result.rows[0].moveIntent.status,'confirmed');assert.equal(result.rows[0].saved,true);assert.equal(result.rows[1].locationStatus,'located');assert.equal(result.needsReconcile,false);
});

test('a later failed publication readback clears the current online count without authorizing another submission',async t=>{
  const f=await preparedFixture(t),{job}=f;
  f.backend.publish=async args=>{await args.beforePublish({url:args.row.platformEditUrl});return {publicationStatus:'online',published:true,issues:[]};};
  assert.equal((await run(f.service,job.id,'publish')).totals.published,1);
  f.backend.verifyPublication=async()=>({publicationStatus:'failed',published:false,readOnly:true,issues:['platform rejected product']});
  const result=await run(f.service,job.id,'reconcile');assert.equal(result.rows[0].published,false);assert.equal(result.totals.published,0);assert.equal(result.rows[0].publicationStatus,'failed');assert.deepEqual(result.availableActions,['reconcile']);
});

async function correctionFixture(t,{issues=[]}={}){
  const f=fixture(t,{publish:true}),snapshots=new Map();let remainingIssues=[...issues],reviewCalls=0;
  f.backend.prepare=async args=>{
    f.calls.push('prepare:'+args.row.id);
    const snapshot={url:args.row.platformEditUrl,account:f.erpConnection.expectedAccount,storeName:args.row.storeName,site:args.row.site,sources:[args.row.sourceUrl],
      fields:{variationSku:['sku-1','sku-2'],price:['20','35'],skuLength:['30','60'],skuWidth:['20','40'],skuHeight:['2','3'],weight:['0.4','0.9'],stock:['10000','10000']},
      items:[{label:'产品标题',controls:[{name:'title',value:'Canvas picture'}],selections:[],checked:[]},{label:'包裹信息',controls:[{name:'skuLength',value:'30'},{name:'weight',value:'0.4'}],selections:[],checked:[]}],
      media:{main:['image-a'],detail:['image-b']},variants:['size S','size L'],warehouses:[args.storeBinding.warehouse],priceSnapshot:[{sku:'sku-1',declaredPrice:'20'},{sku:'sku-2',declaredPrice:'35'}]};
    snapshots.set(args.row.id,clone(snapshot));
    await args.beforeSave({version:1,url:args.row.platformEditUrl,goodsId:args.row.goodsId,storeBindingKey:args.row.storeBindingKey,templateId:args.templateSnapshot.id,templateVersion:args.templateSnapshot.version,expectedSnapshot:snapshot});
    f.saved.add(args.row.id);return {saved:true,ready:!remainingIssues.length,published:false,issues:clone(remainingIssues)};
  };
  f.backend.reviewCorrections=async args=>{
    reviewCalls++;f.calls.push('review:'+args.row.id);
    for(const name of ['beforeSave','beforeMoveToPending','beforePublish','onMovedToPending'])assert.equal(args[name],undefined);
    assert.deepEqual(args.preparationIntent,args.row.saveIntent.payload);
    return {reviewAccepted:true,readOnly:true,saved:true,published:false,ready:!remainingIssues.length,issues:clone(remainingIssues),expectedSnapshot:clone(snapshots.get(args.row.id)),url:args.row.platformEditUrl,goodsId:args.row.goodsId,storeBindingKey:args.row.storeBindingKey};
  };
  f.backend.verify=async args=>{
    f.calls.push('verify:'+args.row.id);
    const matches=JSON.stringify(snapshots.get(args.row.id))===JSON.stringify(args.preparationIntent.expectedSnapshot);
    return {saved:matches?true:null,ready:matches&&!remainingIssues.length,published:false,issues:matches?clone(remainingIssues):['保存后快照已变化'],url:args.row.platformEditUrl};
  };
  const job=f.service.create({...f.request,goodsIds:[goodsIds[0]],storeKeys:['store-one']});
  await run(f.service,job.id,'inspect');await run(f.service,job.id,'prepare');
  return {...f,job,snapshots,get reviewCalls(){return reviewCalls;},setIssues:value=>{remainingIssues=[...value];}};
}

test('explicit correction review adopts only fresh package changes without another save and preserves the first snapshot',async t=>{
  const f=await correctionFixture(t),before=f.service.get(f.job.id).rows[0],snapshot=f.snapshots.get(before.id);
  snapshot.fields.weight=['0.5','1.1'];snapshot.items[1].controls[1].value='0.5';
  const reconciled=await run(f.service,f.job.id,'reconcile');assert.equal(reconciled.rows[0].ready,false);assert.deepEqual(reconciled.rows[0].saveIntent.payload.expectedSnapshot,before.saveIntent.payload.expectedSnapshot);
  assert.ok(reconciled.availableActions.includes('review-corrections'));assert.ok(!reconciled.availableActions.includes('publish'));
  const result=await run(f.service,f.job.id,'review-corrections'),row=result.rows[0];
  assert.equal(f.reviewCalls,1);assert.equal(row.ready,true);assert.equal(row.saved,true);assert.equal(row.saveIntent.status,'confirmed');assert.ok(result.availableActions.includes('publish'));
  assert.deepEqual(row.saveIntent.originalExpectedSnapshot,before.saveIntent.payload.expectedSnapshot);assert.deepEqual(row.saveIntent.payload.expectedSnapshot,snapshot);assert.equal(row.saveIntent.submittedAt,before.saveIntent.submittedAt);
  assert.equal(row.correctionCount,1);assert.equal(row.correctionHistory.length,1);assert.deepEqual(row.correctionHistory[0].before.weight,['0.4','0.9']);assert.deepEqual(row.correctionHistory[0].after.weight,['0.5','1.1']);
  assert.equal(f.calls.filter(call=>call.startsWith('prepare:')).length,1);assert.equal(f.calls.filter(call=>call.startsWith('publish:')).length,0);
  const repeated=await run(f.service,f.job.id,'review-corrections');assert.equal(repeated.rows[0].correctionCount,1);assert.equal(repeated.rows[0].correctionHistory.length,1);
  const restored=createListingWorkflow(f.options);assert.deepEqual(restored.get(f.job.id).availableActions,['reconcile']);const recovered=await run(restored,f.job.id,'reconcile');assert.equal(recovered.rows[0].ready,true);assert.deepEqual(recovered.rows[0].saveIntent.originalExpectedSnapshot,before.saveIntent.payload.expectedSnapshot);
});

test('saved draft correction review retains readiness issues and never makes an incomplete draft publishable',async t=>{
  const f=await correctionFixture(t,{issues:['英文标题仍含汉字']}),before=f.service.get(f.job.id).rows[0];
  assert.equal(before.saved,true);assert.equal(before.ready,false);assert.ok(f.service.get(f.job.id).availableActions.includes('review-corrections'));
  f.snapshots.get(before.id).fields.skuHeight=['4','5'];
  const result=await run(f.service,f.job.id,'review-corrections');assert.equal(result.rows[0].saved,true);assert.equal(result.rows[0].ready,false);assert.deepEqual(result.rows[0].issues,['英文标题仍含汉字']);assert.ok(!result.availableActions.includes('publish'));assert.equal(result.rows[0].correctionCount,1);
});

test('correction review refuses source, SKU, price, stock, media, category and malformed package changes even if adapter accepts them',async t=>{
  const mutations=[s=>s.sources=['https://www.temu.com/another-g-601234567899999.html'],s=>s.fields.variationSku.reverse(),s=>s.fields.price[0]='1',s=>s.fields.stock[0]='3',s=>s.media.main=[],s=>s.items.push({label:'产品分类',controls:[],selections:['其他'],checked:[]}),s=>s.fields.weight.pop(),s=>s.fields.weight[0]='0',s=>s.fields.weight[0]='not-a-number',s=>s.items[0].controls[0].value='Changed'];
  for(const change of mutations){
    const f=await correctionFixture(t),before=f.service.get(f.job.id).rows[0];change(f.snapshots.get(before.id));
    const result=await run(f.service,f.job.id,'review-corrections'),row=result.rows[0];assert.equal(row.ready,false);assert.equal(row.saved,true);assert.equal(row.correctionHistory,undefined);assert.equal(row.saveIntent.originalExpectedSnapshot,undefined);assert.deepEqual(row.saveIntent.payload.expectedSnapshot,before.saveIntent.payload.expectedSnapshot);assert.ok(row.issues.length);assert.ok(!result.availableActions.includes('publish'));
  }
});

test('declined, mismatched and non-read-only correction results retain the original confirmed save evidence',async t=>{
  for(const mode of ['declined','wrong-row','not-read-only','unsaved','published']){
    const f=await correctionFixture(t),before=f.service.get(f.job.id).rows[0],review=f.backend.reviewCorrections;
    f.snapshots.get(before.id).fields.skuHeight=['3','4'];
    f.backend.reviewCorrections=async args=>{const result=await review(args);if(mode==='declined')return {...result,reviewAccepted:false,issues:['请核对修改']};if(mode==='wrong-row')return {...result,goodsId:goodsIds[1]};if(mode==='not-read-only')return {...result,readOnly:false};if(mode==='unsaved')return {...result,saved:false};return {...result,published:true};};
    const result=await run(f.service,f.job.id,'review-corrections'),row=result.rows[0];assert.equal(row.ready,false);assert.deepEqual(row.saveIntent.payload.expectedSnapshot,before.saveIntent.payload.expectedSnapshot);assert.equal(row.correctionCount,undefined);assert.equal(row.saveIntent.status,'confirmed');
  }
});

test('correction history is bounded while the original saved package remains available',async t=>{
  const f=await correctionFixture(t),before=f.service.get(f.job.id).rows[0];
  for(let i=0;i<23;i++){f.snapshots.get(before.id).fields.skuHeight=[String(i+4),String(i+5)];await run(f.service,f.job.id,'review-corrections');}
  const row=f.service.get(f.job.id).rows[0];assert.equal(row.correctionCount,23);assert.equal(row.correctionHistory.length,20);assert.deepEqual(row.saveIntent.originalExpectedSnapshot,before.saveIntent.payload.expectedSnapshot);assert.deepEqual(row.correctionHistory[0].after.skuHeight,['7','8']);
});

test('correction review is unavailable before confirmed saving and after publication intent',async t=>{
  const f=fixture(t,{publish:true});let reviews=0;f.backend.reviewCorrections=async()=>{reviews++;return {};};
  const job=f.service.create(f.request);await run(f.service,job.id,'inspect');assert.ok(!f.service.get(job.id).availableActions.includes('review-corrections'));assert.throws(()=>f.service.run(job.id,'review-corrections'),/不支持/);
  f.backend.prepare=async args=>{await args.beforeSave({url:args.row.platformEditUrl,expectedSnapshot:{url:args.row.platformEditUrl}});throw new Error('save uncertain');};
  const blocked=await run(f.service,job.id,'prepare');assert.deepEqual(blocked.availableActions,['reconcile']);assert.throws(()=>f.service.run(job.id,'review-corrections'),/先只读核对/);assert.equal(reviews,0);
  const published=await correctionFixture(t);await run(published.service,published.job.id,'publish');assert.ok(!published.service.get(published.job.id).availableActions.includes('review-corrections'));assert.throws(()=>published.service.run(published.job.id,'review-corrections'),/不支持/);assert.equal(published.reviewCalls,0);
});

test('package review recovers a publication preflight mismatch without replaying any save or unconfirmed submission',async t=>{
  const f=await correctionFixture(t),before=f.service.get(f.job.id).rows[0];let attempts=0,submissions=0;
  f.snapshots.get(before.id).fields.skuHeight=['4','5'];
  f.backend.publish=async args=>{
    attempts++;
    if(JSON.stringify(f.snapshots.get(args.row.id))!==JSON.stringify(args.row.saveIntent.payload.expectedSnapshot))return {publicationStatus:'unknown',publicationNotSubmitted:true,moveAttempted:false,issues:['发布前快照已变化']};
    await args.beforePublish({url:args.row.platformEditUrl});submissions++;return {publicationStatus:'submitted',submitted:true,published:false,issues:[]};
  };
  const blocked=await run(f.service,f.job.id,'publish');assert.equal(blocked.rows[0].publicationStatus,'unknown');assert.equal(blocked.rows[0].publicationPreflightBlocked,true);assert.equal(blocked.rows[0].moveIntent,undefined);assert.equal(blocked.rows[0].publishIntent,undefined);assert.equal(submissions,0);assert.ok(blocked.availableActions.includes('review-corrections'));assert.ok(!blocked.availableActions.includes('publish'));
  const reconciled=await run(f.service,f.job.id,'reconcile');assert.equal(reconciled.rows[0].ready,false);assert.equal(reconciled.rows[0].publicationPreflightBlocked,true);assert.ok(reconciled.availableActions.includes('review-corrections'));assert.deepEqual(reconciled.rows[0].saveIntent.payload.expectedSnapshot,before.saveIntent.payload.expectedSnapshot);
  const reviewed=await run(f.service,f.job.id,'review-corrections');assert.equal(reviewed.rows[0].ready,true);assert.equal(reviewed.rows[0].publicationStatus,undefined);assert.equal(reviewed.rows[0].publicationPreflightBlocked,false);assert.ok(reviewed.availableActions.includes('publish'));assert.deepEqual(reviewed.rows[0].saveIntent.originalExpectedSnapshot,before.saveIntent.payload.expectedSnapshot);
  const published=await run(f.service,f.job.id,'publish');assert.equal(published.rows[0].publishIntent.status,'accepted');assert.equal(published.status,'submitted');assert.equal(attempts,2);assert.equal(submissions,1);assert.equal(f.calls.filter(call=>call.startsWith('prepare:')).length,1);assert.equal(f.reviewCalls,1);assert.ok(!published.availableActions.includes('review-corrections'));
});

test('package review cannot recover an unknown publication without proof that movement and submission never started',async t=>{
  for(const outcome of [{publicationStatus:'unknown',readOnly:true,issues:['未取得未提交证明']},{publicationStatus:'unknown',readOnly:true,publicationNotSubmitted:true,moveAttempted:true,issues:['可能已移动']}]){
    const f=await correctionFixture(t);f.backend.publish=async()=>clone(outcome);
    const blocked=await run(f.service,f.job.id,'publish');assert.equal(blocked.rows[0].publicationPreflightBlocked,false);assert.deepEqual(blocked.availableActions,['reconcile']);assert.throws(()=>f.service.run(f.job.id,'review-corrections'),/先只读核对/);assert.equal(f.reviewCalls,0);
  }
});
