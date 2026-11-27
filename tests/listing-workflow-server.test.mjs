import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createWorkbench} from '../src/server.mjs';

const goodsIds=['601234567890001','601234567890002'];
const product=id=>({goodsId:id,title:`Fixture canvas ${id}`,sourceUrl:`https://www.temu.com/fixture-g-${id}.html`});
const templateInput=(extra={})=>({name:'加拿大帆布画固定模板',erpKey:'erp-a',platform:'temu',businessType:'半托管',site:'加拿大站',productType:'帆布画',category:{label:'海报和印刷品',path:['家居、厨房用品','装饰字画','海报和印刷品']},rules:{attributes:{框架类型:'带框'},title:{mode:'preserve'},pricing:{mode:'preserve'}},storeBindings:[{key:'store-a',storeName:'测试店铺A',site:'加拿大站',warehouse:'加拿大仓库A',shippingTemplate:'加拿大运费A',dispatch:'2个工作日内发货',overrides:{}}],...extra});

async function fixture(t,{publish=true,unverifiedSecond=false,adapterOverrides={}}={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'listing-workflow-server-'));
  const calls=[],saved=new Set(),published=new Set();
  const adapter={
    inspect:async args=>{calls.push({kind:'inspect',version:args.templateSnapshot.version});return {rows:args.rows.flatMap((row,index)=>args.templateSnapshot.storeBindings.map((binding,bindingIndex)=>({goodsId:row.goodsId,sourceUrl:row.sourceUrl,storeBindingKey:binding.key,storeName:binding.storeName,site:binding.site,status:'located',platformEditUrl:`https://www.dianxiaomi.com/web/popTemu/edit?id=${220114595120000000n+BigInt(index*10+bindingIndex)}`,issues:[]})))};},
    prepare:async args=>{await args.beforeSave({platformEditUrl:args.row.platformEditUrl,templateVersion:args.templateSnapshot.version});calls.push({kind:'prepare',version:args.templateSnapshot.version,warehouse:args.storeBinding.warehouse,row:args.row.id});saved.add(args.row.id);return {platformEditUrl:args.row.platformEditUrl,saved:true,ready:true,published:false,issues:[]};},
    verify:async args=>{calls.push({kind:'verify',row:args.row.id});return {platformEditUrl:args.row.platformEditUrl,saved:saved.has(args.row.id),ready:saved.has(args.row.id),published:published.has(args.row.id),issues:saved.has(args.row.id)?[]:['fixture尚未保存']};},
    ...(publish?{publish:async args=>{await args.beforePublish({platformEditUrl:args.row.platformEditUrl});calls.push({kind:'publish',row:args.row.id});published.add(args.row.id);return {published:true,issues:[]};}}:{}),
    ...adapterOverrides
  };
  const options={dataDirectory:directory,configuration:{WORKBENCH_FRESH:'true'},settingsCodec:{encode:value=>Buffer.from(value).toString('base64'),decode:value=>Buffer.from(value,'base64').toString()},listingWorkflowAdapter:adapter,
    freePluginAdapter:{check:async()=>({status:'ready',message:'fixture插件已启用'})},
  freeSourcingAdapter:{search:async()=>({status:'ready',products:goodsIds.map(product)}),collect:async args=>{args.beforeSubmit();calls.push({kind:'collect',goodsId:args.goodsId});return {status:'submitted',pluginStatus:'success',receipt:{kind:'toast',sourceUrl:args.sourceUrl,observedAt:new Date().toISOString(),text:'fixture采集成功'}};},returnToSearch:async()=>({status:'ready'})},
    freeCollectionAdapter:{check:async()=>({ready:true}),lookup:async()=>({status:'absent'}),verify:async args=>unverifiedSecond&&args.goodsId===goodsIds[1]?{status:'needs-review',error:'fixture第二件未确认入箱'}:{status:'verified',evidence:{sourceUrl:args.sourceUrl,editUrl:`https://www.dianxiaomi.com/web/productCrawl/edit?id=${219835794620000000n+BigInt(goodsIds.indexOf(args.goodsId))}`,title:`Fixture canvas ${args.goodsId}`}}}
  };
  let app,base,token;
  const listen=async()=>{app=createWorkbench(options);await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+app.server.address().port;({token}=await fetch(base+'/api/session').then(response=>response.json()));};
  await listen();
  app.preferences.update({revision:0,browsers:[{key:'chrome-a',type:'chrome',name:'Fixture Chrome',debugPort:9444}],erpConnections:[{key:'erp-a',name:'Fixture ERP A',browserKey:'chrome-a',expectedAccount:'fixture-a'},{key:'erp-b',name:'Fixture ERP B',browserKey:'chrome-a',expectedAccount:'fixture-b'}],stores:[]});
  t.after(async()=>{if(app?.server.listening)await new Promise(resolve=>app.server.close(resolve));assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});});
  const request=async(route,payload,headers={})=>{const response=await fetch(base+route,payload===undefined?{headers}:{method:'POST',headers:{'Content-Type':'application/json','X-Workbench-Token':token,...headers},body:JSON.stringify(payload)});return {status:response.status,data:await response.json()};};
  const ok=async(route,payload)=>{const result=await request(route,payload);assert.ok(result.status>=200&&result.status<300,`${route}: ${result.status} ${JSON.stringify(result.data)}`);return result.data;};
  const getJob=async id=>{const state=await ok('/api/listing-workflow');const job=state.jobs.find(item=>item.id===id);assert.ok(job,`missing job ${id}`);return job;};
  const idle=async()=>{const deadline=Date.now()+4000;while(app.isBusy()){if(Date.now()>deadline)throw new Error('isolated workflow did not settle');await new Promise(resolve=>setTimeout(resolve,5));}};
  return {directory,calls,adapter,get app(){return app;},get base(){return base;},get token(){return token;},request,ok,getJob,idle,
    seed:async()=>{await ok('/api/free-sourcing/jobs',{requestId:'free-fixture',erpKey:'erp-a',keyword:'canvas wall art',limit:2,captchaMaxAttempts:0,collectionMode:'recording'});await idle();return (await ok('/api/free-sourcing')).jobs.find(job=>job.id==='free-fixture');},
    restart:async()=>{await idle();await new Promise(resolve=>app.server.close(resolve));await listen();}
  };
}

function jobInput(template,extra={}){return {requestId:'listing-fixture',freeJobId:'free-fixture',goodsIds:[goodsIds[0]],templateId:template.id,templateVersion:template.version,...extra};}
async function run(f,id,kind){await f.ok(`/api/listing-workflow/jobs/${id}/${kind}`,{});await f.idle();return f.getJob(id);}

test('fixed-template workflow and its assets are served through the local workbench',async t=>{
  const f=await fixture(t);
  const page=await fetch(f.base+'/sourcing/listing?freeJobId=free-fixture');assert.equal(page.status,200);assert.match(page.headers.get('content-type'),/text\/html/);
  const html=await page.text();assert.match(html,/固定上架模板/);assert.match(html,/本次处理范围/);assert.match(html,/\/local\/listing-workflow\.js/);
  for(const asset of ['/local/listing-workflow.js','/local/listing-workflow.css']){const response=await fetch(f.base+asset);assert.equal(response.status,200);assert.ok((await response.text()).length>100);}
  const freePage=await fetch(f.base+'/sourcing/free').then(response=>response.text());assert.match(freePage,/href="\/sourcing\/listing"/);
  assert.deepEqual((await f.ok('/api/listing-templates')).templates,[]);assert.deepEqual((await f.ok('/api/listing-workflow')).jobs,[]);assert.equal(f.calls.length,0);
});

test('HTTP packaging correction adopts only saved package edits without another save or publish',async t=>{
  let stored,saveCalls=0,reviewCalls=0;
  const f=await fixture(t,{adapterOverrides:{
    prepare:async args=>{
      stored={url:args.row.platformEditUrl,account:args.erpConnection.expectedAccount,storeName:args.storeBinding.storeName,site:args.storeBinding.site,sources:[args.row.sourceUrl],items:[],fields:{variationSku:['sku-one'],price:['20'],stock:['10000'],skuLength:['30'],skuWidth:['20'],skuHeight:['2'],weight:['.4']}};
      await args.beforeSave({url:stored.url,goodsId:args.row.goodsId,storeBindingKey:args.storeBinding.key,templateId:args.templateSnapshot.id,templateVersion:args.templateSnapshot.version,expectedSnapshot:structuredClone(stored)});saveCalls++;
      return {saved:true,ready:true,published:false,issues:[],snapshot:structuredClone(stored)};
    },
    reviewCorrections:async args=>{reviewCalls++;assert.equal(args.beforeSave,undefined);assert.equal(args.beforePublish,undefined);return {reviewAccepted:true,readOnly:true,saved:true,ready:true,issues:[],expectedSnapshot:structuredClone(stored),snapshot:structuredClone(stored)};}
  }});
  await f.seed();const template=await f.ok('/api/listing-templates',templateInput({rules:{inventory:{mode:'fixed',quantity:10000},saveMode:'draft',categoryMode:'replace'}}));
  const job=await f.ok('/api/listing-workflow/jobs',jobInput(template));await run(f,job.id,'inspect');const prepared=await run(f,job.id,'prepare');assert.ok(prepared.availableActions.includes('review-corrections'));
  stored.fields.weight=['.7'];const corrected=await run(f,job.id,'review-corrections');assert.equal(corrected.rows[0].saveIntent.payload.expectedSnapshot.fields.weight[0],'.7');assert.equal(corrected.rows[0].correctionHistory.length,1);assert.equal(saveCalls,1);assert.equal(reviewCalls,1);assert.ok(corrected.availableActions.includes('publish'));assert.ok(!f.calls.some(call=>call.kind==='publish'));
});

test('HTTP templates can be saved, updated, copied and reused after rebuilding the server',async t=>{
  const f=await fixture(t);
  const first=await f.ok('/api/listing-templates',templateInput());assert.equal(first.version,1);assert.equal(first.readiness.ready,true);
  const next=await f.ok('/api/listing-templates',{...first,name:'加拿大帆布画·固定v2',storeBindings:first.storeBindings.map(binding=>({...binding,warehouse:'更新后的加拿大仓库'}))});assert.equal(next.id,first.id);assert.equal(next.version,2);
  const stale=await f.request('/api/listing-templates',{...first,name:'过时修改'});assert.equal(stale.status,409);
  const copied=await f.ok(`/api/listing-templates/${next.id}/copy`,{name:'加拿大帆布画·复制模板',version:next.version});assert.notEqual(copied.id,next.id);assert.equal(copied.version,1);assert.equal(copied.storeBindings[0].warehouse,'更新后的加拿大仓库');
  await f.restart();
  const stored=(await f.ok('/api/listing-templates')).templates;assert.equal(stored.length,2);
  const restored=stored.find(item=>item.id===first.id);assert.equal(restored.version,2);assert.equal(restored.name,'加拿大帆布画·固定v2');assert.equal(restored.storeBindings[0].shippingTemplate,'加拿大运费A');assert.deepEqual(restored.rules.attributes,{框架类型:'带框'});
  assert.equal(stored.find(item=>item.id===copied.id).copiedFrom.id,first.id);assert.equal(f.calls.length,0);
});

test('template and workflow write routes reject missing tokens and foreign origins before mutation',async t=>{
  const f=await fixture(t);
  const current=await f.ok('/api/listing-templates',templateInput());
  const routes=[['/api/listing-templates',templateInput({name:'不应保存'})],[`/api/listing-templates/${current.id}/copy`,{name:'不应复制'}],['/api/listing-workflow/jobs',jobInput(current)],[`/api/listing-workflow/jobs/missing/inspect`,{}],[`/api/listing-workflow/jobs/missing/categories/read`,{}],[`/api/listing-workflow/jobs/missing/categories/select`,{}],[`/api/listing-workflow/jobs/missing/categories/search`,{}],[`/api/listing-workflow/jobs/missing/categories/resolve`,{}],[`/api/listing-workflow/jobs/missing/process`,{}],[`/api/listing-workflow/jobs/missing/pending`,{}]];
  for(const [route,payload] of routes){
    const noToken=await fetch(f.base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});assert.equal(noToken.status,403,route);
    const foreign=await f.request(route,payload,{Origin:'https://untrusted.example'});assert.equal(foreign.status,403,route);
  }
  assert.equal((await f.ok('/api/listing-templates')).templates.length,1);assert.equal((await f.ok('/api/listing-workflow')).jobs.length,0);assert.equal(f.calls.length,0);
});

test('HTTP workflow accepts only verified source records from the same ERP account and freezes the chosen template',async t=>{
  const f=await fixture(t,{unverifiedSecond:true});
  const source=await f.seed();assert.deepEqual(source.rows.map(row=>row.status),['verified','needs-review']);
  const current=await f.ok('/api/listing-templates',templateInput());
  const wrongSource=await f.request('/api/listing-workflow/jobs',jobInput(current,{goodsIds:[goodsIds[1]]}));assert.equal(wrongSource.status,400);assert.match(wrongSource.data.error,/核实|确认/);
  const other=await f.ok('/api/listing-templates',templateInput({name:'另一个账号的模板',erpKey:'erp-b'}));
  const wrongAccount=await f.request('/api/listing-workflow/jobs',jobInput(other));assert.equal(wrongAccount.status,400);assert.match(wrongAccount.data.error,/同一ERP账号/);
  const created=await f.ok('/api/listing-workflow/jobs',jobInput(current));assert.equal(created.rows.length,1);assert.equal(created.rows[0].locationStatus,'pending');assert.equal(created.rows[0].saved,false);assert.equal(created.rows[0].published,false);assert.ok(!created.availableActions.includes('prepare'));
  const updated=await f.ok('/api/listing-templates',{...current,storeBindings:current.storeBindings.map(binding=>({...binding,warehouse:'后续任务的新仓库'}))});assert.equal(updated.version,2);
  const repeated=await f.ok('/api/listing-workflow/jobs',jobInput(current));assert.equal(repeated.id,created.id);assert.equal((await f.ok('/api/listing-workflow')).jobs.length,1);
  await run(f,created.id,'inspect');const prepared=await run(f,created.id,'prepare');
  assert.equal(prepared.templateVersion,1);assert.equal(prepared.templateSnapshot.storeBindings[0].warehouse,'加拿大仓库A');assert.equal(prepared.rows[0].saved,true);
  const writes=f.calls.filter(call=>call.kind==='prepare');assert.equal(writes.length,1);assert.equal(writes[0].warehouse,'加拿大仓库A');assert.equal(writes[0].version,1);
  await f.restart();const restored=await f.getJob(created.id);assert.equal(restored.templateVersion,1);assert.equal(restored.templateSnapshot.storeBindings[0].warehouse,'加拿大仓库A');assert.deepEqual(restored.availableActions,['reconcile']);
});

test('server action availability prevents preparing or publishing ahead of verified stages',async t=>{
  const f=await fixture(t);await f.seed();const current=await f.ok('/api/listing-templates',templateInput());const job=await f.ok('/api/listing-workflow/jobs',jobInput(current));
  assert.deepEqual(job.availableActions,['inspect']);
  for(const kind of ['prepare','publish']){const denied=await f.request(`/api/listing-workflow/jobs/${job.id}/${kind}`,{ready:true,saved:true,availableActions:[kind]});assert.equal(denied.status,409);}
  assert.equal(f.calls.filter(call=>['prepare','publish'].includes(call.kind)).length,0);
  const inspected=await run(f,job.id,'inspect');assert.ok(inspected.availableActions.includes('prepare'));assert.ok(!inspected.availableActions.includes('publish'));
  const prepared=await run(f,job.id,'prepare');assert.equal(prepared.status,'prepared');assert.equal(prepared.rows[0].published,false);assert.ok(prepared.availableActions.includes('publish'));assert.ok(!prepared.availableActions.includes('prepare'));
  const completed=await run(f,job.id,'publish');assert.equal(completed.status,'completed');assert.equal(completed.rows[0].published,true);assert.ok(!completed.availableActions.includes('publish'));
  const repeat=await f.request(`/api/listing-workflow/jobs/${job.id}/publish`,{});assert.equal(repeat.status,409);assert.equal(f.calls.filter(call=>call.kind==='publish').length,1);
});

test('saved templates never advertise publishing when the injected executor has no publishing support',async t=>{
  const f=await fixture(t,{publish:false});await f.seed();const current=await f.ok('/api/listing-templates',templateInput());const job=await f.ok('/api/listing-workflow/jobs',jobInput(current));
  await run(f,job.id,'inspect');const prepared=await run(f,job.id,'prepare');assert.equal(prepared.status,'prepared');assert.ok(!prepared.availableActions.includes('publish'));
  const denied=await f.request(`/api/listing-workflow/jobs/${job.id}/publish`,{});assert.equal(denied.status,409);assert.match(denied.data.error,/尚未接通/);assert.equal(f.calls.filter(call=>call.kind==='publish').length,0);
});

test('HTTP category search and confirmation feed only the exact native batch through pending publication',async t=>{
  const f=await fixture(t,{publish:false});await f.seed();
  f.app.preferences.update({revision:f.app.preferences.view().revision,collectionStores:[{key:'collection-a',erpKey:'erp-a',platform:'shein',storeName:'Fixture Store A',storeId:'',site:'美国站'}]});
  const receipt=row=>({id:row.id,goodsId:row.goodsId,storeBindingKey:row.storeBindingKey,draftId:row.draftId,platformEditUrl:row.platformEditUrl,saved:true,ready:true,published:false,submitted:false,issues:[]});
  Object.assign(f.adapter,{capabilities:{nativePrepare:true,nativePending:true,nativePreparePlatforms:['shein'],nativePendingPlatforms:['shein'],categorySearchPlatforms:['shein']},
    inspect:async args=>({rows:args.rows.map(row=>({goodsId:row.goodsId,sourceUrl:row.sourceUrl,storeBindingKey:'collection-a',storeName:'Fixture Store A',platform:'shein',site:'美国站',status:'located',draftId:'220114595120000001',platformEditUrl:'https://www.dianxiaomi.com/web/sheinProduct/edit?id=220114595120000001',issues:[]}))}),
    searchCategories:async args=>({platform:'shein',account:'fixture-a',storeBindingKey:args.storeBinding.key,query:args.query,candidates:[{candidateId:'visible-canvas-category',platformCategoryId:'canvas-category-7',label:'帆布画',path:['家居装饰','帆布画'],leaf:true,source:'store-search'}]}),
    prepareBatch:async args=>{await args.beforeSubmit({rows:args.rows.map(row=>({id:row.id,goodsId:row.goodsId,storeBindingKey:row.storeBindingKey,draftId:row.draftId,payload:{url:row.platformEditUrl,goodsId:row.goodsId,storeBindingKey:row.storeBindingKey,expectedSnapshot:{category:args.templateSnapshot.category,prices:[{sku:'canvas-white',value:'25',currency:'CNY'}]},priceEvidence:{policy:'dxm-preserved-price-v1',ready:true}}}))});f.calls.push({kind:'native-save',ids:args.rows.map(row=>row.goodsId)});return {rows:args.rows.map(receipt)};},
    moveToPendingBatch:async args=>{await args.beforeSubmit({rows:args.rows.map(row=>({id:row.id,goodsId:row.goodsId,storeBindingKey:row.storeBindingKey,draftId:row.draftId,payload:{url:row.platformEditUrl,goodsId:row.goodsId,storeBindingKey:row.storeBindingKey,draftId:row.draftId,sourceUrl:row.sourceUrl,from:'collection',to:'pending-publication'}}))});f.calls.push({kind:'native-pending',ids:args.rows.map(row=>row.goodsId)});return {rows:args.rows.map(row=>({...receipt(row),publicationStatus:'draft',movedToPending:true,publicationNotSubmitted:true}))};}
  });
  const job=await f.ok('/api/listing-workflow/jobs',{requestId:'native-http-fixture',sourceJobId:'free-fixture',goodsIds:[goodsIds[0]],destinationKeys:['collection-a']});await run(f,job.id,'inspect');
  const base=`/api/listing-workflow/jobs/${job.id}`,catalog=await f.ok(`${base}/categories/search`,{goodsId:goodsIds[0],storeBindingKey:'collection-a',query:'帆布画'});
  assert.equal(catalog.resolution.status,'needs-confirmation');assert.equal(catalog.candidates.length,1);
  const rejected=await f.request(`${base}/categories/resolve`,{catalogId:catalog.catalogId,catalogDigest:catalog.catalogDigest,candidateId:'fabricated',goodsIds:[goodsIds[0]],storeBindingKey:'collection-a'});assert.equal(rejected.status,400);
  const confirmed=await f.ok(`${base}/categories/resolve`,{catalogId:catalog.catalogId,catalogDigest:catalog.catalogDigest,candidateId:catalog.candidates[0].candidateId,goodsIds:[goodsIds[0]],storeBindingKey:'collection-a'});assert.ok(confirmed.availableActions.includes('process'));
  const completed=await run(f,job.id,'process');assert.equal(completed.status,'pending-ready');assert.equal(completed.totals.pending,1);assert.equal(completed.rows[0].published,false);assert.deepEqual(f.calls.filter(call=>call.kind.startsWith('native-')).map(call=>[call.kind,call.ids]),[['native-save',[goodsIds[0]]],['native-pending',[goodsIds[0]]]]);assert.equal(f.calls.some(call=>['prepare','publish'].includes(call.kind)),false);
});
