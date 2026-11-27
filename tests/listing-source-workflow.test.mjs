import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createListingWorkflow} from '../src/listing-workflow.mjs';
import {createListingWorkflowDispatcher} from '../src/server.mjs';

const copy=value=>structuredClone(value),goods=['601234567890001','601234567890002','601234567890003'];
const categories=[{id:'electric',label:'电动用品',path:['电动用品'],leaf:true},{id:'manual',label:'手动用品',path:['手动用品'],leaf:true}];
const rawFacts=(row,categoryPath=['家居','电动用品'])=>({goodsId:row.goodsId,sourceUrl:row.sourceUrl,observedAt:new Date().toISOString(),categoryPath,priceCandidates:[],selectedVariant:{attributes:[],selectionComplete:false}});
const key=row=>JSON.stringify([row.goodsId,row.storeBindingKey]);
async function idle(service){const deadline=Date.now()+3000;while(service.isBusy()){if(Date.now()>deadline)throw new Error('fixture timeout');await new Promise(resolve=>setTimeout(resolve,2));}}
async function run(f,action){f.service.run(f.job.id,action);await idle(f.service);return f.service.get(f.job.id);}
function fixture(t,{native=false,stores=1}={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'listing-source-workflow-'));
  t.after(()=>{assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});});
  const erp={key:'erp-fixture',provider:'dianxiaomi',browserKey:'chrome-fixture',expectedAccount:'fixture'},browser={key:'chrome-fixture',type:'chrome',debugPort:9222};
  const destinations=Array.from({length:3},(_,index)=>({key:'store-'+index,erpKey:erp.key,platform:'shein',storeName:'测试店'+index,storeId:'id-'+index,site:'美国站'}));
  const freeJob={id:'source-fixture',erpKey:erp.key,keyword:'中性测试商品',binding:{erpConnection:copy(erp),browserConfig:copy(browser)},rows:[...goods,'601234567890004'].map((goodsId,index)=>{const row={goodsId,sourceUrl:`https://www.temu.com/fixture-g-${goodsId}.html`,title:'商品'+index,status:'verified',evidence:{sourceUrl:`https://www.temu.com/fixture-g-${goodsId}.html`,editUrl:`https://www.dianxiaomi.com/web/productCrawl/edit?id=21983579462844462${index}`}};return {...row,sourceFacts:rawFacts(row,index<2?['家居','电动用品']:['户外','手动用品'])};})};
  const calls=[],saved=new Set(),moved=new Set(),stateFile=path.join(directory,'state.json');let service;
  const persisted=()=>JSON.parse(fs.readFileSync(stateFile,'utf8')).jobs['job-fixture'];
  const preparation=row=>({id:row.id,goodsId:row.goodsId,storeBindingKey:row.storeBindingKey,draftId:row.draftId,platformEditUrl:row.platformEditUrl,saved:true,ready:true,published:false,issues:[]});
  const publication=row=>({...preparation(row),publicationStatus:'draft',movedToPending:true,publicationNotSubmitted:true,submitted:false});
  const savePayload=row=>({url:row.platformEditUrl,goodsId:row.goodsId,storeBindingKey:row.storeBindingKey,expectedSnapshot:{prices:[{sku:'fixture-sku',value:'12.50',currency:'USD'}],attributes:{颜色:'白色'}},priceEvidence:{policy:'dxm-preserved-price-v1',ready:true,prices:[{sku:'fixture-sku',value:'12.50',currency:'USD'}]}});
  const movePayload=row=>({url:row.platformEditUrl,goodsId:row.goodsId,storeBindingKey:row.storeBindingKey,draftId:row.draftId,sourceUrl:row.sourceUrl,from:'collection',to:'pending-publication'});
  const adapter={capabilities:{nativePrepare:native,nativePending:native,nativeOpenPlatforms:['shein'],moveToPending:true},
    inspect:async args=>{calls.push({kind:'inspect'});return {rows:args.rows.flatMap((row,index)=>args.templateSnapshot.storeBindings.map((store,storeIndex)=>({goodsId:row.goodsId,storeBindingKey:store.key,sourceUrl:row.sourceUrl,storeName:store.storeName,site:store.site,platform:'shein',status:'located',draftId:`220114595121490${index}${storeIndex}0`,platformEditUrl:`https://www.dianxiaomi.com/web/sheinProduct/edit?id=220114595121490${index}${storeIndex}0`,requiredFields:[{label:'产品分类',missing:true},{label:'售价',value:'12.50',missing:false}],priceCheck:{ready:true},issues:[]})))};},
    readCategories:async args=>({platform:'shein',account:erp.expectedAccount,storeBindingKey:args.storeBinding.key,path:args.path,options:copy(categories)}),
    prepare:async args=>{assert.equal(args.sourceFacts?.price,null,'no Temu price is required');await args.beforeSave(savePayload(args.row));assert.equal(persisted().rows.find(row=>row.id===args.row.id).saveIntent.status,'pending');calls.push({kind:'prepare',id:args.row.id});saved.add(args.row.id);return preparation(args.row);},
    verify:async args=>saved.has(args.row.id)?preparation(args.row):{...preparation(args.row),saved:false,ready:false,issues:['未保存']},
    moveToPending:async args=>{await args.beforeMoveToPending(movePayload(args.row));calls.push({kind:'pending',id:args.row.id});moved.add(args.row.id);return publication(args.row);},
    verifyPublication:async args=>({...publication(args.row),readOnly:true,movedToPending:moved.has(args.row.id),publicationStatus:moved.has(args.row.id)?'draft':'unknown'}),
    prepareBatch:async args=>{
      await args.beforeSubmit({rows:args.rows.map(row=>({id:row.id,goodsId:row.goodsId,storeBindingKey:row.storeBindingKey,draftId:row.draftId,payload:savePayload(row)}))});
      const recorded=persisted(),operation=recorded.batchOperations.find(item=>item.id===args.batchId);assert.equal(operation.status,'pending');assert.deepEqual(operation.memberIds,args.rows.map(row=>row.id));
      for(const row of args.rows){const stored=recorded.rows.find(item=>item.id===row.id);assert.equal(stored.saveIntent.status,'pending');assert.equal(stored.saveIntent.batchId,args.batchId);saved.add(row.id);}
      calls.push({kind:'prepareBatch',ids:args.rows.map(row=>row.id),category:args.templateSnapshot.category.id,store:args.storeBinding.key});return {rows:args.rows.map(preparation)};
    },
    moveToPendingBatch:async args=>{
      await args.beforeSubmit({rows:args.rows.map(row=>({id:row.id,goodsId:row.goodsId,storeBindingKey:row.storeBindingKey,draftId:row.draftId,payload:movePayload(row)}))});
      const recorded=persisted();assert.equal(recorded.batchOperations.find(item=>item.id===args.batchId).status,'pending');
      for(const row of args.rows){assert.equal(recorded.rows.find(item=>item.id===row.id).moveIntent.status,'pending');moved.add(row.id);}
      calls.push({kind:'pendingBatch',ids:args.rows.map(row=>row.id),category:args.templateSnapshot.category.id,store:args.storeBinding.key});return {rows:args.rows.map(publication)};
    },
    openNativeBatch:async args=>{await args.beforeOpen({memberIds:args.rows.map(row=>row.id)});calls.push({kind:'native-edit',ids:args.rows.map(row=>row.id),store:args.storeBinding.key});assert.equal(persisted().nativeEdit.status,'opening');return {status:'opened',saved:false};}
  };
  const freeSourcing={view:()=>({jobs:[copy(freeJob)]}),readSourceFacts:async(id,{goodsIds})=>{assert.equal(id,freeJob.id);calls.push({kind:'source-facts',goodsIds});const result=copy(freeJob);for(const row of result.rows)row.sourceFacts=rawFacts(row,['补读后的来源类别']);return result;}};
  const options={directory,preferences:{erp:()=>copy(erp),browser:()=>copy(browser),view:()=>({collectionStores:copy(destinations)})},templates:{},freeSourcing,adapter};
  service=createListingWorkflow(options);
  const f={directory,options,adapter,freeJob,freeSourcing,calls,saved,moved,persisted,preparation,publication,savePayload,movePayload,service,stores:destinations.slice(0,stores)};
  f.job=service.create({requestId:'job-fixture',sourceJobId:freeJob.id,goodsIds:goods,destinationKeys:f.stores.map(store=>store.key)});
  f.selectBatch=async(ids,store=f.stores[0],category=categories[0])=>{const catalog=await f.service.readCategories(f.job.id,{goodsId:ids[0],storeBindingKey:store.key,path:[]});return f.service.selectCategories(f.job.id,{goodsIds:ids,storeBindingKeys:[store.key],catalogId:catalog.catalogId,category});};
  f.select=async(ids,store=f.stores[0],category=categories[0])=>{let result;for(const goodsId of ids)result=await f.selectBatch([goodsId],store,category);return result;};
  return f;
}

test('missing Temu price permits ordinary completion while DXM converted prices remain in the saved baseline',async t=>{
  const f=fixture(t);await run(f,'inspect');await f.select([goods[0]]);
  const prepared=await run(f,'prepare');assert.equal(prepared.rows[0].saved,true);assert.equal(prepared.sourceRows[0].sourceFacts.price,null);
  assert.deepEqual(prepared.rows[0].saveIntent.payload.expectedSnapshot.prices,[{sku:'fixture-sku',value:'12.50',currency:'USD'}]);
  assert.equal(f.calls.filter(call=>call.kind==='prepare').length,1);assert.equal(prepared.rows[1].saveIntent,undefined);
  const pending=await run(f,'pending');assert.equal(pending.totals.pending,1);assert.equal(pending.rows[1].moveIntent,undefined);assert.equal(pending.rows[2].moveIntent,undefined);
});

test('source readback updates only this batch unsaved goods and preserves every existing save intent',async t=>{
  const f=fixture(t);await run(f,'inspect');await f.select([goods[0]]);await run(f,'prepare');
  const before=f.service.get(f.job.id),intent=copy(before.rows[0].saveIntent),source=copy(before.sourceRows[0]);
  const after=await run(f,'source-facts');assert.deepEqual(f.calls.find(call=>call.kind==='source-facts').goodsIds,goods.slice(1));
  assert.deepEqual(after.rows[0].saveIntent,intent);assert.deepEqual(after.sourceRows[0],source);assert.deepEqual(after.sourceRows[1].sourceFacts.categoryPath,['补读后的来源类别']);
  assert.equal(f.calls.filter(call=>call.kind==='prepare').length,1);assert.equal(after.sourceRows.some(row=>row.goodsId==='601234567890004'),false);
});

test('category application cannot cross source paths or copy an unknown source path',async t=>{
  const f=fixture(t);await run(f,'inspect');
  await assert.rejects(f.selectBatch([goods[0],goods[2]]),/同一来源完整分类/);
  await f.select(goods.slice(0,2));assert.equal(f.service.get(f.job.id).rows.filter(row=>!row.categoryRequired).length,2);
  const other=fixture(t);delete other.freeJob.rows[1].sourceFacts;
  // A second task captures the changed source rather than modifying persisted data.
  other.job=other.service.create({requestId:'unknown-source-job',sourceJobId:other.freeJob.id,goodsIds:[goods[1],goods[2]],destinationKeys:[other.stores[0].key]});await run(other,'inspect');
  await assert.rejects(other.selectBatch([goods[1],goods[2]]),/未知分类请逐件确认/);await other.select([goods[1]]);
});

test('native batch actions are absent until both native implementations are explicitly available',async t=>{
  const f=fixture(t);await run(f,'inspect');await f.select([goods[0]]);
  assert.equal(f.service.get(f.job.id).nativeBatch.ready,false);assert.equal(f.service.get(f.job.id).availableActions.includes('process'),false);assert.throws(()=>f.service.run(f.job.id,'process'),/不支持/);
  f.adapter.capabilities.nativePrepare=true;assert.equal(f.service.get(f.job.id).nativeBatch.ready,false);assert.equal(f.service.get(f.job.id).availableActions.includes('process'),false);
  f.adapter.capabilities.nativePending=true;assert.equal(f.service.get(f.job.id).availableActions.includes('process'),true);
});

test('native platform allowlists prevent one marketplace implementation enabling another',async t=>{
  const f=fixture(t,{native:true});await run(f,'inspect');await f.select([goods[0]]);
  f.adapter.capabilities.nativePreparePlatforms=['tiktok'];f.adapter.capabilities.nativePendingPlatforms=['tiktok'];
  assert.equal(f.service.get(f.job.id).nativeBatch.ready,false);assert.equal(f.service.get(f.job.id).availableActions.includes('process'),false);
  f.adapter.capabilities.nativePreparePlatforms=['shein'];f.adapter.capabilities.nativePendingPlatforms=['shein'];assert.equal(f.service.get(f.job.id).nativeBatch.ready,true);
  f.adapter.capabilities.nativePrepare=false;assert.equal(f.service.get(f.job.id).nativeBatch.ready,false);
});

test('production dispatcher exposes real batch/search methods and scopes implicit native flags to SHEIN',async()=>{
  const calls=[],requiredFields={capabilities:{nativePrepare:true,nativePending:true},prepareBatch:async args=>{calls.push(['save',args.templateSnapshot.platform]);return 'saved';},moveToPendingBatch:async()=> 'pending',searchCategories:async()=> 'catalog'};
  const dispatcher=createListingWorkflowDispatcher({temu:{capabilities:{}},requiredFields});
  assert.deepEqual(dispatcher.capabilities.nativePreparePlatforms,['shein']);assert.deepEqual(dispatcher.capabilities.nativePendingPlatforms,['shein']);assert.deepEqual(dispatcher.capabilities.categorySearchPlatforms,['shein']);
  const args={workflowMode:'required-fields',completionMode:'pending',templateSnapshot:{platform:'shein'}};
  assert.equal(await dispatcher.prepareBatch(args),'saved');assert.equal(await dispatcher.moveToPendingBatch(args),'pending');assert.equal(await dispatcher.searchCategories(args),'catalog');assert.deepEqual(calls,[['save','shein']]);
  await assert.rejects(dispatcher.prepareBatch({...args,templateSnapshot:{platform:'tiktok'}}),/尚未启用/);await assert.rejects(dispatcher.searchCategories({...args,templateSnapshot:{platform:'tiktok'}}),/尚未接入/);
  const unsupported=createListingWorkflowDispatcher({temu:{capabilities:{}},requiredFields:{capabilities:{nativePrepare:true,nativePending:true}}});assert.equal(unsupported.capabilities.nativePrepare,false);assert.equal(unsupported.capabilities.nativePending,false);
});

function searchAdapter(f){
  const candidates=[{candidateId:'visible-fixture-blender',platformCategoryId:null,label:'搅拌机',path:['家用电器','厨房电器','搅拌机'],leaf:true,source:'store-search'},{candidateId:'visible-fixture-accessory',platformCategoryId:'platform-accessory-7',label:'搅拌机配件',path:['家用电器','配件','搅拌机配件'],leaf:true,source:'store-search'}];
  f.adapter.searchCategories=async args=>({platform:'shein',account:'fixture',storeBindingKey:args.storeBinding.key,query:args.query,candidates:copy(candidates),observedAt:new Date().toISOString()});
  return candidates;
}

test('search candidates remain unconfirmed until server-bound resolution and cannot invent a platform ID',async t=>{
  const f=fixture(t);await run(f,'inspect');const candidates=searchAdapter(f);
  const catalog=await f.service.searchCategories(f.job.id,{goodsId:goods[0],storeBindingKey:f.stores[0].key,query:'搅拌机',productType:'便携搅拌机'});
  assert.equal(catalog.resolution.status,'needs-confirmation');assert.equal(f.service.get(f.job.id).rows[0].categoryRequired,true);assert.equal(catalog.product.productTypeConfirmed,false);
  assert.throws(()=>f.service.resolveCategories(f.job.id,{catalogId:catalog.catalogId,catalogDigest:'changed',candidateId:candidates[0].candidateId,goodsIds:[goods[0]],storeBindingKey:f.stores[0].key}),/候选已变化/);
  assert.throws(()=>f.service.resolveCategories(f.job.id,{catalogId:catalog.catalogId,catalogDigest:catalog.catalogDigest,candidateId:'invented',goodsIds:[goods[0]],storeBindingKey:f.stores[0].key}),/不在本店/);
  const resolved=f.service.resolveCategories(f.job.id,{catalogId:catalog.catalogId,catalogDigest:catalog.catalogDigest,candidateId:candidates[0].candidateId,goodsIds:[goods[0]],storeBindingKey:f.stores[0].key});
  assert.equal(resolved.rows[0].categoryRequired,false);assert.equal(resolved.rows[0].categorySelection.category.id,undefined);assert.equal(resolved.rows[0].categorySelection.category.platformCategoryId,null);assert.equal(resolved.rows[0].categorySelection.searchQuery,'搅拌机');assert.equal(resolved.rows[0].categoryResolution.mapping,null);assert.ok(resolved.availableActions.includes('prepare'));
});

test('batch category confirmation requires explicit concrete type and identical source paths',async t=>{
  const f=fixture(t);await run(f,'inspect');const candidates=searchAdapter(f);
  const catalog=await f.service.searchCategories(f.job.id,{goodsId:goods[0],storeBindingKey:f.stores[0].key,query:'搅拌机'}),input={catalogId:catalog.catalogId,catalogDigest:catalog.catalogDigest,candidateId:candidates[0].candidateId,goodsIds:goods.slice(0,2),storeBindingKey:f.stores[0].key};
  assert.throws(()=>f.service.resolveCategories(f.job.id,input),/具体商品类型/);
  assert.throws(()=>f.service.resolveCategories(f.job.id,{...input,goodsIds:[goods[0],goods[2]],productType:'便携搅拌机',confirmProductType:true}),/具体商品类型/);
  const result=f.service.resolveCategories(f.job.id,{...input,productType:'便携搅拌机',confirmProductType:true});assert.equal(result.rows.filter(row=>!row.categoryRequired).length,2);assert.equal(result.rows[0].categoryResolution.mapping.version,2);
  const searched=await f.service.searchCategories(f.job.id,{goodsId:goods[1],storeBindingKey:f.stores[0].key,query:'便携搅拌机'});assert.equal(searched.resolution.status,'resolved');assert.equal(searched.resolution.method,'confirmed-product-type-mapping');
});

test('legacy category batches cannot bypass concrete type confirmation or reuse it after source paths change',async t=>{
  const f=fixture(t);await run(f,'inspect');await assert.rejects(f.selectBatch(goods.slice(0,2)),/已确认的具体商品类型/);searchAdapter(f);
  const catalog=await f.service.searchCategories(f.job.id,{goodsId:goods[0],storeBindingKey:f.stores[0].key,query:'搅拌机'});
  f.service.resolveCategories(f.job.id,{catalogId:catalog.catalogId,catalogDigest:catalog.catalogDigest,candidateId:catalog.candidates[0].candidateId,goodsIds:goods.slice(0,2),storeBindingKey:f.stores[0].key,productType:'便携搅拌机',confirmProductType:true});
  const selected=await f.selectBatch(goods.slice(0,2));assert.equal(selected.rows.filter(row=>!row.categoryRequired).length,2);
  await run(f,'source-facts');await assert.rejects(f.selectBatch(goods.slice(0,2)),/已确认的具体商品类型/);
});

test('missing source paths permit one confirmed candidate but never multi-product reuse',async t=>{
  const f=fixture(t);for(const row of f.freeJob.rows)delete row.sourceFacts;
  f.job=f.service.create({requestId:'missing-path-fixture',sourceJobId:f.freeJob.id,goodsIds:goods.slice(0,2),destinationKeys:[f.stores[0].key]});await run(f,'inspect');searchAdapter(f);
  const catalog=await f.service.searchCategories(f.job.id,{goodsId:goods[0],storeBindingKey:f.stores[0].key,query:'搅拌机'}),input={catalogId:catalog.catalogId,catalogDigest:catalog.catalogDigest,candidateId:catalog.candidates[0].candidateId,storeBindingKey:f.stores[0].key,productType:'便携搅拌机',confirmProductType:true};
  assert.throws(()=>f.service.resolveCategories(f.job.id,{...input,goodsIds:goods.slice(0,2)}),/完整来源分类/);
  const result=f.service.resolveCategories(f.job.id,{...input,goodsIds:[goods[0]]});assert.equal(result.rows[0].categoryRequired,false);assert.equal(result.rows[0].categoryResolution.mapping,null);assert.equal(result.rows[1].categoryRequired,true);
});

test('search confirmation is invalidated by restart and cannot cross stores or changed source facts',async t=>{
  const f=fixture(t,{stores:2});await run(f,'inspect');const candidates=searchAdapter(f);
  const catalog=await f.service.searchCategories(f.job.id,{goodsId:goods[0],storeBindingKey:f.stores[0].key,query:'搅拌机'}),input={catalogId:catalog.catalogId,catalogDigest:catalog.catalogDigest,candidateId:candidates[0].candidateId,goodsIds:[goods[0]],storeBindingKey:f.stores[0].key};
  assert.throws(()=>f.service.resolveCategories(f.job.id,{...input,storeBindingKey:f.stores[1].key}),/不属于本次店铺/);
  await run(f,'source-facts');assert.throws(()=>f.service.resolveCategories(f.job.id,input),/资料已经变化/);
  const restored=createListingWorkflow(f.options);assert.throws(()=>restored.resolveCategories(f.job.id,input),/不存在|过期/);assert.deepEqual(restored.get(f.job.id).availableActions,['reconcile']);
});

test('native operations group exact stores and categories, journal whole groups before writes, then verify each member',async t=>{
  const f=fixture(t,{native:true,stores:2});await run(f,'inspect');
  for(const store of f.stores){await f.select(goods.slice(0,2),store,categories[0]);await f.select([goods[2]],store,categories[1]);}
  const result=await run(f,'process');assert.equal(result.status,'pending-ready');assert.equal(result.totals.pending,6);assert.equal(result.batchOperations.length,8);assert.ok(result.batchOperations.every(operation=>operation.status==='confirmed'));
  for(const kind of ['prepareBatch','pendingBatch']){
    const calls=f.calls.filter(call=>call.kind===kind);assert.equal(calls.length,4);assert.deepEqual(calls.map(call=>call.ids.length).sort(),[1,1,2,2]);
    assert.deepEqual(new Set(calls.flatMap(call=>call.ids)),new Set(result.rows.map(row=>row.id)));
    for(const call of calls)assert.ok(call.ids.every(id=>JSON.parse(id)[1]===call.store));
  }
  assert.equal(f.calls.some(call=>['prepare','pending'].includes(call.kind)),false,'native processing never delegates to the row compatibility loops');
});

test('incomplete native readback preserves unknown intents and cannot rerun or auto-resume after restart',async t=>{
  const f=fixture(t,{native:true});await run(f,'inspect');await f.select(goods.slice(0,2));
  const original=f.adapter.prepareBatch;f.adapter.prepareBatch=async args=>{const result=await original(args);return {rows:result.rows.slice(0,1)};};
  const result=await run(f,'process');assert.equal(result.batchOperations[0].status,'unknown');assert.ok(result.rows.slice(0,2).every(row=>row.saveIntent?.status==='unknown'));assert.deepEqual(result.availableActions,['reconcile']);
  assert.equal(f.calls.some(call=>call.kind==='pendingBatch'),false);assert.throws(()=>f.service.run(f.job.id,'process'),/先只读核对/);
  const count=f.calls.length,restored=createListingWorkflow(f.options);await new Promise(resolve=>setTimeout(resolve,10));assert.equal(f.calls.length,count);assert.deepEqual(restored.get(f.job.id).availableActions,['reconcile']);assert.throws(()=>restored.run(f.job.id,'process'),/先只读核对/);
  restored.run(f.job.id,'reconcile');await idle(restored);assert.equal(restored.get(f.job.id).batchOperations[0].status,'confirmed');assert.equal(f.calls.filter(call=>call.kind==='prepareBatch').length,1);
});

test('native readback checks every exact member before confirming any saved member',async t=>{
  const f=fixture(t,{native:true});await run(f,'inspect');await f.select(goods.slice(0,2));
  const original=f.adapter.prepareBatch;f.adapter.prepareBatch=async args=>{const result=await original(args);result.rows[1].draftId='999999999';return result;};
  const result=await run(f,'process');assert.ok(result.rows.slice(0,2).every(row=>row.saveIntent.status==='unknown'));assert.equal(result.rows[0].saved,false);assert.equal(result.batchOperations[0].status,'unknown');assert.deepEqual(result.availableActions,['reconcile']);
});

test('native save refuses missing member snapshots before submission',async t=>{
  const f=fixture(t,{native:true});await run(f,'inspect');await f.select(goods.slice(0,2));let writes=0;
  f.adapter.prepareBatch=async args=>{const members=args.rows.map(row=>({id:row.id,goodsId:row.goodsId,storeBindingKey:row.storeBindingKey,draftId:row.draftId,payload:f.savePayload(row)}));delete members[1].payload.priceEvidence;await args.beforeSubmit({rows:members});writes++;return {rows:args.rows.map(f.preparation)};};
  const result=await run(f,'process');assert.equal(writes,0);assert.ok(result.rows.every(row=>!row.saveIntent));assert.match(result.batchOperations[0].issue,/原有价格记录/);
});

test('preflight blocked native movement does not invent an unknown move from existing saved data',async t=>{
  const f=fixture(t,{native:true});await run(f,'inspect');await f.select(goods.slice(0,2));
  f.adapter.moveToPendingBatch=async args=>({rows:args.rows.map(row=>({...f.preparation(row),movedToPending:false,issues:['本批移入待发布入口未出现']}))});
  const result=await run(f,'process');assert.ok(result.rows.slice(0,2).every(row=>row.saveIntent.status==='confirmed'&&!row.moveIntent));assert.equal(result.batchOperations[1].status,'blocked');assert.match(result.rows[0].issues[0],/入口未出现/);
});

test('stop during a native group keeps its saved receipt and never starts another group or move',async t=>{
  const f=fixture(t,{native:true});await run(f,'inspect');await f.select(goods.slice(0,2));await f.select([goods[2]],f.stores[0],categories[1]);
  const original=f.adapter.prepareBatch;f.adapter.prepareBatch=async args=>{const result=await original(args);f.service.stop(f.job.id);return result;};
  const result=await run(f,'process');assert.equal(result.status,'paused');assert.equal(f.calls.filter(call=>call.kind==='prepareBatch').length,1);assert.equal(f.calls.filter(call=>call.kind==='pendingBatch').length,0);assert.ok(result.rows.slice(0,2).every(row=>row.saveIntent.status==='confirmed'));assert.equal(result.rows[2].saveIntent,undefined);
});

const categoryIntentPayload=args=>({scopeKey:'fixture-native-category-scope',rows:args.rows.map(row=>({id:row.id,goodsId:row.goodsId,storeBindingKey:row.storeBindingKey,draftId:row.draftId,payload:{url:'https://www.dianxiaomi.com/web/modifyCategory',goodsId:row.goodsId,storeBindingKey:row.storeBindingKey,draftId:row.draftId,sourceUrl:row.sourceUrl,category:copy(row.categorySelection.category),expectedSnapshot:{variants:['white'],category:copy(row.categorySelection.category)}}}))});
const categoryReceipt=row=>({id:row.id,goodsId:row.goodsId,storeBindingKey:row.storeBindingKey,draftId:row.draftId,category:copy(row.categorySelection.category),categoryConfirmed:true,variantsPreserved:true});

test('category SaveNext has its own journal and unknown result blocks full save until native readonly recovery',async t=>{
  const f=fixture(t,{native:true});await run(f,'inspect');await f.select(goods.slice(0,2));let categoryWrites=0,finalWrites=0;
  f.adapter.prepareBatch=async args=>{await args.beforeCategorySubmit(categoryIntentPayload(args));categoryWrites++;const saved=f.persisted();assert.ok(saved.rows.slice(0,2).every(row=>row.nativeCategoryIntent.status==='pending'&&!row.saveIntent&&!row.saved));await args.beforeSubmit({rows:args.rows.map(row=>({id:row.id,goodsId:row.goodsId,storeBindingKey:row.storeBindingKey,draftId:row.draftId,payload:f.savePayload(row)}))});finalWrites++;return {rows:args.rows.map(f.preparation)};};
  let result=await run(f,'process');assert.equal(categoryWrites,1);assert.equal(finalWrites,0);assert.ok(result.rows.slice(0,2).every(row=>row.nativeCategoryIntent.status==='unknown'&&!row.saveIntent));assert.deepEqual(result.availableActions,['reconcile']);
  const restored=createListingWorkflow(f.options);result=restored.get(f.job.id);assert.equal(result.batchOperations[0].categoryIntent.status,'unknown');
  let readbacks=0;f.adapter.verifyNativeBatchMember=async args=>{assert.equal(args.verifyCategoryOnly,true);assert.equal(args.verifyPending,false);assert.equal(args.nativeBatch.categoryIntents.length,2);assert.equal(args.nativeBatch.preparationIntents,undefined);readbacks++;return {...categoryReceipt(args.row),readOnly:true,phase:'native-batch-editor'};};
  restored.run(f.job.id,'reconcile');await idle(restored);result=restored.get(f.job.id);assert.equal(readbacks,2);assert.ok(result.rows.slice(0,2).every(row=>row.nativeCategoryIntent.status==='confirmed'&&!row.saved&&!row.saveIntent));assert.ok(result.availableActions.includes('process'));assert.equal(categoryWrites,1);
  assert.throws(()=>restored.selectCategories(f.job.id,{goodsIds:[goods[0]],storeBindingKeys:[f.stores[0].key],category:categories[0]}),/已有提交记录/);
});

test('category next-stage receipt cannot promote classification-only saving into complete product saving',async t=>{
  const f=fixture(t,{native:true});await run(f,'inspect');await f.select(goods.slice(0,2));let finalWrites=0;
  f.adapter.prepareBatch=async args=>{const intent=categoryIntentPayload(args);await args.beforeCategorySubmit(intent);await args.onCategoryReadback({readOnly:true,phase:'native-batch-editor',scopeKey:intent.scopeKey,rows:args.rows.map(row=>({...categoryReceipt(row),saved:true}))});finalWrites++;return {rows:args.rows.map(f.preparation)};};
  const result=await run(f,'process');assert.equal(finalWrites,0);assert.ok(result.rows.slice(0,2).every(row=>row.nativeCategoryIntent.status==='unknown'&&!row.saveIntent&&!row.saved));
});

test('native saved snapshots use the native readonly hook and never fall back to legacy field IDs',async t=>{
  const f=fixture(t,{native:true});await run(f,'inspect');await f.select(goods.slice(0,2));let writes=0,legacyReads=0;
  f.adapter.prepareBatch=async args=>{await args.beforeSubmit({rows:args.rows.map(row=>({id:row.id,goodsId:row.goodsId,storeBindingKey:row.storeBindingKey,draftId:row.draftId,payload:{...f.savePayload(row),expectedSnapshot:{policy:'native-batch-preserve-fields-v1',member:{draftId:row.draftId,goodsId:row.goodsId},fields:[]}}}))});writes++;return {rows:[f.preparation(args.rows[0])]};};
  f.adapter.verify=async()=>{legacyReads++;throw new Error('legacy verifier must not read native snapshots');};
  await run(f,'process');let result=await run(f,'reconcile');assert.equal(legacyReads,0);assert.ok(result.rows.slice(0,2).every(row=>row.saveIntent.status==='unknown'));
  let reads=0;f.adapter.verifyNativeBatchMember=async args=>{assert.equal(args.verifyCategoryOnly,false);assert.equal(args.verifyPending,false);assert.equal(args.nativeBatch.preparationIntents.length,2);assert.ok(args.nativeBatch.rows.every(row=>row.saveIntent.payload.expectedSnapshot.policy==='native-batch-preserve-fields-v1'));reads++;return {...f.preparation(args.row),readOnly:true};};
  result=await run(f,'reconcile');assert.equal(reads,2);assert.equal(writes,1);assert.equal(legacyReads,0);assert.ok(result.rows.slice(0,2).every(row=>row.saveIntent.status==='confirmed'));assert.equal(result.batchOperations[0].status,'confirmed');
});

test('confirmed category receipt precedes the independent full native-save journal',async t=>{
  const f=fixture(t,{native:true});await run(f,'inspect');await f.select(goods.slice(0,2));
  f.adapter.prepareBatch=async args=>{const category=categoryIntentPayload(args);await args.beforeCategorySubmit(category);await args.onCategoryReadback({readOnly:true,phase:'native-batch-editor',scopeKey:category.scopeKey,rows:args.rows.map(categoryReceipt)});assert.ok(f.persisted().rows.slice(0,2).every(row=>row.nativeCategoryIntent.status==='confirmed'&&!row.saveIntent&&!row.saved));await args.beforeSubmit({rows:args.rows.map(row=>({id:row.id,goodsId:row.goodsId,storeBindingKey:row.storeBindingKey,draftId:row.draftId,payload:f.savePayload(row)}))});return {rows:args.rows.map(f.preparation)};};
  const result=await run(f,'process');assert.equal(result.totals.pending,2);assert.ok(result.rows.slice(0,2).every(row=>row.nativeCategoryIntent.status==='confirmed'&&row.saveIntent.status==='confirmed'&&row.moveIntent.status==='confirmed'));assert.equal(result.batchOperations[0].categoryIntent.status,'confirmed');
});

test('a native form with an extra or mismatched member is refused before any intent or write',async t=>{
  const f=fixture(t,{native:true});await run(f,'inspect');await f.select(goods.slice(0,2));let writes=0;
  f.adapter.prepareBatch=async args=>{const rows=args.rows.map(row=>({id:row.id,goodsId:row.goodsId,storeBindingKey:row.storeBindingKey,draftId:row.draftId,payload:f.savePayload(row)}));rows[1].draftId='999999999';await args.beforeSubmit({rows});writes++;return {rows:args.rows.map(f.preparation)};};
  const result=await run(f,'process');assert.equal(writes,0);assert.equal(result.batchOperations[0].status,'blocked');assert.ok(result.rows.every(row=>!row.saveIntent));assert.match(result.batchOperations[0].issue,/身份不一致/);
});

test('opening native edit is explicitly scoped to one store and unsaved batch members without saving',async t=>{
  const f=fixture(t,{stores:2});await run(f,'inspect');assert.throws(()=>f.service.openNative(f.job.id,{}),/店铺/);
  await f.select([goods[0]],f.stores[0]);await run(f,'prepare');
  f.service.openNative(f.job.id,{storeBindingKey:f.stores[0].key});await idle(f.service);
  const opened=f.service.get(f.job.id),call=f.calls.find(item=>item.kind==='native-edit');assert.equal(call.store,f.stores[0].key);assert.deepEqual(call.ids,goods.slice(1).map(goodsId=>key({goodsId,storeBindingKey:f.stores[0].key})));
  assert.equal(opened.nativeEdit.status,'opened');assert.equal(f.calls.filter(call=>call.kind==='prepare').length,1);assert.ok(opened.rows.filter(row=>row.goodsId!==goods[0]).every(row=>!row.saveIntent&&!row.moveIntent));
});

test('a partial saved receipt without beforeSubmit quarantines the entire native group and cannot replay',async t=>{
  const f=fixture(t,{native:true});await run(f,'inspect');await f.select(goods.slice(0,2));let submissions=0;
  f.adapter.prepareBatch=async args=>{submissions++;return {rows:[f.preparation(args.rows[0])]};};
  const result=await run(f,'process'),operation=result.batchOperations[0],members=result.rows.slice(0,2);
  assert.equal(operation.status,'unknown');assert.equal(operation.memberIds.length,2);
  assert.ok(members.every(row=>row.saveIntent?.status==='unknown'&&row.saveIntent.protocolViolation==='missing-beforeSubmit'&&row.saveIntent.batchId===operation.id));
  assert.ok(members.every(row=>!row.saved&&!row.ready),'a partial claimed receipt cannot promote either member to verified saved');
  assert.equal(result.rows[2].saveIntent,undefined);assert.deepEqual(result.availableActions,['reconcile']);
  assert.deepEqual(f.persisted().rows.slice(0,2).map(row=>row.saveIntent),members.map(row=>row.saveIntent),'the full unknown scope must persist before another request');
  for(const action of ['process','prepare'])assert.throws(()=>f.service.run(f.job.id,action),/先只读核对/);
  const restored=createListingWorkflow(f.options);assert.deepEqual(restored.get(f.job.id).availableActions,['reconcile']);assert.throws(()=>restored.run(f.job.id,'process'),/先只读核对/);assert.equal(submissions,1);
});

test('native selection reports real selected progress and preserves blocked reasons without claiming an editor opened',async t=>{
  const f=fixture(t);await run(f,'inspect');let started,release;
  const startedGate=new Promise(resolve=>started=resolve),completionGate=new Promise(resolve=>release=resolve);
  const reason='本批商品未在当前店铺列表全部找到，未打开批量编辑';
  f.adapter.openNativeBatch=async args=>{
    await args.onProgress({phase:'native-select',selected:1,total:args.rows.length,storeBindingKey:args.storeBinding.key});started();await completionGate;
    return {status:'blocked',businessWrite:false,blockers:[{code:'NATIVE_SELECTION_BLOCKED',message:reason}]};
  };
  f.service.openNative(f.job.id,{storeBindingKey:f.stores[0].key});await startedGate;
  try{
    const progress=f.service.get(f.job.id);assert.equal(progress.progress.phase,'native-select');assert.equal(progress.progress.selected,1);assert.equal(progress.progress.total,3);assert.equal(progress.progress.active,true);
    assert.match(progress.message,/选择本批商品：1\/3/);assert.deepEqual(f.persisted().progress,progress.progress);assert.deepEqual(progress.availableActions,['stop']);
  }finally{release();}
  await idle(f.service);const result=f.service.get(f.job.id);
  assert.equal(result.nativeEdit.status,'blocked');assert.equal(result.message,reason);assert.equal(result.nativeEdit.intent,undefined);
  assert.equal(result.progress.active,false,'a completed blocked read must stop reporting active selection');assert.ok(result.rows.every(row=>!row.saveIntent&&!row.moveIntent));
});

test('repeating native edit for the same store and members retains the original page intent without reopening',async t=>{
  const f=fixture(t,{stores:2});await run(f,'inspect');let openings=0;
  f.adapter.openNativeBatch=async args=>{
    openings++;await args.beforeOpen({memberIds:args.rows.map(row=>row.id),requestId:args.requestId,scopeKey:'fixture-scope',editorTargetId:'existing-native-page'});
    return {status:'needs-review',retainPage:true,businessWrite:false,message:'原生页面已打开，批量填写尚未确认'};
  };
  f.service.openNative(f.job.id,{storeBindingKey:f.stores[0].key});await idle(f.service);
  const previous=copy(f.service.get(f.job.id).nativeEdit);
  const repeated=f.service.openNative(f.job.id,{storeBindingKey:f.stores[0].key});await idle(f.service);
  assert.equal(openings,1);assert.deepEqual(repeated.nativeEdit,previous);assert.deepEqual(f.persisted().nativeEdit,previous);
  assert.match(repeated.message,/原.*页.*核对|原页/);assert.ok(repeated.rows.every(row=>!row.saveIntent&&!row.moveIntent));
  f.service.openNative(f.job.id,{storeBindingKey:f.stores[1].key});await idle(f.service);
  const second=copy(f.service.get(f.job.id).nativeEdit);assert.equal(openings,2);assert.equal(second.storeBindingKey,f.stores[1].key);
  const again=f.service.openNative(f.job.id,{storeBindingKey:f.stores[0].key});await idle(f.service);
  assert.equal(openings,2,'A → B → A must reuse the retained A page instead of opening a third page');
  assert.deepEqual(again.nativeEdit,second);assert.deepEqual(again.nativeEditHistory,[previous]);assert.deepEqual(f.persisted().nativeEditHistory,[previous]);
  assert.match(again.message,/原.*页.*核对|原页/);assert.ok(again.rows.every(row=>!row.saveIntent&&!row.moveIntent));
});
